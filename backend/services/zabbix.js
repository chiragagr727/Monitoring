/**
 * Zabbix 7.4 JSON-RPC API client — FIXED
 *
 * Changes:
 * - getItemHistory now takes explicit limit param
 * - getHostLatestData fetches ALL items (not just some)
 * - sanitizeError hides Zabbix branding from users
 */
const axios = require('axios');
require('dotenv').config();

const BASE     = (process.env.ZABBIX_URL || '').replace(/\/+$/, '');
const ENDPOINT = BASE + '/api_jsonrpc.php';
const ZBX_USER = process.env.ZABBIX_API_USER || 'Admin';
const ZBX_PASS = process.env.ZABBIX_API_PASSWORD || 'zabbix';

let authToken = null;
let reqId = 1;

function sanitizeError(msg) {
  return String(msg)
    .replace(/Zabbix API error/gi, 'Monitoring API error')
    .replace(/Zabbix HTTP error/gi, 'Monitoring connection error')
    .replace(/\bzabbix\b/gi, 'monitoring engine');
}

async function rpc(method, params, token) {
  const headers = { 'Content-Type': 'application/json-rpc' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let resp;
  try {
    resp = await axios.post(ENDPOINT, { jsonrpc: '2.0', method, params, id: reqId++ }, { headers, timeout: 30000 });
  } catch (e) {
    throw new Error(sanitizeError(`Connection error [${method}]: ${e.response ? JSON.stringify(e.response.data) : e.message}`));
  }
  if (resp.data.error) {
    const er = resp.data.error;
    throw new Error(sanitizeError(`API error [${method}]: ${er.message} — ${er.data}`));
  }
  return resp.data.result;
}

async function login() {
  authToken = await rpc('user.login', { username: ZBX_USER, password: ZBX_PASS });
  return authToken;
}

async function call(method, params) {
  if (!authToken) await login();
  try {
    return await rpc(method, params, authToken);
  } catch (e) {
    if (/not authori[sz]ed|session|re-?login/i.test(e.message)) {
      authToken = null; await login();
      return await rpc(method, params, authToken);
    }
    throw e;
  }
}

async function ensureHostGroup(name) {
  const groups = await call('hostgroup.get', { filter: { name: [name] } });
  if (groups.length > 0) return groups[0].groupid;
  const r = await call('hostgroup.create', { name });
  return r.groupids[0];
}

async function getTemplateIds(names) {
  return call('template.get', { filter: { host: names }, output: ['templateid', 'host'] });
}

async function createHost({ hostName, visibleName, ipAddress, osType, agentMode, groupId, pskIdentity, pskKey, userTagValue }) {
  let templateName;
  if (osType === 'windows')        templateName = process.env.DEFAULT_WINDOWS_TEMPLATE    || 'Windows by Zabbix agent active';
  else if (agentMode === 'active') templateName = process.env.DEFAULT_LINUX_ACTIVE_TEMPLATE || 'Linux by Zabbix agent active';
  else                             templateName = process.env.DEFAULT_LINUX_TEMPLATE       || 'Linux by Zabbix agent';

  const templates = await getTemplateIds([templateName]);
  if (templates.length === 0) throw new Error(`Template "${templateName}" not found. Check Data collection → Templates in your monitoring server.`);

  const params = {
    host: hostName,
    name: visibleName || hostName,
    interfaces: [{ type: 1, main: 1, useip: 1, ip: ipAddress || '127.0.0.1', dns: '', port: '10050' }],
    groups:    [{ groupid: groupId }],
    templates: templates.map(t => ({ templateid: t.templateid })),
    tags: [
      { tag: 'neevcloud_user', value: String(userTagValue) },
      { tag: 'managed_by',     value: 'neevcloud' },
    ],
  };

  if (pskIdentity && pskKey) {
    params.tls_connect = 2; params.tls_accept = 2;
    params.tls_psk_identity = pskIdentity; params.tls_psk = pskKey;
  }

  const r = await call('host.create', params);
  return { hostid: r.hostids[0], templateName };
}

async function deleteHost(hostId) {
  return call('host.delete', [hostId]);
}

async function getHostDetails(hostId) {
  const r = await call('host.get', {
    hostids: [hostId],
    output: ['hostid', 'host', 'name', 'status', 'available'],
    selectInterfaces: ['interfaceid', 'ip', 'dns', 'port', 'available', 'error'],
  });
  return r[0] || null;
}

async function getHostLatestData(hostId) {
  // Fetch ALL items for the host so the UI has everything (disk, network, swap, etc.)
  return call('item.get', {
    hostids: [hostId],
    output: ['itemid', 'name', 'key_', 'lastvalue', 'units', 'value_type', 'lastclock'],
    sortfield: 'name',
    limit: 500,
  });
}

/**
 * Get item history.
 * @param {string} itemId
 * @param {number} valueType  - 0=float, 1=char, 2=log, 3=uint64, 4=text
 * @param {number} timeFrom   - unix timestamp
 * @param {number|null} timeTill - unix timestamp or null for now
 * @param {number} limit      - max data points
 */
async function getItemHistory(itemId, valueType, timeFrom, timeTill, limit = 1000) {
  const p = {
    itemids:   [itemId],
    history:   valueType,
    sortfield: 'clock',
    sortorder: 'ASC',
    limit,
  };
  if (timeFrom) p.time_from = timeFrom;
  if (timeTill) p.time_till = timeTill;
  return call('history.get', p);
}

async function getHostProblems(hostIds) {
  if (!hostIds || hostIds.length === 0) return [];
  return call('problem.get', {
    hostids: hostIds,
    output: 'extend',
    selectTags: 'extend',
    recent: true,
    sortfield: ['eventid'],
    sortorder: 'DESC',
    limit: 300,
  });
}

async function ping() {
  try {
    const v = await rpc('apiinfo.version', {});
    return { ok: true, version: v };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  call, ping, login,
  ensureHostGroup, getTemplateIds,
  createHost, deleteHost,
  getHostDetails, getHostLatestData,
  getItemHistory, getHostProblems,
};
