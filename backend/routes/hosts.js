/**
 * Host management routes - "the host wizard" equivalent.
 *
 * Flow:
 *   1. User clicks "Add Host" in UI, picks OS + name.
 *   2. We generate a PSK key locally, register host in Zabbix via API,
 *      record it in our DB scoped to this user.
 *   3. We return a one-line curl/PowerShell install command that the user
 *      runs on their server. The bootstrap script installs the Zabbix agent,
 *      writes the PSK file, configures it to point to our Zabbix server,
 *      and starts it. Within ~1 minute Zabbix begins collecting data.
 */
const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const zbx = require('../services/zabbix');
const { authRequired } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

function makePsk() {
  // 32-byte hex = 256-bit PSK (Zabbix requires min 32 hex chars).
  return crypto.randomBytes(32).toString('hex');
}

/**
 * POST /api/hosts
 * Register a new host for the logged-in user.
 *
 * Body: { visible_name, ip_address?, os_type: 'linux'|'windows', agent_mode: 'active'|'passive' }
 */
router.post('/', authRequired, async (req, res) => {
  try {
    const { visible_name, ip_address, os_type = 'linux', agent_mode = 'active' } = req.body || {};
    if (!visible_name) return res.status(400).json({ error: 'visible_name is required' });
    if (!['linux', 'windows'].includes(os_type)) {
      return res.status(400).json({ error: "os_type must be 'linux' or 'windows'" });
    }
    if (!['active', 'passive'].includes(agent_mode)) {
      return res.status(400).json({ error: "agent_mode must be 'active' or 'passive'" });
    }
    if (agent_mode === 'passive' && !ip_address) {
      return res.status(400).json({ error: 'Passive mode requires the server IP address' });
    }

    // Generate a unique technical host name; the user-facing name is visible_name.
    const userTag = `user_${req.user.id}`;
    const technicalName = `${userTag}_${visible_name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${uuidv4().slice(0, 8)}`;

    // PSK for encrypted agent-server traffic.
    const pskIdentity = `neev_${userTag}_${uuidv4().slice(0, 8)}`;
    const pskKey = makePsk();

    // Ensure our host group exists.
    const groupName = process.env.DEFAULT_HOST_GROUP || 'NeevCloud Clients';
    const groupId = await zbx.ensureHostGroup(groupName);

    // Create host in Zabbix.
    const { hostid, templateName } = await zbx.createHost({
      hostName: technicalName,
      visibleName: visible_name,
      ipAddress: ip_address,
      osType: os_type,
      agentMode: agent_mode,
      groupId,
      pskIdentity,
      pskKey,
      userTagValue: String(req.user.id),
    });

    // Save mapping in our DB.
    const info = db.prepare(`
      INSERT INTO hosts (user_id, zabbix_host_id, host_name, visible_name, os_type, agent_mode, psk_identity, psk_key, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(req.user.id, hostid, technicalName, visible_name, os_type, agent_mode, pskIdentity, pskKey);

    const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(info.lastInsertRowid);
    res.json({ host, install_command: buildInstallCommand(host, req) });
  } catch (e) {
    console.error('Host create error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/hosts - list current user's hosts (with live status from Zabbix).
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM hosts WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

    // Enrich with live availability from Zabbix in parallel.
    const enriched = await Promise.all(rows.map(async (h) => {
      try {
        const details = await zbx.getHostDetails(h.zabbix_host_id);
        return {
          ...h,
          psk_key: undefined,  // never leak the PSK in list view
          zabbix: details,
        };
      } catch (e) {
        return { ...h, psk_key: undefined, zabbix: null, zabbix_error: e.message };
      }
    }));

    res.json({ hosts: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/hosts/problems/all - all active problems across user's hosts.
 * IMPORTANT: this route must be defined BEFORE /:id so Express doesn't
 * match "problems" as an :id parameter.
 */
router.get('/problems/all', authRequired, async (req, res) => {
  try {
    const rows = db.prepare('SELECT zabbix_host_id, visible_name FROM hosts WHERE user_id = ?').all(req.user.id);
    const ids = rows.map(r => r.zabbix_host_id);
    if (ids.length === 0) return res.json({ problems: [] });
    const problems = await zbx.getHostProblems(ids);
    // Decorate with our visible name.
    const map = Object.fromEntries(rows.map(r => [r.zabbix_host_id, r.visible_name]));
    res.json({ problems, host_names: map });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/hosts/:id - detail view with latest metrics.
 */
router.get('/:id', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });

    const [details, items, problems] = await Promise.all([
      zbx.getHostDetails(host.zabbix_host_id),
      zbx.getHostLatestData(host.zabbix_host_id),
      zbx.getHostProblems([host.zabbix_host_id]),
    ]);

    // Reduce noise - mark key metrics so the dashboard can highlight them.
    const keyMetricKeys = [
      'system.cpu.util',
      'vm.memory.utilization',
      'vm.memory.size[available]',
      'vm.memory.size[total]',
      'system.uptime',
      'system.cpu.load[all,avg1]',
      'system.cpu.load[all,avg5]',
      'agent.ping',
      'agent.version',
      'system.hostname',
    ];
    const metrics = items.map(it => ({
      ...it,
      is_key: keyMetricKeys.some(k => it.key_ === k || it.key_.startsWith(k)),
    }));

    res.json({
      host: { ...host, psk_key: undefined },
      zabbix: details,
      metrics,
      problems,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/hosts/:id/install - re-fetch install command (useful if user lost it).
 */
router.get('/:id/install', authRequired, (req, res) => {
  const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  res.json({ install_command: buildInstallCommand(host, req) });
});

/**
 * GET /api/hosts/:id/history?itemid=...&hours=2
 * Time-series for charting.
 */
router.get('/:id/history', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });

    const itemId = req.query.itemid;
    const hours = parseInt(req.query.hours, 10) || 2;
    if (!itemId) return res.status(400).json({ error: 'itemid query param required' });

    // We need the value type - fetch it once.
    const items = await zbx.call('item.get', {
      itemids: [itemId], hostids: [host.zabbix_host_id],
      output: ['itemid', 'value_type', 'name', 'units'],
    });
    if (items.length === 0) return res.status(404).json({ error: 'Item not found on host' });

    const valueType = parseInt(items[0].value_type, 10);
    const timeFrom = Math.floor(Date.now() / 1000) - hours * 3600;
    const history = await zbx.getItemHistory(itemId, valueType, timeFrom, null, 2000);
    res.json({ item: items[0], history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/hosts/:id
 */
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });

    try { await zbx.deleteHost(host.zabbix_host_id); }
    catch (e) { console.warn('Zabbix delete warning:', e.message); }

    db.prepare('DELETE FROM hosts WHERE id = ?').run(host.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



/**
 * Build the install command shown to the user.
 * For Linux: a curl | bash that installs zabbix-agent2, writes PSK, points to server.
 * For Windows: a PowerShell one-liner.
 */
function buildInstallCommand(host, req) {
  // Where this app is reachable - used to fetch the bootstrap script.
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const appHost = req.headers['x-forwarded-host'] || req.get('host');
  const baseUrl = `${proto}://${appHost}`;

  if (host.os_type === 'linux') {
    const url = `${baseUrl}/bootstrap/linux/${host.id}?t=${encodeURIComponent(makeBootstrapToken(host))}`;
    return {
      type: 'shell',
      command: `curl -fsSL "${url}" | sudo bash`,
      note: 'Run this on your Linux server as root or with sudo. It will install the Zabbix agent and connect it to NeevCloud Monitoring.',
    };
  } else {
    const url = `${baseUrl}/bootstrap/windows/${host.id}?t=${encodeURIComponent(makeBootstrapToken(host))}`;
    return {
      type: 'powershell',
      command: `powershell -ExecutionPolicy Bypass -Command "iwr -useb '${url}' | iex"`,
      note: 'Run this in an elevated PowerShell window on your Windows server.',
    };
  }
}

/**
 * Stateless token tied to the host PSK identity - prevents random people from
 * downloading another user's bootstrap script with a guessed host id.
 */
function makeBootstrapToken(host) {
  const secret = process.env.JWT_SECRET || 'fallback';
  return crypto.createHmac('sha256', secret).update(`${host.id}:${host.psk_identity}`).digest('hex').slice(0, 32);
}

router.makeBootstrapToken = makeBootstrapToken;
module.exports = router;
