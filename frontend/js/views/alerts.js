const AlertsView = {
  async render() {
    Shell.render('alerts', `
      <div class="page-header">
        <div>
          <h1 class="page-title"><em>Active</em> alerts</h1>
          <p class="page-sub">Live problems detected on your hosts.</p>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost btn-sm" id="btn-refresh">↻ Refresh</button>
        </div>
      </div>
      <div id="content"><div class="c-loader"><span class="spin"></span></div></div>
    `);
    document.getElementById('btn-refresh').onclick = () => this.render();

    try {
      const { problems, host_names } = await API.allProblems();
      const el = document.getElementById('content');

      if (!problems || problems.length === 0) {
        el.innerHTML = `
          <div class="empty">
            <h3>All clear ✓</h3>
            <p>No active problems on any of your hosts right now.</p>
          </div>`;
        return;
      }

      const SEV = { 0:'Not classified', 1:'Info', 2:'Warning', 3:'Average', 4:'High', 5:'Disaster' };
      const BDR = { 5:'var(--red)', 4:'#ff6b38', 3:'#ffd84a', 2:'var(--orange)', 1:'var(--blue)', 0:'var(--t3)' };

      el.innerHTML = `
        <div style="margin-bottom:12px;color:var(--t3);font-size:13px;">
          ${problems.length} active problem${problems.length !== 1 ? 's' : ''} across your hosts
        </div>
        ${problems.map(p => {
          const t = new Date(parseInt(p.clock, 10) * 1000).toLocaleString();
          const hostName = host_names[p.objectid] || host_names[p.hosts?.[0]?.hostid] || '';
          const sev = SEV[p.severity] || 'Severity ' + p.severity;
          return `
            <div class="alert-card" style="border-left-color:${BDR[p.severity]||'var(--t3)'};">
              <div>
                <div class="alert-name">${esc(p.name)}</div>
                <div class="alert-meta">${sev} · ${t}${hostName ? ' · ' + esc(hostName) : ''}</div>
              </div>
              <span class="pill pill-err" style="font-size:10px;">${sev}</span>
            </div>`;
        }).join('')}
      `;
    } catch (e) {
      document.getElementById('content').innerHTML =
        `<div class="empty"><h3>Could not load alerts</h3><p>${esc(e.message)}</p></div>`;
    }
  },
};
