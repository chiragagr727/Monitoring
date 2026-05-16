/* Tiny hash-based router. */
const Router = (() => {
  const routes = [];

  function on(pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ pattern, re, keys, handler });
  }

  function navigate(path) {
    if (location.hash !== '#' + path) location.hash = '#' + path;
    else resolve();
  }

  function resolve() {
    const hash = location.hash.replace(/^#/, '') || '/';
    for (const r of routes) {
      const m = hash.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => params[k] = m[i + 1]);
        r.handler(params);
        return;
      }
    }
    // Fallback
    if (routes.length) routes[0].handler({});
  }

  window.addEventListener('hashchange', resolve);
  return { on, navigate, resolve };
})();
