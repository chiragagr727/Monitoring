const Dashboard = {
  async render() {
    Shell.render('hosts', `
      <div class="page-header">
        <div>
          <h1 class="page-title">Your <em>fleet</em></h1>
          <p class="page-sub">All servers registered for monitoring.</p>
        </div>
        <div class="page-header-actions">
          <a href="#/add" class="btn btn-primary" style="text-decoration:none;">+ Add host</a>
        </div>
      </div>
      <div id="content"><div class="c-loader"><span class="spin"></span></div></div>
    `);

    try {
      const [{ hosts }, prRes] = await Promise.all([
        API.listHosts(),
        API.allProblems().catch(() => ({ problems: [] })),
      ]);
      this._render(hosts, (prRes.problems || []).length);
    } catch (e) {
      document.getElementById('content').innerHTML =
        `<div class="empty"><h3>Could not load hosts</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  _render(hosts, problemCount) {
    const el = document.getElementById('content');
    if (!hosts || hosts.length === 0) {
      el.innerHTML = `
        <div class="empty">
          <h3>No hosts yet</h3>
          <p>Add your first server to start collecting CPU, RAM, storage, uptime and alert data in real time.</p>
          <a href="#/add" class="btn btn-primary" style="display:inline-flex;text-decoration:none;margin-top:8px;">+ Add your first host</a>
        </div>`;
      return;
    }

    const online  = hosts.filter(h => h.zabbix?.interfaces?.[0]?.available === '1').length;
    const waiting = hosts.length - online;

    el.innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;">
        <div class="stat-card">
          <div class="stat-label">Total hosts</div>
          <div class="stat-val">${hosts.length}</div>
          <div class="stat-foot">Registered</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Online</div>
          <div class="stat-val ok">${online}</div>
          <div class="stat-foot">Agents reporting</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Waiting</div>
          <div class="stat-val warn">${waiting}</div>
          <div class="stat-foot">Run install command</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Alerts</div>
          <div class="stat-val ${problemCount > 0 ? 'crit' : ''}">${problemCount}</div>
          <div class="stat-foot"><a href="#/alerts">View alerts →</a></div>
        </div>
      </div>

      <table class="host-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>OS / Mode</th>
            <th>Status</th>
            <th>Added</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${hosts.map(h => this._row(h)).join('')}
        </tbody>
      </table>
    `;

    el.querySelectorAll('[data-hid]').forEach(tr => {
      tr.onclick = e => {
        if (e.target.closest('button')) return;
        location.hash = '#/host/' + tr.dataset.hid;
      };
    });

    el.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        if (!confirm('Delete this host and remove it from monitoring?')) return;
        btn.disabled = true;
        try {
          await API.deleteHost(btn.dataset.del);
          toast('Host deleted');
          Dashboard.render();
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
      };
    });
  },

  _row(h) {
    const iface = h.zabbix?.interfaces?.[0];
    let pill;
    if (!h.zabbix)                    pill = `<span class="pill pill-warn"><span class="dot"></span>Unknown</span>`;
    else if (iface?.available === '1') pill = `<span class="pill pill-ok"><span class="dot"></span>Online</span>`;
    else if (iface?.available === '2') pill = `<span class="pill pill-err"><span class="dot"></span>Unreachable</span>`;
    else                               pill = `<span class="pill pill-warn"><span class="dot"></span>Waiting</span>`;

    const osLabel = h.os_type === 'windows' ? 'Windows' : 'Linux';
    const created = new Date(h.created_at + 'Z').toLocaleDateString();

    return `
      <tr data-hid="${h.id}">
        <td><div class="hn">${esc(h.visible_name)}</div><div class="hm">${esc(h.host_name)}</div></td>
        <td>${osLabel}<div class="hm">${h.agent_mode}</div></td>
        <td>${pill}</td>
        <td style="color:var(--t3);font-size:12px;">${created}</td>
        <td><button class="btn btn-ghost btn-sm" data-del="${h.id}" title="Delete">${TRASH_ICON}</button></td>
      </tr>`;
  },
};
