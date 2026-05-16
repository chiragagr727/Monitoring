/* Alerts view - all active problems across the user's hosts. */
const Alerts = {
  async render() {
    Shell.render('alerts', `
      <div class="page-header">
        <div>
          <h1 class="page-title"><em>Active</em> alerts</h1>
          <div class="page-sub">Problems currently active on your hosts. Pulled live from Zabbix.</div>
        </div>
        <button class="btn btn-ghost" id="refresh" style="width:auto;">Refresh</button>
      </div>
      <div id="content"><div class="center-loader"><span class="loader"></span></div></div>
    `);
    document.getElementById('refresh').onclick = () => this.render();

    try {
      const { problems, host_names } = await API.allProblems();
      const content = document.getElementById('content');
      if (!problems || problems.length === 0) {
        content.innerHTML = `
          <div class="empty">
            <h3>All clear</h3>
            <p>No active problems detected on any of your hosts. We'll show alerts here as soon as Zabbix raises them.</p>
          </div>
        `;
        return;
      }

      // Group by severity
      const sev = { 5: 'Disaster', 4: 'High', 3: 'Average', 2: 'Warning', 1: 'Information', 0: 'Not classified' };
      content.innerHTML = problems.map(p => {
        const time = new Date(parseInt(p.clock, 10) * 1000).toLocaleString();
        // Resolve host via tags or hostids in event (problem.get returns object_eventid etc)
        const hostId = (p.hosts && p.hosts[0] && p.hosts[0].hostid) || '';
        const hostName = host_names[hostId] || '';
        return `
          <div class="alert-card sev-${p.severity}">
            <div>
              <div class="alert-name">${escapeHtml(p.name)}</div>
              <div class="alert-meta">${sev[p.severity] || 'Severity ' + p.severity} · started ${time} ${hostName ? '· ' + escapeHtml(hostName) : ''}</div>
            </div>
            <div>
              <span class="status-pill status-err"><span class="dot"></span>${sev[p.severity] || p.severity}</span>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="empty"><h3>Couldn't load alerts</h3><p>${e.message}</p></div>`;
    }
  },
};
