/* NeevCloud API client — fixed getHistory to pass hours correctly */
const API = (() => {
  const TK = 'neev_token', UK = 'neev_user';

  const getToken = () => localStorage.getItem(TK);
  const setToken = t => localStorage.setItem(TK, t);
  const getUser  = () => { try { return JSON.parse(localStorage.getItem(UK)); } catch { return null; } };
  const setUser  = u => localStorage.setItem(UK, JSON.stringify(u));
  const clear    = () => { localStorage.removeItem(TK); localStorage.removeItem(UK); };

  async function req(path, opts = {}) {
    const hdrs = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const tok = getToken();
    if (tok) hdrs['Authorization'] = 'Bearer ' + tok;
    const resp = await fetch(path, {
      method: opts.method || 'GET',
      headers: hdrs,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const ct = resp.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await resp.json() : await resp.text();
    if (!resp.ok) {
      const msg = (data && data.error) ? data.error : (typeof data === 'string' ? data : 'Request failed');
      const err = new Error(msg); err.status = resp.status;
      if (resp.status === 401) { clear(); location.hash = '#/login'; }
      throw err;
    }
    return data;
  }

  return {
    getToken, setToken, getUser, setUser, clear,
    login:    (email, pw) => req('/api/auth/login',    { method: 'POST', body: { email, password: pw } }),
    register: body        => req('/api/auth/register', { method: 'POST', body }),
    me:       ()          => req('/api/auth/me'),
    listHosts:   ()       => req('/api/hosts'),
    addHost:     body     => req('/api/hosts', { method: 'POST', body }),
    getHost:     id       => req('/api/hosts/' + id),
    deleteHost:  id       => req('/api/hosts/' + id, { method: 'DELETE' }),
    getInstall:  id       => req('/api/hosts/' + id + '/install'),
    // hours: number of hours to look back (1H=1, 6H=6, 1D=24, 1W=168, 1M=720)
    getHistory:  (id, itemId, hours) => req(`/api/hosts/${id}/history?itemid=${itemId}&hours=${hours || 24}`),
    allProblems: ()       => req('/api/hosts/problems/all'),
    health:      ()       => req('/api/health'),
  };
})();

/* Toast notification */
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

/* HTML escape helper — used across all views */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
