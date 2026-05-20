/* App shell — logo is now transparent PNG, no blend mode needed */
const Shell = {
  icons: {
    server: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="6" rx="1"/><rect x="2" y="15" width="20" height="6" rx="1"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
    bell:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
    plus:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    trash:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
  },

  render(active, html) {
    const u = API.getUser() || {};
    const initials = ((u.full_name || u.email || '?')
      .split(/[\s@]/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase());

    document.getElementById('app').innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <!-- Transparent PNG logo — works directly on dark background -->
          <div class="sidebar-logo">
            <img src="/img/neevcloud-logo.png" alt="NeevCloud"
                 style="height:28px;width:auto;max-width:155px;object-fit:contain;display:block;"
                 onerror="this.style.display='none';document.getElementById('logo-fb').style.display='flex';" />
            <div id="logo-fb" style="display:none;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#f0f2f5;letter-spacing:-.01em;">
              <span style="width:8px;height:8px;border-radius:50%;background:#5bffaa;animation:pulse 2.5s infinite;flex-shrink:0;"></span>
              neevcloud
            </div>
          </div>

          <nav class="nav">
            <a href="#/" class="${active === 'hosts'  ? 'active' : ''}">
              ${this.icons.server} Hosts
            </a>
            <a href="#/alerts" class="${active === 'alerts' ? 'active' : ''}">
              ${this.icons.bell} Alerts
            </a>
            <a href="#/add" class="${active === 'add' ? 'active' : ''}">
              ${this.icons.plus} Add host
            </a>
          </nav>

          <div class="sidebar-footer" id="usermenu" title="Sign out">
            <div class="avatar">${initials}</div>
            <div class="user-info">
              <div class="name">${esc(u.full_name || 'User')}</div>
              <div class="email">${esc(u.email || '')}</div>
            </div>
          </div>
        </aside>
        <section class="main">${html}</section>
      </div>
    `;

    document.getElementById('usermenu').onclick = () => {
      if (confirm('Sign out of NeevCloud Monitoring?')) {
        API.clear(); location.hash = '#/login';
      }
    };
  },
};

const TRASH_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
