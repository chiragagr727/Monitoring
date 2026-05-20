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
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'fallback')
    .update(`${host.id}:${host.psk_identity}`).digest('hex').slice(0, 32);
}
function appBaseUrl(req) {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/+$/, '');
  return `${req.headers['x-forwarded-proto']||req.protocol}://${req.headers['x-forwarded-host']||req.get('host')}`;
}
function buildInstallCommand(host, req) {
  const base = appBaseUrl(req), token = bootstrapToken(host);
  if (host.os_type === 'linux') return {
    type: 'shell',
    command: `curl -fsSL "${base}/bootstrap/linux/${host.id}?t=${token}" | sudo bash`,
    note: 'Run on your Linux server as root or with sudo.',
  };
  return {
    type: 'powershell',
    command: `powershell -ExecutionPolicy Bypass -Command "iwr -useb '${base}/bootstrap/windows/${host.id}?t=${token}' | iex"`,
    note: 'Run in an elevated PowerShell window.',
  };
}

router.get('/problems/all', authRequired, async (req, res) => {
  try {
    const rows = db.prepare('SELECT zabbix_host_id, visible_name FROM hosts WHERE user_id = ?').all(req.user.id);
    const ids  = rows.map(r => r.zabbix_host_id);
    if (!ids.length) return res.json({ problems: [], host_names: {} });
    const problems   = await zbx.getHostProblems(ids);
    const host_names = Object.fromEntries(rows.map(r => [r.zabbix_host_id, r.visible_name]));
    res.json({ problems, host_names });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { visible_name, ip_address, os_type = 'linux', agent_mode = 'active' } = req.body || {};
    if (!visible_name) return res.status(400).json({ error: 'visible_name is required' });
    if (!['linux','windows'].includes(os_type)) return res.status(400).json({ error: "os_type must be 'linux' or 'windows'" });
    if (!['active','passive'].includes(agent_mode)) return res.status(400).json({ error: "agent_mode must be 'active' or 'passive'" });
    if (agent_mode === 'passive' && !ip_address) return res.status(400).json({ error: 'Passive mode requires ip_address' });
    const userTag = `user_${req.user.id}`;
    const techName = `${userTag}_${visible_name.replace(/[^a-zA-Z0-9_-]/g,'_')}_${uuidv4().slice(0,8)}`;
    const pskIdentity = `neev_${userTag}_${uuidv4().slice(0,8)}`;
    const pskKey = makePsk();
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
  } catch (e) { console.error('Add host:', e.message); res.status(500).json({ error: e.message }); }
});

router.get('/', authRequired, async (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM hosts WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    const enriched = await Promise.all(rows.map(async h => {
      try { return { ...strip(h), zabbix: await zbx.getHostDetails(h.zabbix_host_id) }; }
      catch { return { ...strip(h), zabbix: null }; }
    }));
    res.json({ hosts: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/install', authRequired, (req, res) => {
  const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  res.json({ install_command: buildInstallCommand(host, req) });
});

router.get('/:id/history', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    const itemId = req.query.itemid;
    const hours  = Math.min(parseInt(req.query.hours, 10) || 24, 720);
    if (!itemId) return res.status(400).json({ error: 'itemid required' });
    const items = await zbx.call('item.get', {
      itemids: [itemId], hostids: [host.zabbix_host_id],
      output: ['itemid', 'value_type', 'name', 'units', 'lastclock'],
    });
    if (!items.length) return res.status(404).json({ error: 'Item not found' });
    const item      = items[0];
    const now       = Math.floor(Date.now() / 1000);
    const lastClock = parseInt(item.lastclock, 10) || 0;
    // Smart window: if data is older than requested range, show around last known point
    let timeFrom = now - hours * 3600;
    if (lastClock > 0 && lastClock < timeFrom) {
      timeFrom = Math.max(lastClock - hours * 3600, 0);
    }
    const limit = hours <= 24 ? 2000 : hours <= 168 ? 5000 : 10000;
    const history = await zbx.getItemHistory(itemId, parseInt(item.value_type,10), timeFrom, null, limit);
    res.json({ item, history });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    const [details, metrics, problems] = await Promise.all([
      zbx.getHostDetails(host.zabbix_host_id),
      zbx.getHostLatestData(host.zabbix_host_id),
      zbx.getHostProblems([host.zabbix_host_id]),
    ]);
    const iface = details?.interfaces?.[0];
    // IP: env var first, then interface if not 127.0.0.1, then null
    const realIP = process.env.SERVER_DISPLAY_IP
      || (iface?.ip && iface.ip !== '127.0.0.1' ? iface.ip : null);
    res.json({ host: { ...strip(host), real_ip: realIP }, zabbix: details, metrics, problems });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    try { await zbx.deleteHost(host.zabbix_host_id); } catch (e) { console.warn('Delete:', e.message); }
    db.prepare('DELETE FROM hosts WHERE id = ?').run(host.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function strip(h) { const { psk_key, ...r } = h; return r; }
module.exports = router;
