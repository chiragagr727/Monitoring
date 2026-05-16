/* App shell: sidebar + main content slot. */
const Shell = {
  render(activeRoute, contentHtml) {
    const user = API.getUser() || { full_name: '', email: '' };
    const initials = (user.full_name || user.email || '?').split(/[ @]/).map(s => s[0]).filter(Boolean).slice(0,2).join('').toUpperCase();

    const navItem = (href, label, icon, active) => `
      <a href="${href}" class="${active ? 'active' : ''}">
        <span class="nav-icon">${icon}</span>${label}
      </a>`;

    document.getElementById('app').innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand-mark"><span class="dot"></span> NeevCloud</div>
          <nav class="nav">
            ${navItem('#/', 'Hosts', svg.server, activeRoute === 'hosts')}
            ${navItem('#/alerts', 'Alerts', svg.bell, activeRoute === 'alerts')}
            ${navItem('#/add', 'Add host', svg.plus, activeRoute === 'add')}
          </nav>
          <div class="user-chip" id="user-menu" title="Click to sign out">
            <div class="user-avatar">${initials}</div>
            <div>
              <div class="user-name">${user.full_name || 'User'}</div>
              <div class="user-email">${user.email}</div>
            </div>
          </div>
        </aside>
        <section class="main">${contentHtml}</section>
      </div>
    `;

    document.getElementById('user-menu').onclick = () => {
      if (confirm('Sign out?')) {
        API.clear();
        location.hash = '#/login';
      }
    };
  },
};

const svg = {
  server: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="6" rx="1"/><rect x="2" y="15" width="20" height="6" rx="1"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
};
