/**
 * Host routes — FIXED:
 * 1. /problems/all BEFORE /:id (routing bug fix)
 * 2. History route supports 1W (168h) and 1M (720h) with appropriate limits
 * 3. Bootstrap URL uses APP_PUBLIC_URL
 */
const express = require('express');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db  = require('../db');
const zbx = require('../services/zabbix');
const { authRequired } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

function makePsk() { return crypto.randomBytes(32).toString('hex'); }

function bootstrapToken(host) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'fallback')
    .update(`${host.id}:${host.psk_identity}`)
    .digest('hex').slice(0, 32);
}

function appBaseUrl(req) {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}`;
}

function buildInstallCommand(host, req) {
  const base  = appBaseUrl(req);
  const token = bootstrapToken(host);
  if (host.os_type === 'linux') {
    return {
      type: 'shell',
      command: `curl -fsSL "${base}/bootstrap/linux/${host.id}?t=${token}" | sudo bash`,
      note: 'Run on your Linux server as root or with sudo. Installs Zabbix agent2 and connects it to NeevCloud Monitoring.',
    };
  }
  return {
    type: 'powershell',
    command: `powershell -ExecutionPolicy Bypass -Command "iwr -useb '${base}/bootstrap/windows/${host.id}?t=${token}' | iex"`,
    note: 'Run in an elevated (Administrator) PowerShell window on your Windows server.',
  };
}

// ── ⚠️  /problems/all MUST be BEFORE /:id ────────────────────────────
router.get('/problems/all', authRequired, async (req, res) => {
  try {
    const rows = db.prepare('SELECT zabbix_host_id, visible_name FROM hosts WHERE user_id = ?').all(req.user.id);
    const ids  = rows.map(r => r.zabbix_host_id);
    if (ids.length === 0) return res.json({ problems: [], host_names: {} });
    const problems   = await zbx.getHostProblems(ids);
    const host_names = Object.fromEntries(rows.map(r => [r.zabbix_host_id, r.visible_name]));
    res.json({ problems, host_names });
  } catch (e) {
    console.error('problems/all:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST / – add host ─────────────────────────────────────────────────
router.post('/', authRequired, async (req, res) => {
  try {
    const { visible_name, ip_address, os_type = 'linux', agent_mode = 'active' } = req.body || {};
    if (!visible_name) return res.status(400).json({ error: 'visible_name is required' });
    if (!['linux','windows'].includes(os_type)) return res.status(400).json({ error: "os_type must be 'linux' or 'windows'" });
    if (!['active','passive'].includes(agent_mode)) return res.status(400).json({ error: "agent_mode must be 'active' or 'passive'" });
    if (agent_mode === 'passive' && !ip_address) return res.status(400).json({ error: 'Passive mode requires ip_address' });

    const userTag     = `user_${req.user.id}`;
    const techName    = `${userTag}_${visible_name.replace(/[^a-zA-Z0-9_-]/g,'_')}_${uuidv4().slice(0,8)}`;
    const pskIdentity = `neev_${userTag}_${uuidv4().slice(0,8)}`;
    const pskKey      = makePsk();

    const groupId = await zbx.ensureHostGroup(process.env.DEFAULT_HOST_GROUP || 'NeevCloud Clients');
    const { hostid, templateName } = await zbx.createHost({
      hostName: techName, visibleName: visible_name, ipAddress: ip_address,
      osType: os_type, agentMode: agent_mode, groupId, pskIdentity, pskKey,
      userTagValue: String(req.user.id),
    });

    const info = db.prepare(
      'INSERT INTO hosts (user_id, zabbix_host_id, host_name, visible_name, os_type, agent_mode, psk_identity, psk_key, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, hostid, techName, visible_name, os_type, agent_mode, pskIdentity, pskKey, 'pending');

    const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(info.lastInsertRowid);
    res.json({ host: strip(host), install_command: buildInstallCommand(host, req), templateName });
  } catch (e) {
    console.error('Add host:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET / – list ──────────────────────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM hosts WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    const enriched = await Promise.all(rows.map(async h => {
      try {
        return { ...strip(h), zabbix: await zbx.getHostDetails(h.zabbix_host_id) };
      } catch (e) {
        return { ...strip(h), zabbix: null, zabbix_error: e.message };
      }
    }));
    res.json({ hosts: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /:id/install ──────────────────────────────────────────────────
router.get('/:id/install', authRequired, (req, res) => {
  const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  res.json({ install_command: buildInstallCommand(host, req) });
});

// ── GET /:id/history — FIXED for 1W/1M ranges ────────────────────────
router.get('/:id/history', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });

    const itemId = req.query.itemid;
    const hours  = Math.min(parseInt(req.query.hours, 10) || 24, 720); // max 30 days
    if (!itemId) return res.status(400).json({ error: 'itemid required' });

    const items = await zbx.call('item.get', {
      itemids: [itemId], hostids: [host.zabbix_host_id],
      output: ['itemid', 'value_type', 'name', 'units'],
    });
    if (!items.length) return res.status(404).json({ error: 'Item not found on this host' });

    const timeFrom = Math.floor(Date.now() / 1000) - hours * 3600;

    // For longer ranges, increase the limit so we get enough data points
    // Zabbix stores data every 1-3 min typically; for 1W we need ~3360 pts max
    let limit;
    if (hours <= 6)   limit = 500;
    else if (hours <= 24)  limit = 1000;
    else if (hours <= 168) limit = 3000;   // 1 week
    else               limit = 5000;        // 1 month

    const history = await zbx.getItemHistory(
      itemId,
      parseInt(items[0].value_type, 10),
      timeFrom,
      null,   // no timeTill = up to now
      limit
    );

    res.json({ item: items[0], history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /:id – detail ─────────────────────────────────────────────────
router.get('/:id', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    const [details, metrics, problems] = await Promise.all([
      zbx.getHostDetails(host.zabbix_host_id),
      zbx.getHostLatestData(host.zabbix_host_id),
      zbx.getHostProblems([host.zabbix_host_id]),
    ]);
    res.json({ host: strip(host), zabbix: details, metrics, problems });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:id ───────────────────────────────────────────────────────
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    try { await zbx.deleteHost(host.zabbix_host_id); }
    catch (e) { console.warn('Zabbix delete warning:', e.message); }
    db.prepare('DELETE FROM hosts WHERE id = ?').run(host.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function strip(h) { const { psk_key, ...rest } = h; return rest; }
module.exports = router;
