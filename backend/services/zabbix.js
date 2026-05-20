/**
 * NeevCloud — monitoring engine (Zabbix 7.4 JSON-RPC)
 */
const axios = require('axios');
require('dotenv').config();

const BASE     = (process.env.ZABBIX_URL || '').replace(/\/+$/, '');
const ENDPOINT = BASE + '/api_jsonrpc.php';
const ZBX_USER = process.env.ZABBIX_API_USER || 'Admin';
const ZBX_PASS = process.env.ZABBIX_API_PASSWORD || 'zabbix';

let authToken = null;
let reqId = 1;

function sanitize(msg) {
  return String(msg)
    .replace(/zabbix api error/gi, 'Monitoring API error')
    .replace(/zabbix/gi, 'monitoring engine');
}

async function rpc(method, params, token) {
  const headers = { 'Content-Type': 'application/json-rpc' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let resp;
  try {
    resp = await axios.post(ENDPOINT, { jsonrpc:'2.0', method, params, id: reqId++ }, { headers, timeout: 30000 });
  } catch (e) {
    throw new Error(sanitize(`Connection error [${method}]: ${e.response ? JSON.stringify(e.response.data) : e.message}`));
  }
  if (resp.data.error) {
    const er = resp.data.error;
    throw new Error(sanitize(`API error [${method}]: ${er.message} — ${er.data}`));
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
  const g = await call('hostgroup.get', { filter: { name: [name] } });
  if (g.length > 0) return g[0].groupid;
  const r = await call('hostgroup.create', { name });
  return r.groupids[0];
}

async function getTemplateIds(names) {
  return call('template.get', { filter: { host: names }, output: ['templateid', 'host'] });
}

async function createHost({ hostName, visibleName, ipAddress, osType, agentMode, groupId, pskIdentity, pskKey, userTagValue }) {
  let templateName;
  if (osType === 'windows')        templateName = process.env.DEFAULT_WINDOWS_TEMPLATE     || 'Windows by Zabbix agent active';
  else if (agentMode === 'active') templateName = process.env.DEFAULT_LINUX_ACTIVE_TEMPLATE || 'Linux by Zabbix agent active';
  else                             templateName = process.env.DEFAULT_LINUX_TEMPLATE        || 'Linux by Zabbix agent';

  const templates = await getTemplateIds([templateName]);
  if (!templates.length) throw new Error(`Template "${templateName}" not found.`);

  const params = {
    host: hostName, name: visibleName || hostName,
    interfaces: [{ type:1, main:1, useip:1, ip: ipAddress || '127.0.0.1', dns:'', port:'10050' }],
    groups:    [{ groupid: groupId }],
    templates: templates.map(t => ({ templateid: t.templateid })),
    tags: [
      { tag:'neevcloud_user', value: String(userTagValue) },
      { tag:'managed_by',     value: 'neevcloud' },
    ],
  };

  if (pskIdentity && pskKey) {
    params.tls_connect = 2; params.tls_accept = 2;
    params.tls_psk_identity = pskIdentity; params.tls_psk = pskKey;
  }

  const r = await call('host.create', params);
  return { hostid: r.hostids[0], templateName };
}

async function deleteHost(hostId) { return call('host.delete', [hostId]); }

async function getHostDetails(hostId) {
  const r = await call('host.get', {
    hostids: [hostId],
    output: ['hostid', 'host', 'name', 'status', 'available'],
    selectInterfaces: ['interfaceid', 'ip', 'dns', 'port', 'available', 'error'],
  });
  return r[0] || null;
}

async function getHostLatestData(hostId) {
  return call('item.get', {
    hostids: [hostId],
    output: ['itemid', 'name', 'key_', 'lastvalue', 'units', 'value_type', 'lastclock'],
    sortfield: 'name', limit: 500,
  });
}

/**
 * Get item history or trends.
 * Uses trend.get (singular — correct Zabbix API name) for periods > 3 days.
 */
async function getItemHistory(itemId, valueType, timeFrom, timeTill, limit) {
  const now        = Math.floor(Date.now() / 1000);
  const rangeSecs  = now - timeFrom;
  const canTrend   = (valueType === 0 || valueType === 3);

  if (canTrend && rangeSecs > 3 * 86400) {
    const p = { itemids:[itemId], sortfield:'clock', sortorder:'ASC', limit: limit || 10000 };
    if (timeFrom) p.time_from = timeFrom;
    if (timeTill) p.time_till = timeTill;
    try {
      const trends = await call('trend.get', p);
      if (trends && trends.length > 0) {
        return trends.map(t => ({ clock: t.clock, value: t.value_avg }));
      }
    } catch (e) {
      console.warn('trend.get fallback to history.get:', e.message);
    }
  }

  const p = { itemids:[itemId], history:valueType, sortfield:'clock', sortorder:'ASC', limit: limit || 5000 };
  if (timeFrom) p.time_from = timeFrom;
  if (timeTill) p.time_till = timeTill;
  return call('history.get', p);
}

async function getHostProblems(hostIds) {
  if (!hostIds || !hostIds.length) return [];
  return call('problem.get', {
    hostids: hostIds, output: 'extend', selectTags: 'extend',
    recent: true, sortfield: ['eventid'], sortorder: 'DESC', limit: 300,
  });
}

/**
 * Get real IP of the host's agent.
 *
 * Strategy (tries each in order):
 * 1. net.if.ip[eth0] / net.if.ip[ens3] / net.if.ip[ens4] etc — direct IP items
 * 2. Any item whose key starts with 'net.if.ip[' and has a non-loopback value
 * 3. Parse lastvalue of net.if.discovery if it contains IP info
 * 4. agent.hostname if it looks like an IP
 */
async function getHostRealIP(hostId) {
  try {
    // Step 1: get ALL items for the host and look for IP-bearing ones
    const allItems = await call('item.get', {
      hostids: [hostId],
      output: ['itemid', 'key_', 'lastvalue', 'name'],
      limit: 500,
    });

    // Helper: check if string looks like a valid non-loopback IPv4
    const isRealIPv4 = s => {
      if (!s) return false;
      const trimmed = s.trim();
      if (!trimmed.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) return false;
      if (trimmed === '127.0.0.1' || trimmed.startsWith('169.254')) return false;
      return true;
    };

    // Strategy 1: net.if.ip[*] items
    const ipItems = allItems.filter(m => m.key_.startsWith('net.if.ip['));
    for (const item of ipItems) {
      const v = (item.lastvalue || '').trim();
      // Value might be a single IP or multiple comma-separated
      const parts = v.split(/[\s,;|]+/);
      for (const part of parts) {
        if (isRealIPv4(part)) return part;
      }
    }

    // Strategy 2: look for items named containing "IP address" or "IPv4"
    const namedItems = allItems.filter(m =>
      /ip.?address|ipv4|inet/i.test(m.name) &&
      m.lastvalue && m.lastvalue.length > 0
    );
    for (const item of namedItems) {
      const v = (item.lastvalue || '').trim();
      const parts = v.split(/[\s,;|]+/);
      for (const part of parts) {
        if (isRealIPv4(part)) return part;
      }
    }

    // Strategy 3: look at net.if.discovery - it contains JSON with IPs
    const discovery = allItems.find(m => m.key_ === 'net.if.discovery' && m.lastvalue);
    if (discovery) {
      try {
        const discovered = JSON.parse(discovery.lastvalue);
        // Zabbix discovery format: [{"{#IFNAME}":"eth0", ...}]
        // The actual IPs are in separate items, not here, but we can at least get interface names
      } catch {}
    }

    // Strategy 4: check system.run[hostname -I] or similar
    const hostnameI = allItems.find(m =>
      m.key_.includes('hostname -I') || m.key_.includes('hostname -i')
    );
    if (hostnameI) {
      const parts = (hostnameI.lastvalue || '').trim().split(/\s+/);
      for (const p of parts) {
        if (isRealIPv4(p)) return p;
      }
    }

    // Strategy 5: check if agent.hostname looks like an IP (some setups)
    const agentHost = allItems.find(m => m.key_ === 'agent.hostname' || m.key_ === 'system.hostname');
    if (agentHost && isRealIPv4(agentHost.lastvalue)) {
      return agentHost.lastvalue.trim();
    }

    return null;
  } catch (e) {
    return null;
  }
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
  getHostRealIP,
};
