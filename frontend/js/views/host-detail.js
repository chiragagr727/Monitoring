/* Host detail view with metrics + charts. */
const HostDetail = {
  chart: null,

  async render(params) {
    const id = params.id;
    Shell.render('hosts', `
      <div class="page-header">
        <div>
          <a href="#/" style="color:var(--text-3);font-size:13px;">← Hosts</a>
          <h1 class="page-title" id="title">Loading…</h1>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-ghost" id="show-install" style="width:auto;">Show install command</button>
          <button class="btn btn-ghost" id="refresh" style="width:auto;">Refresh</button>
          <button class="btn btn-danger" id="delete-host" style="width:auto;color:#fff;">Delete</button>
        </div>
      </div>
      <div id="content"><div class="center-loader"><span class="loader"></span></div></div>
    `);

    document.getElementById('refresh').onclick = () => this.render({ id });
    document.getElementById('delete-host').onclick = async () => {
      if (!confirm('Delete this host? Monitoring data will be removed.')) return;
      try { await API.deleteHost(id); toast('Deleted'); location.hash = '#/'; }
      catch (e) { toast(e.message, 'err'); }
    };
    document.getElementById('show-install').onclick = () => this.showInstall(id);

    try {
      const data = await API.getHost(id);
      this.renderDetail(data, id);
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="empty"><h3>Couldn't load host</h3><p>${e.message}</p></div>`;
    }
  },

  async showInstall(id) {
    try {
      const { install_command } = await API.getInstall(id);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-head">
            <h3>Install command</h3>
            <button class="modal-close" id="x">×</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-2);margin-bottom:14px;">
              Run this on your server (${install_command.type === 'shell' ? 'as root or with sudo' : 'in elevated PowerShell'}):
            </p>
            <div class="install-box">
              <button class="copy-btn" onclick="navigator.clipboard.writeText(\`${install_command.command.replace(/`/g,'\\`')}\`); toast('Copied');">Copy</button>
              ${escapeHtml(install_command.command)}
            </div>
            <div class="callout warn"><strong>Note:</strong> ${install_command.note}</div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.id === 'x') overlay.remove(); });
    } catch (e) { toast(e.message, 'err'); }
  },

  renderDetail(data, id) {
    const { host, zabbix, metrics, problems } = data;
    document.getElementById('title').innerHTML = `${escapeHtml(host.visible_name)}`;

    const iface = zabbix && zabbix.interfaces && zabbix.interfaces[0];
    const isOnline = iface && iface.available === '1';
    const statusPill = isOnline
      ? '<span class="status-pill status-ok"><span class="dot"></span>Online</span>'
      : iface && iface.available === '2'
        ? '<span class="status-pill status-err"><span class="dot"></span>Unreachable</span>'
        : '<span class="status-pill status-pending"><span class="dot"></span>Waiting for agent</span>';

    // Extract key metrics for stat cards
    const find = (keyPattern) => metrics.find(m => m.key_ === keyPattern) ||
                                 metrics.find(m => m.key_.startsWith(keyPattern));
    const cpu = find('system.cpu.util');
    const memUtil = find('vm.memory.utilization');
    const uptime = find('system.uptime');
    const load1 = find('system.cpu.load[all,avg1]') || find('system.cpu.load[percpu,avg1]');

    const fmtUptime = (sec) => {
      if (!sec) return '—';
      const s = parseInt(sec, 10);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
    };

    const fmt = (v, unit) => {
      if (v === null || v === undefined || v === '') return '—';
      const n = parseFloat(v);
      if (isNaN(n)) return v;
      if (unit === 'B' && n > 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      if (unit === '%') return n.toFixed(1) + '%';
      return n.toFixed(2);
    };

    // Pick a default chart item: prefer cpu util
    const defaultChartItem = cpu || memUtil || load1;

    document.getElementById('content').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div style="margin-top:14px;">${statusPill}</div>
          <div class="stat-foot">Interface: ${iface ? iface.ip + ':' + iface.port : '—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">CPU usage</div>
          <div class="stat-value">${cpu ? parseFloat(cpu.lastvalue).toFixed(1) : '—'}<span class="unit">%</span></div>
          <div class="stat-foot">${cpu ? cpu.name : 'No data yet'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Memory</div>
          <div class="stat-value">${memUtil ? parseFloat(memUtil.lastvalue).toFixed(1) : '—'}<span class="unit">%</span></div>
          <div class="stat-foot">${memUtil ? 'Utilization' : 'No data yet'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uptime</div>
          <div class="stat-value" style="font-size:32px;">${fmtUptime(uptime ? uptime.lastvalue : 0)}</div>
          <div class="stat-foot">Since last reboot</div>
        </div>
      </div>

      <div class="detail-grid">
        <div class="panel">
          <h4>Live trend</h4>
          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;" id="chart-selector"></div>
          <div class="chart-wrap"><canvas id="metric-chart"></canvas></div>
        </div>
        <div class="panel">
          <h4>Active problems</h4>
          ${problems.length === 0
            ? '<div style="color:var(--text-3);font-size:13px;padding:20px 0;">No active alerts. All clear.</div>'
            : problems.slice(0, 8).map(p => `
                <div class="metric-row">
                  <div>
                    <div class="metric-name">${escapeHtml(p.name)}</div>
                    <div class="metric-key">severity ${p.severity}</div>
                  </div>
                  <div class="metric-value" style="color:var(--danger);">!</div>
                </div>
              `).join('')}
        </div>
      </div>

      <div class="panel">
        <h4>All metrics (${metrics.length})</h4>
        <div style="max-height:480px;overflow-y:auto;">
          ${metrics.length === 0
            ? '<div style="color:var(--text-3);padding:20px 0;">No metrics yet. If you just installed the agent, give it 1-2 minutes.</div>'
            : metrics.map(m => `
                <div class="metric-row">
                  <div style="min-width:0;flex:1;">
                    <div class="metric-name">${escapeHtml(m.name)}</div>
                    <div class="metric-key">${escapeHtml(m.key_)}</div>
                  </div>
                  <div class="metric-value">${m.lastvalue || '—'} ${m.units || ''}</div>
                </div>
              `).join('')}
        </div>
      </div>
    `;

    this.renderChartSelector(id, metrics, defaultChartItem);
    if (defaultChartItem) this.loadChart(id, defaultChartItem.itemid, defaultChartItem.name);
  },

  renderChartSelector(hostId, metrics, defaultItem) {
    const candidates = [];
    const keyMatch = (m, k) => m.key_ === k || m.key_.startsWith(k);
    const findM = (k) => metrics.find(m => keyMatch(m, k));
    [
      { key: 'system.cpu.util', label: 'CPU' },
      { key: 'vm.memory.utilization', label: 'Memory' },
      { key: 'system.cpu.load[all,avg1]', label: 'Load 1m' },
      { key: 'system.cpu.load[percpu,avg1]', label: 'Load /cpu' },
    ].forEach(c => {
      const found = findM(c.key);
      if (found) candidates.push({ ...c, item: found });
    });

    const sel = document.getElementById('chart-selector');
    if (!sel) return;
    sel.innerHTML = candidates.map((c, i) => `
      <button class="btn btn-ghost btn-sm" data-item="${c.item.itemid}" data-name="${escapeHtml(c.label)}"
        style="${defaultItem && defaultItem.itemid === c.item.itemid ? 'background:var(--bg-3);border-color:var(--accent);' : ''}">
        ${c.label}
      </button>
    `).join('');

    sel.querySelectorAll('[data-item]').forEach(btn => {
      btn.onclick = () => {
        sel.querySelectorAll('button').forEach(b => b.style.cssText = '');
        btn.style.cssText = 'background:var(--bg-3);border-color:var(--accent);';
        this.loadChart(hostId, btn.dataset.item, btn.dataset.name);
      };
    });
  },

  async loadChart(hostId, itemId, label) {
    try {
      const { history, item } = await API.getHistory(hostId, itemId, 2);
      const labels = history.map(h => new Date(h.clock * 1000).toLocaleTimeString());
      const data = history.map(h => parseFloat(h.value));
      const ctx = document.getElementById('metric-chart');
      if (!ctx) return;
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: label + (item.units ? ` (${item.units})` : ''),
            data,
            borderColor: '#7fffaa',
            backgroundColor: 'rgba(127,255,170,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#c0c5d1' } },
          },
          scales: {
            x: { ticks: { color: '#7d8595', maxTicksLimit: 8 }, grid: { color: '#2a3142' } },
            y: { ticks: { color: '#7d8595' }, grid: { color: '#2a3142' } },
          },
        },
      });
    } catch (e) {
      toast('Chart load failed: ' + e.message, 'err');
    }
  },
};
