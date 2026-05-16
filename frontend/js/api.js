/* Lightweight API client. */
const API = (() => {
  const STORAGE_KEY = 'neev_token';
  const USER_KEY = 'neev_user';

  function getToken() { return localStorage.getItem(STORAGE_KEY); }
  function setToken(t) { localStorage.setItem(STORAGE_KEY, t); }
  function getUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
  function clear() { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(USER_KEY); }

  async function req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(path, {
      ...opts,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const ct = resp.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await resp.json() : await resp.text();
    if (!resp.ok) {
      const msg = (data && data.error) || (typeof data === 'string' ? data : 'Request failed');
      const err = new Error(msg);
      err.status = resp.status;
      err.payload = data;
      if (resp.status === 401) {
        clear();
        location.hash = '#/login';
      }
      throw err;
    }
    return data;
  }

  return {
    getToken, setToken, getUser, setUser, clear,
    login: (email, password) => req('/api/auth/login', { method: 'POST', body: { email, password } }),
    register: (body) => req('/api/auth/register', { method: 'POST', body }),
    me: () => req('/api/auth/me'),

    listHosts: () => req('/api/hosts'),
    addHost: (body) => req('/api/hosts', { method: 'POST', body }),
    getHost: (id) => req('/api/hosts/' + id),
    deleteHost: (id) => req('/api/hosts/' + id, { method: 'DELETE' }),
    getInstall: (id) => req('/api/hosts/' + id + '/install'),
    getHistory: (id, itemId, hours = 2) => req(`/api/hosts/${id}/history?itemid=${itemId}&hours=${hours}`),
    allProblems: () => req('/api/hosts/problems/all'),

    health: () => req('/api/health'),
  };
})();

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'err' ? 'err' : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3000);
  setTimeout(() => el.remove(), 3500);
}
