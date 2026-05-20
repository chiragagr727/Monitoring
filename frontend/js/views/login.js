const LoginView = {
  render(mode = 'login') {
    document.getElementById('app').innerHTML = `
      <div class="auth-wrap">
        <aside class="auth-hero">
          <!-- Transparent PNG logo -->
          <div style="height:50px;display:flex;align-items:center;">
            <img src="/img/neevcloud-logo.png" alt="NeevCloud"
                 style="height:44px;width:auto;max-width:240px;object-fit:contain;"
                 onerror="this.style.display='none';document.getElementById('auth-logo-fb').style.display='flex';" />
            <div id="auth-logo-fb" style="display:none;align-items:center;gap:8px;font-size:20px;font-weight:700;color:#f0f2f5;">
              <span style="width:9px;height:9px;border-radius:50%;background:#5bffaa;flex-shrink:0;"></span>
              neevcloud
            </div>
          </div>

          <div class="hero-text">
            <h1>Infrastructure,<br><em>watched.</em></h1>
            <p>Add any server in under two minutes. One command on your machine —
               CPU, RAM, storage, uptime, and network start flowing instantly,
               end-to-end encrypted.</p>
          </div>

          <div class="hero-tags">
            <span>Real-time monitoring</span>
            <span>PSK encrypted</span>
            <span>Multi-tenant</span>
            <span>Linux + Windows</span>
          </div>
        </aside>

        <main class="auth-form-side">
          <div class="auth-card">
            <h2>${mode === 'login' ? 'Sign in' : 'Create account'}</h2>
            <p class="sub">${mode === 'login'
              ? 'Welcome back to your monitoring console.'
              : 'Start monitoring your servers today.'}</p>
            <div id="ferr"></div>
            <form id="aform">
              ${mode === 'register' ? `
                <div class="field"><label>Full name</label><input name="full_name" placeholder="Jane Smith" /></div>
                <div class="field"><label>Company</label><input name="company" placeholder="Acme Corp" /></div>
              ` : ''}
              <div class="field">
                <label>Email</label>
                <input name="email" type="email" required autocomplete="email" />
              </div>
              <div class="field">
                <label>Password</label>
                <input name="password" type="password" required
                  autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" />
              </div>
              <button type="submit" class="btn btn-primary btn-full" id="sbtn">
                ${mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            <div class="auth-switch">
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
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      const body = Object.fromEntries(new FormData(e.target));
      try {
        const r = mode === 'login'
          ? await API.login(body.email, body.password)
          : await API.register(body);
        API.setToken(r.token); API.setUser(r.user);
        location.hash = '#/';
      } catch (err) {
        document.getElementById('ferr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      }
    };
  },
};
