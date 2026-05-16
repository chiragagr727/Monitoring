/* Login + Register screen. */
const LoginView = {
  render(mode = 'login') {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="auth-wrap">
        <aside class="auth-hero">
          <div class="auth-hero-content">
            <div class="brand-mark"><span class="dot"></span> NeevCloud</div>
            <h1 class="hero-headline">Infrastructure, <em>watched</em>.</h1>
            <p class="hero-sub">
              Add a server in seconds. We hand you one command — paste, run, done.
              CPU, memory, storage, temperature, uptime: all streaming in
              under two minutes, end-to-end encrypted via PSK.
            </p>
          </div>
          <div class="hero-foot">
            <span>Zabbix 7.4 backed</span>
            <span>PSK-encrypted</span>
            <span>Multi-tenant</span>
          </div>
        </aside>
        <main class="auth-form-wrap">
          <div class="auth-card">
            <h2>${mode === 'login' ? 'Sign in' : 'Create account'}</h2>
            <p class="sub">${mode === 'login' ? 'Welcome back to your monitoring console.' : 'Get started monitoring your fleet.'}</p>
            <div id="form-err"></div>
            <form id="auth-form">
              ${mode === 'register' ? `
                <div class="field"><label>Full name</label><input name="full_name" required /></div>
                <div class="field"><label>Company</label><input name="company" /></div>
              ` : ''}
              <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email" /></div>
              <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" /></div>
              <button type="submit" class="btn btn-primary" id="submit-btn">
                ${mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            <div class="auth-toggle">
              ${mode === 'login'
                ? `No account? <a href="#/register">Create one</a>`
                : `Already have an account? <a href="#/login">Sign in</a>`}
            </div>
          </div>
        </main>
      </div>
    `;

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      try {
        const res = mode === 'login' ? await API.login(body.email, body.password) : await API.register(body);
        API.setToken(res.token);
        API.setUser(res.user);
        location.hash = '#/';
      } catch (err) {
        const el = document.getElementById('form-err');
        el.innerHTML = `<div class="form-error">${err.message}</div>`;
        btn.disabled = false; btn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      }
    });
  },
};
