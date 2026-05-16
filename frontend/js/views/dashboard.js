/* Dashboard - list of user's hosts. */
const Dashboard = {
  async render() {
    Shell.render('hosts', `
      <div class="page-header">
        <div>
          <h1 class="page-title">Your <em>fleet</em></h1>
          <div class="page-sub">All servers you've added to NeevCloud Monitoring.</div>
        </div>
        <a href="#/add" class="btn btn-primary" style="width:auto">
          + Add host
        </a>
      </div>
      <div id="content"><div class="center-loader"><span class="loader"></span></div></div>
    `);

    try {
      const [{ hosts }, problemsRes] = await Promise.all([
        API.listHosts(),
        API.allProblems().catch(() => ({ problems: [] })),
      ]);
      const problemCount = (problemsRes.problems || []).length;
      this.renderContent(hosts, problemCount);
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="empty"><h3>Couldn't load hosts</h3><p>${e.message}</p></div>`;
    }
  },

  renderContent(hosts, problemCount) {
    const container = document.getElementById('content');

    if (!hosts || hosts.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <h3>No hosts yet</h3>
          <p>Add your first server to start receiving CPU, memory, storage, and uptime metrics in real time.</p>
          <a href="#/add" class="btn btn-primary" style="width:auto; display:inline-flex;">+ Add your first host</a>
        </div>
      `;
      return;
    }

    const okCount = hosts.filter(h => h.zabbix && h.zabbix.interfaces && h.zabbix.interfaces[0] && h.zabbix.interfaces[0].available === '1').length;
    const pendingCount = hosts.length - okCount;

    container.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Total hosts</div>
          <div class="stat-value">${hosts.length}</div>
          <div class="stat-foot">Servers registered for monitoring</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Online</div>
          <div class="stat-value" style="color:var(--accent)">${okCount}</div>
          <div class="stat-foot">Agents reporting healthy</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Awaiting agent</div>
          <div class="stat-value" style="color:var(--accent-warm)">${pendingCount}</div>
          <div class="stat-foot">Run the install command on these</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active alerts</div>
          <div class="stat-value" style="color:${problemCount > 0 ? 'var(--danger)' : 'var(--text-1)'}">${problemCount}</div>
          <div class="stat-foot"><a href="#/alerts">View alerts →</a></div>
        </div>
      </div>

      <div class="section-title">Hosts</div>
      <table class="host-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>OS / Mode</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${hosts.map(h => this.hostRow(h)).join('')}
        </tbody>
      </table>
    `;

    // Wire up clicks
    container.querySelectorAll('[data-host-id]').forEach(tr => {
      tr.onclick = (e) => {
        if (e.target.closest('button')) return;
        location.hash = '#/host/' + tr.dataset.hostId;
      };
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        if (!confirm('Delete this host? Monitoring data and config will be removed.')) return;
        try {
          await API.deleteHost(id);
          toast('Host deleted');
          Dashboard.render();
        } catch (err) { toast(err.message, 'err'); }
      };
    });
  },

  hostRow(h) {
    const iface = h.zabbix && h.zabbix.interfaces && h.zabbix.interfaces[0];
    let pill, dotClass;
    if (!h.zabbix) {
      pill = 'Unknown'; dotClass = 'status-pending';
    } else if (iface && iface.available === '1') {
      pill = 'Online'; dotClass = 'status-ok';
    } else if (iface && iface.available === '2') {
      pill = 'Unreachable'; dotClass = 'status-err';
    } else {
      pill = 'Waiting for agent'; dotClass = 'status-pending';
    }

    const created = new Date(h.created_at + 'Z').toLocaleString();

    return `
      <tr data-host-id="${h.id}">
        <td>
          <div class="host-name">${escapeHtml(h.visible_name)}</div>
          <div class="host-meta">${h.host_name}</div>
        </td>
        <td>
          ${h.os_type === 'linux' ? 'Linux' : 'Windows'}
          <div class="host-meta">${h.agent_mode}</div>
        </td>
        <td><span class="status-pill ${dotClass}"><span class="dot"></span>${pill}</span></td>
        <td style="color:var(--text-3);font-size:13px;">${created}</td>
        <td>
          <button class="btn btn-ghost btn-sm" data-delete="${h.id}" title="Delete host">${svg.trash}</button>
        </td>
      </tr>
    `;
  },
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
