/* App shell — sidebar + content slot — with NeevCloud logo */
const ICONS = {
  server: `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="6" rx="1"/><rect x="2" y="15" width="20" height="6" rx="1"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
  bell:   `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  plus:   `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  trash:  `<svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
};

const Shell = {
  render(active, html) {
    const u = API.getUser() || {};
    const initials = ((u.full_name || u.email || '?')
      .split(/[\s@]/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase());

    document.getElementById('app').innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <!-- NeevCloud Logo -->
          <div class="brand-mark" style="padding:0 8px 20px;border-bottom:1px solid var(--line);margin-bottom:16px;">
            <img src="/img/neevcloud-logo.png" alt="NeevCloud" class="brand-logo"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
            <span style="display:none;align-items:center;gap:8px;font-family:var(--serif);font-size:20px;">
              <span class="dot" style="width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent);"></span>
              NeevCloud
            </span>
          </div>

          <nav class="nav">
            <a href="#/" class="${active === 'hosts' ? 'active' : ''}">
              ${ICONS.server} Hosts
            </a>
            <a href="#/alerts" class="${active === 'alerts' ? 'active' : ''}">
              ${ICONS.bell} Alerts
            </a>
            <a href="#/add" class="${active === 'add' ? 'active' : ''}">
              ${ICONS.plus} Add host
            </a>
          </nav>

          <div class="user-chip" id="usermenu" title="Click to sign out">
            <div class="user-avatar">${initials}</div>
            <div>
              <div class="user-name">${esc(u.full_name || 'User')}</div>
              <div class="user-email">${esc(u.email || '')}</div>
            </div>
          </div>
        </aside>
        <section class="main">${html}</section>
      </div>
    `;

    document.getElementById('usermenu').onclick = () => {
      if (confirm('Sign out of NeevCloud?')) { API.clear(); location.hash = '#/login'; }
    };
  },
};
