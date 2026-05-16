/**
 * Zabbix 7.4 API client.
 *
 * Uses JSON-RPC 2.0 over /api_jsonrpc.php. In Zabbix 7.x, you can authenticate
 * either with an API token (Bearer) or via user.login. We use user.login and
 * cache the auth token in-memory, re-logging in if it ever expires.
 *
 * Docs: https://www.zabbix.com/documentation/7.4/en/manual/api
 */
const axios = require('axios');
require('dotenv').config();

const ZBX_URL = (process.env.ZABBIX_URL || '').replace(/\/+$/, '') + '/api_jsonrpc.php';
const ZBX_USER = process.env.ZABBIX_API_USER || 'Admin';
const ZBX_PASSWORD = process.env.ZABBIX_API_PASSWORD || 'zabbix';

let authToken = null;
let requestId = 1;

/**
 * Low-level JSON-RPC call to Zabbix.
 */
async function zbxCall(method, params, useAuth = true) {
  const body = {
    jsonrpc: '2.0',
    method,
    params,
    id: requestId++,
  };

  const headers = { 'Content-Type': 'application/json-rpc' };
  // In Zabbix 6.4+ the auth token is sent via Authorization header.
  if (useAuth && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  let resp;
  try {
    resp = await axios.post(ZBX_URL, body, { headers, timeout: 30000 });
  } catch (e) {
    const msg = e.response ? JSON.stringify(e.response.data) : e.message;
    throw new Error(`Zabbix HTTP error on ${method}: ${msg}`);
  }

  if (resp.data.error) {
    const err = resp.data.error;
    throw new Error(`Zabbix API error on ${method}: ${err.message} - ${err.data}`);
  }
  return resp.data.result;
}

/**
 * Authenticate against Zabbix and cache the token.
 */
async function login() {
  const result = await zbxCall(
    'user.login',
    { username: ZBX_USER, password: ZBX_PASSWORD },
    false
  );
  authToken = result;
  return result;
}

/**
 * Ensures we're logged in; transparently re-authenticates on session expiry.
 */
async function ensureAuth() {
  if (!authToken) await login();
}

/**
 * Wraps a Zabbix API call, retrying once on auth failure.
 */
async function call(method, params) {
  await ensureAuth();
  try {
    return await zbxCall(method, params);
  } catch (e) {
    // Token might have expired; one re-login attempt.
    if (/not authori[sz]ed|session terminated|re-?login/i.test(e.message)) {
      authToken = null;
      await login();
      return await zbxCall(method, params);
    }
    throw e;
  }
}

/**
 * Get (or create) the default host group used for client hosts.
 */
async function ensureHostGroup(name) {
  const groups = await call('hostgroup.get', { filter: { name: [name] } });
  if (groups && groups.length > 0) return groups[0].groupid;
  const created = await call('hostgroup.create', { name });
  return created.groupids[0];
}

/**
 * Resolve template names to template IDs.
 */
async function getTemplateIds(templateNames) {
  const templates = await call('template.get', {
    filter: { host: templateNames },
    output: ['templateid', 'host'],
  });
  return templates.map(t => ({ templateid: t.templateid, name: t.host }));
}

/**
 * Create a host in Zabbix for the user's server.
 *
 * @param {Object} opts
 * @param {string} opts.hostName    - Technical host name (unique in Zabbix)
 * @param {string} opts.visibleName - Display name
 * @param {string} opts.ipAddress   - Server IP (optional for active-only)
 * @param {string} opts.osType      - 'linux' | 'windows'
 * @param {string} opts.agentMode   - 'active' | 'passive'
 * @param {string} opts.groupId     - Host group ID
 * @param {string} opts.pskIdentity - PSK identity (for encryption)
 * @param {string} opts.pskKey      - PSK key hex
 * @param {string} opts.userTagValue- Tag value to scope per-user data
 */
async function createHost(opts) {
  const {
    hostName, visibleName, ipAddress, osType, agentMode,
    groupId, pskIdentity, pskKey, userTagValue,
  } = opts;

  // Pick template based on OS + mode
  let templateName;
  if (osType === 'windows') {
    templateName = process.env.DEFAULT_WINDOWS_TEMPLATE || 'Windows by Zabbix agent';
  } else if (agentMode === 'active') {
    templateName = process.env.DEFAULT_LINUX_ACTIVE_TEMPLATE || 'Linux by Zabbix agent active';
  } else {
    templateName = process.env.DEFAULT_LINUX_TEMPLATE || 'Linux by Zabbix agent';
  }

  const templates = await getTemplateIds([templateName]);
  if (templates.length === 0) {
    throw new Error(`Template not found in Zabbix: "${templateName}". Please verify the name in Zabbix > Data collection > Templates.`);
  }

  // Build host interface. For active-only agents, an interface is still required
  // but the IP can be 127.0.0.1 (the agent connects out to the server).
  const interfaceIp = ipAddress || '127.0.0.1';
  const params = {
    host: hostName,
    name: visibleName || hostName,
    interfaces: [{
      type: 1,            // 1 = Zabbix agent
      main: 1,
      useip: 1,
      ip: interfaceIp,
      dns: '',
      port: '10050',
    }],
    groups: [{ groupid: groupId }],
    templates: templates.map(t => ({ templateid: t.templateid })),
    tags: [
      { tag: 'neevcloud_user', value: userTagValue },
      { tag: 'managed_by',     value: 'neevcloud' },
    ],
  };

  // Add PSK encryption if provided
  if (pskIdentity && pskKey) {
    params.tls_connect = 2;             // 2 = PSK
    params.tls_accept = 2;
    params.tls_psk_identity = pskIdentity;
    params.tls_psk = pskKey;
  }

  const created = await call('host.create', params);
  return { hostid: created.hostids[0], templateName };
}

async function deleteHost(hostId) {
  return call('host.delete', [hostId]);
}

/**
 * Get a host's interface + status info.
 */
async function getHostDetails(hostId) {
  const hosts = await call('host.get', {
    hostids: [hostId],
    output: ['hostid', 'host', 'name', 'status', 'available'],
    selectInterfaces: ['interfaceid', 'ip', 'dns', 'port', 'available', 'error'],
  });
  return hosts[0] || null;
}

/**
 * Get latest values for a host (current CPU, memory, etc.).
 * We pull the key items so the dashboard has live snapshots.
 */
async function getHostLatestData(hostId) {
  const items = await call('item.get', {
    hostids: [hostId],
    output: ['itemid', 'name', 'key_', 'lastvalue', 'prevvalue', 'lastclock', 'units', 'value_type'],
    sortfield: 'name',
  });
  return items;
}

/**
 * Get historical data for a specific item (for charts).
 * value_type: 0=float,1=char,2=log,3=uint,4=text
 */
async function getItemHistory(itemId, valueType, timeFrom, timeTill, limit = 500) {
  const params = {
    itemids: [itemId],
    history: valueType,
    sortfield: 'clock',
    sortorder: 'ASC',
    limit,
  };
  if (timeFrom) params.time_from = timeFrom;
  if (timeTill) params.time_till = timeTill;
  return call('history.get', params);
}

/**
 * Active triggers / problems for one or more hosts.
 */
async function getHostProblems(hostIds) {
  if (!hostIds || hostIds.length === 0) return [];
  return call('problem.get', {
    hostids: hostIds,
    output: 'extend',
    selectTags: 'extend',
    recent: true,
    sortfield: ['eventid'],
    sortorder: 'DESC',
    limit: 200,
  });
}

/**
 * Items for a host, optionally filtered by key pattern.
 */
async function getHostItems(hostId, keySearch) {
  const params = {
    hostids: [hostId],
    output: ['itemid', 'name', 'key_', 'lastvalue', 'units', 'value_type'],
  };
  if (keySearch) {
    params.search = { key_: keySearch };
  }
  return call('item.get', params);
}

/**
 * Find an item id by key on a host - convenience helper.
 */
async function findItemByKey(hostId, key) {
  const items = await call('item.get', {
    hostids: [hostId],
    filter: { key_: key },
    output: ['itemid', 'value_type', 'name', 'units', 'lastvalue'],
  });
  return items[0] || null;
}

/**
 * Resolve event names so we can show readable trigger info.
 */
async function getEventDetails(eventIds) {
  if (!eventIds || eventIds.length === 0) return [];
  return call('event.get', {
    eventids: eventIds,
    output: 'extend',
    select_acknowledges: 'extend',
    selectHosts: ['hostid', 'name'],
  });
}

/**
 * Test connectivity to the Zabbix server (called on startup).
 */
async function ping() {
  try {
    const v = await zbxCall('apiinfo.version', {}, false);
    return { ok: true, version: v };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  login, call, ensureAuth, ping,
  ensureHostGroup, getTemplateIds,
  createHost, deleteHost, getHostDetails,
  getHostLatestData, getItemHistory, getHostProblems,
  getHostItems, findItemByKey, getEventDetails,
};
