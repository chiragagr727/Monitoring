const LoginView = {
  render(mode = 'login') {
    document.getElementById('app').innerHTML = `
      <div class="auth-wrap">
        <aside class="auth-hero">
          <div class="auth-hero-content">
            <!-- NeevCloud Logo on login page -->
            <div class="brand-mark">
              <img src="/img/neevcloud-logo.png" alt="NeevCloud" class="brand-logo brand-logo-lg"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
              <span style="display:none;align-items:center;gap:10px;font-family:var(--serif);font-size:26px;">
                <span class="dot"></span>NeevCloud
              </span>
            </div>
            <h1 class="hero-headline">Infrastructure,<br><em>watched.</em></h1>
            <p class="hero-sub">
              Add any server in under two minutes. One command on your machine —
              CPU, RAM, storage, uptime, and temperature start flowing to your
              dashboard instantly, end-to-end PSK encrypted.
            </p>
          </div>
          <div class="hero-foot">
            <span>Zabbix 7.4</span>
            <span>PSK encrypted</span>
            <span>Multi-tenant</span>
            <span>Linux + Windows</span>
          </div>
        </aside>
        <main class="auth-form-wrap">
          <div class="auth-card">
            <h2>${mode === 'login' ? 'Sign in' : 'Create account'}</h2>
            <p class="sub">${mode === 'login' ? 'Welcome back to your monitoring console.' : 'Start monitoring your servers today.'}</p>
            <div id="ferr"></div>
            <form id="aform">
              ${mode === 'register' ? `
                <div class="field"><label>Full name</label><input name="full_name" placeholder="Jane Smith" /></div>
                <div class="field"><label>Company</label><input name="company" placeholder="Acme Corp" /></div>
              ` : ''}
              <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email" /></div>
              <div class="field"><label>Password</label><input name="password" type="password" required
                autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" /></div>
              <button type="submit" class="btn btn-primary" id="sbtn" style="width:100%;">
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

    document.getElementById('aform').onsubmit = async e => {
      e.preventDefault();
      const btn = document.getElementById('sbtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loader"></span>';
      const body = Object.fromEntries(new FormData(e.target));
      try {
        const r = mode === 'login'
          ? await API.login(body.email, body.password)
          : await API.register(body);
        API.setToken(r.token);
        API.setUser(r.user);
        location.hash = '#/';
      } catch (err) {
        document.getElementById('ferr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      }
    };
  },
};
