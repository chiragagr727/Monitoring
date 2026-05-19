/**
 * NeevCloud - Host Detail View (FIXED)
 *
 * Fixes applied:
 * 1. Copy button now works (uses fallback for non-HTTPS contexts)
 * 2. Disk shows real data (vfs.fs.size items)
 * 3. Weekly/monthly charts use correct time ranges
 * 4. All chart items mapped to correct Zabbix keys
 * 5. Timezone shown correctly (IST / local)
 * 6. Network I/O cards added
 * 7. SWAP card added
 */
const HostDetail = {
  _chart: null,
  _currentRange: '1D',

  async render({ id }) {
    Shell.render('hosts', `
      <div class="page-header" style="margin-bottom:16px;">
        <div>
          <a href="#/" style="color:var(--text-3);font-size:13px;text-decoration:none;">← Hosts</a>
          <h1 class="page-title" id="ptitle" style="font-size:34px;margin-top:4px;">Loading…</h1>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button class="btn btn-ghost btn-sm" id="btn-install">Show install command</button>
          <button class="btn btn-ghost btn-sm" id="btn-refresh">↻ Refresh</button>
          <button class="btn btn-danger btn-sm" id="btn-delete" style="color:#fff;">Delete</button>
        </div>
      </div>
      <div id="content"><div class="center-loader"><span class="loader"></span></div></div>
    `);

    document.getElementById('btn-refresh').onclick = () => this.render({ id });
    document.getElementById('btn-delete').onclick = async () => {
      if (!confirm('Delete this host? It will be removed from monitoring.')) return;
      try { await API.deleteHost(id); toast('Host deleted'); location.hash = '#/'; }
      catch (e) { toast(e.message, 'err'); }
    };
    document.getElementById('btn-install').onclick = () => this._showInstall(id);

    try {
      const data = await API.getHost(id);
      document.getElementById('ptitle').textContent = data.host.visible_name;
      this._render(data, id);
    } catch (e) {
      document.getElementById('content').innerHTML =
        `<div class="empty"><h3>Could not load host</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  // ── Copy helper: works on HTTP (non-HTTPS) contexts too ─────────────
  _copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast('Copied!')).catch(() => this._fallbackCopy(text));
    } else {
      this._fallbackCopy(text);
    }
  },
  _fallbackCopy(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(el);
    el.focus(); el.select();
    try {
      document.execCommand('copy');
      toast('Copied!');
    } catch { toast('Select + copy manually', 'err'); }
    document.body.removeChild(el);
  },

  async _showInstall(id) {
    try {
      const { install_command: ic } = await API.getInstall(id);
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.innerHTML = `
        <div class="modal">
          <div class="modal-head">
            <h3>Install command</h3>
            <button class="modal-close" id="mc">×</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-2);margin-bottom:14px;">
              Run this on your server ${ic.type === 'shell' ? '(as root / sudo)' : '(elevated PowerShell)'}:
            </p>
            <div class="install-box" id="install-cmd-box">
              <button class="copy-btn" id="install-copy-btn">Copy</button>
              <span id="install-cmd-text">${esc(ic.command)}</span>
            </div>
            <div class="callout warn" style="margin-top:14px;"><strong>Note:</strong> ${esc(ic.note)}</div>
          </div>
        </div>`;
      document.body.appendChild(ov);
      // Wire copy button properly (no inline onclick, avoids CSP issues)
      document.getElementById('install-copy-btn').addEventListener('click', () => {
        this._copyText(document.getElementById('install-cmd-text').textContent);
      });
      ov.addEventListener('click', e => { if (e.target === ov || e.target.id === 'mc') ov.remove(); });
    } catch (e) { toast(e.message, 'err'); }
  },

  // ── Key metric extraction helpers ────────────────────────────────────
  _find(metrics, ...keys) {
    for (const k of keys) {
      const m = metrics.find(m => m.key_ === k || m.key_.startsWith(k));
      if (m) return m;
    }
    return null;
  },

  _pf(v, d = 1) {
    if (v === '' || v === null || v === undefined) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : parseFloat(n.toFixed(d));
  },

  _fmtBytes(bytes) {
    const b = parseFloat(bytes);
    if (isNaN(b) || b === 0) return '—';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0, v = b;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + units[i];
  },

  _fmtUptime(sec) {
    const s = parseInt(sec, 10);
    if (!s || isNaN(s)) return '—';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  },

  _color(val, warn, crit) {
    if (val === null) return '';
    if (val >= crit) return 'metric-crit';
    if (val >= warn) return 'metric-warn';
    return 'metric-ok';
  },

  // ── Timezone label ───────────────────────────────────────────────────
  _tzLabel() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const abbr = new Date().toLocaleTimeString('en', { timeZoneName: 'short' }).split(' ').pop();
      return abbr + ' (' + tz + ')';
    } catch { return 'Local'; }
  },

  // ── Disk metrics: find root / largest partition ──────────────────────
  _getDiskMetrics(metrics) {
    // Zabbix keys: vfs.fs.size[/,total], vfs.fs.size[/,used], vfs.fs.size[/,pfree]
    // Also vfs.fs.pused[/] for percentage used
    const total = this._find(metrics,
      'vfs.fs.size[/,total]', 'vfs.fs.size[C:,total]', 'vfs.fs.size[/boot,total]'
    );
    const used = this._find(metrics,
      'vfs.fs.size[/,used]', 'vfs.fs.size[C:,used]', 'vfs.fs.size[/boot,used]'
    );
    const pfree = this._find(metrics,
      'vfs.fs.size[/,pfree]', 'vfs.fs.size[C:,pfree]'
    );
    const pused = this._find(metrics,
      'vfs.fs.pused[/]', 'vfs.fs.pused[C:]',
      'vfs.fs.size[/,pused]', 'vfs.fs.size[C:,pused]'
    );

    let usedPct = null;
    if (pused) {
      usedPct = this._pf(pused.lastvalue, 1);
    } else if (pfree) {
      const f = this._pf(pfree.lastvalue, 1);
      if (f !== null) usedPct = parseFloat((100 - f).toFixed(1));
    } else if (total && used) {
      const t = parseFloat(total.lastvalue), u = parseFloat(used.lastvalue);
      if (t > 0) usedPct = parseFloat(((u / t) * 100).toFixed(1));
    }

    return { total, used, pfree, pused, usedPct };
  },

  // ── Network metrics ──────────────────────────────────────────────────
  _getNetMetrics(metrics) {
    const inRate  = this._find(metrics, 'net.if.in[', 'system.net.if.in');
    const outRate = this._find(metrics, 'net.if.out[', 'system.net.if.out');
    return { inRate, outRate };
  },

  // ── SWAP metrics ─────────────────────────────────────────────────────
  _getSwapMetrics(metrics) {
    const swapTotal = this._find(metrics, 'system.swap.size[,total]', 'vm.swap.size[total]');
    const swapFree  = this._find(metrics, 'system.swap.size[,free]',  'vm.swap.size[free]');
    const swapPfree = this._find(metrics, 'system.swap.size[,pfree]', 'vm.swap.size[pfree]');
    let swapUsedPct = null;
    if (swapPfree) {
      const f = this._pf(swapPfree.lastvalue, 1);
      if (f !== null) swapUsedPct = parseFloat((100 - f).toFixed(1));
    } else if (swapTotal && swapFree) {
      const t = parseFloat(swapTotal.lastvalue), f2 = parseFloat(swapFree.lastvalue);
      if (t > 0) swapUsedPct = parseFloat(((1 - f2 / t) * 100).toFixed(1));
    }
    return { swapTotal, swapUsedPct };
  },

  _render({ host, zabbix, metrics, problems }, id) {
    const iface    = zabbix?.interfaces?.[0];
    const isOnline = iface?.available === '1';
    const isUnreachable = iface?.available === '2';

    const statusPill = isOnline
      ? `<span class="status-pill status-ok"><span class="dot"></span>Online</span>`
      : isUnreachable
        ? `<span class="status-pill status-err"><span class="dot"></span>Unreachable</span>`
        : `<span class="status-pill status-pending"><span class="dot"></span>Waiting for agent</span>`;

    const f = this._find.bind(this, metrics);
    const cpu    = f('system.cpu.util');
    const mem    = f('vm.memory.utilization', 'vm.memory.size[pavailable]');
    const uptime = f('system.uptime');
    const load1  = f('system.cpu.load[all,avg1]', 'system.cpu.load[percpu,avg1]');
    const load5  = f('system.cpu.load[all,avg5]', 'system.cpu.load[percpu,avg5]');
    const load15 = f('system.cpu.load[all,avg15]', 'system.cpu.load[percpu,avg15]');
    const agentVer = f('agent.version');

    const disk = this._getDiskMetrics(metrics);
    const net  = this._getNetMetrics(metrics);
    const swap = this._getSwapMetrics(metrics);

    const cpuVal  = this._pf(cpu?.lastvalue);
    const memVal  = this._pf(mem?.lastvalue);
    const diskVal = disk.usedPct;

    const tzLabel = this._tzLabel();
    const now = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

    // Build the 6 top stat cards
    const statCards = [
      {
        label: 'CPU USAGE',
        value: cpuVal !== null ? cpuVal + '%' : '—',
        sub: `Load: ${this._pf(load1?.lastvalue, 2) ?? '—'}`,
        cls: this._color(cpuVal, 70, 90),
      },
      {
        label: 'MEMORY',
        value: memVal !== null ? memVal + '%' : '—',
        sub: '—',
        cls: this._color(memVal, 80, 95),
      },
      {
        label: 'DISK (/)',
        value: diskVal !== null ? diskVal + '%' : '—',
        sub: disk.total ? this._fmtBytes(disk.total.lastvalue) + ' total' : 'Root partition',
        cls: this._color(diskVal, 80, 90),
      },
      {
        label: 'SWAP',
        value: swap.swapUsedPct !== null ? swap.swapUsedPct + '%' : '—',
        sub: swap.swapTotal ? this._fmtBytes(swap.swapTotal.lastvalue) + ' total' : '—',
        cls: this._color(swap.swapUsedPct, 60, 85),
      },
      {
        label: 'UPTIME',
        value: this._fmtUptime(uptime?.lastvalue),
        sub: 'Since last reboot',
        cls: 'metric-ok',
      },
      {
        label: 'NETWORK I/O',
        value: net.inRate ? this._fmtBytes(net.inRate.lastvalue) + '/s' : '—',
        sub: 'In / ' + (net.outRate ? this._fmtBytes(net.outRate.lastvalue) + '/s out' : '—'),
        cls: '',
      },
    ];

    document.getElementById('content').innerHTML = `
      <!-- System info bar -->
      <div class="sys-info-bar">
        <span class="sys-info-chip">${statusPill}&nbsp; ${isOnline ? 'Online' : isUnreachable ? 'Unreachable' : 'Waiting'}</span>
        ${zabbix ? `<span class="sys-info-chip">🖥 ${esc(zabbix.host || host.host_name)}</span>` : ''}
        ${agentVer ? `<span class="sys-info-chip">Agent v${esc(agentVer.lastvalue)}</span>` : ''}
        <span class="sys-info-chip">🕐 ${now} ${tzLabel}</span>
        ${iface ? `<span class="sys-info-chip">${esc(iface.ip || '—')}:${esc(iface.port || '10050')}</span>` : ''}
      </div>

      <!-- 6 stat cards -->
      <div class="stat-grid stat-grid-6" style="margin-bottom:16px;">
        ${statCards.map(c => `
          <div class="stat-card">
            <div class="stat-label">${c.label}</div>
            <div class="stat-value ${c.cls}" style="font-size:32px;margin-top:8px;">${c.value}</div>
            <div class="stat-foot">${c.sub}</div>
          </div>`).join('')}
      </div>

      <!-- Load average bar -->
      ${(load1 || load5 || load15) ? `
      <div class="load-bar">
        <span class="load-title">LOAD AVERAGE</span>
        <span class="load-chip">1m: <b>${this._pf(load1?.lastvalue, 2) ?? '—'}</b></span>
        <span class="load-chip">5m: <b>${this._pf(load5?.lastvalue, 2) ?? '—'}</b></span>
        <span class="load-chip">15m: <b>${this._pf(load15?.lastvalue, 2) ?? '—'}</b></span>
      </div>` : ''}

      <!-- Live trend chart -->
      <div class="panel" style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h4 style="margin:0;">Live Trend</h4>
          <span class="tz-badge" id="tz-label">${tzLabel}</span>
        </div>

        <!-- Metric selector -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;" id="metric-sel"></div>

        <!-- Time range selector -->
        <div style="display:flex;gap:6px;margin-bottom:12px;align-items:center;">
          <span style="font-size:11px;color:var(--text-3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;">Range:</span>
          ${['1H','6H','12H','1D','1W','1M'].map(r => `
            <button class="btn btn-ghost btn-sm range-btn" data-range="${r}"
              style="${r === this._currentRange ? 'border-color:var(--accent);background:var(--bg-3);' : ''}">
              ${r}
            </button>`).join('')}
        </div>

        <div class="chart-wrap" style="height:300px;"><canvas id="metric-chart"></canvas></div>
      </div>

      <!-- Active problems + host info side by side -->
      <div class="detail-grid" style="margin-bottom:20px;">
        <div class="panel">
          <h4>Active Problems (${problems.length})</h4>
          ${problems.length === 0
            ? '<div style="color:var(--text-3);font-size:13px;padding:16px 0;">No active alerts. All clear. ✓</div>'
            : problems.slice(0, 12).map(p => `
                <div class="metric-row">
                  <div>
                    <div class="metric-name">${esc(p.name)}</div>
                    <div class="metric-key">${['','Info','Warning','Average','High','Disaster'][p.severity]||'sev '+p.severity} · ${new Date(parseInt(p.clock,10)*1000).toLocaleString()}</div>
                  </div>
                  <span class="status-pill status-err" style="font-size:10px;">!</span>
                </div>`).join('')}
        </div>
        <div class="panel">
          <h4>Host Info</h4>
          <div class="metric-row"><div class="metric-name">Hostname</div><div class="metric-value" style="font-size:12px;">${esc(host.host_name)}</div></div>
          <div class="metric-row"><div class="metric-name">OS Type</div><div class="metric-value">${host.os_type}</div></div>
          <div class="metric-row"><div class="metric-name">Agent mode</div><div class="metric-value">${host.agent_mode}</div></div>
          <div class="metric-row"><div class="metric-name">Zabbix Host ID</div><div class="metric-value" style="font-size:12px;">${host.zabbix_host_id}</div></div>
          <div class="metric-row"><div class="metric-name">Added</div><div class="metric-value" style="font-size:12px;">${new Date(host.created_at + 'Z').toLocaleString()}</div></div>
          <div class="metric-row"><div class="metric-name">PSK Identity</div><div class="metric-value" style="font-size:11px;">${esc(host.psk_identity)}</div></div>
        </div>
      </div>

      <!-- All metrics grouped -->
      <div class="panel">
        <h4>All Metrics (${metrics.length})</h4>
        <div id="metrics-body" style="max-height:600px;overflow-y:auto;">
          ${this._renderMetricGroups(metrics)}
        </div>
      </div>
    `;

    this._buildMetricSelector(id, metrics, cpu || mem || load1);
    this._bindRangeButtons(id, metrics);
    if (cpu || mem || load1) {
      const item = cpu || mem || load1;
      this._loadChart(id, item, this._currentRange);
    }
  },

  // ── Group metrics by category ────────────────────────────────────────
  _renderMetricGroups(metrics) {
    const groups = {
      'CPU': { icon: '⚙️', items: [] },
      'Memory': { icon: '🧠', items: [] },
      'Disk': { icon: '💾', items: [] },
      'Network': { icon: '🌐', items: [] },
      'System': { icon: '🖥', items: [] },
      'Other': { icon: '📊', items: [] },
    };

    metrics.forEach(m => {
      const k = m.key_;
      if (/^system\.cpu|^proc\.cpu/.test(k)) groups['CPU'].items.push(m);
      else if (/^vm\.memory|^mem\./.test(k)) groups['Memory'].items.push(m);
      else if (/^vfs\.fs|^vfs\.dev|^system\.swap/.test(k)) groups['Disk'].items.push(m);
      else if (/^net\.|^system\.net/.test(k)) groups['Network'].items.push(m);
      else if (/^system\.|^agent\.|^kernel\./.test(k)) groups['System'].items.push(m);
      else groups['Other'].items.push(m);
    });

    return Object.entries(groups)
      .filter(([, g]) => g.items.length > 0)
      .map(([name, g]) => `
        <div class="metric-category">
          <div class="metric-cat-header">
            <span class="metric-cat-icon">${g.icon}</span>
            <span class="metric-cat-title">${name}</span>
            <span class="metric-cat-count">${g.items.length}</span>
          </div>
          <div class="metric-cat-body">
            ${g.items.map(m => {
              const lastTime = m.lastclock ? new Date(parseInt(m.lastclock, 10) * 1000).toLocaleTimeString() : '';
              return `
                <div class="metric-row">
                  <div style="min-width:0;flex:1;">
                    <div class="metric-name">${esc(m.name)}</div>
                    <div class="metric-key">${esc(m.key_)}${lastTime ? ' · ' + lastTime : ''}</div>
                  </div>
                  <div class="metric-value">${esc(m.lastvalue || '—')} ${esc(m.units || '')}</div>
                </div>`;
            }).join('')}
          </div>
        </div>`).join('');
  },

  // ── Chart metric buttons ─────────────────────────────────────────────
  _buildMetricSelector(hostId, metrics, defItem) {
    const candidates = [
      { label: 'CPU',      keys: ['system.cpu.util'] },
      { label: 'Memory',   keys: ['vm.memory.utilization'] },
      { label: 'Load 1m',  keys: ['system.cpu.load[all,avg1]', 'system.cpu.load[percpu,avg1]'] },
      { label: 'Net In',   keys: ['net.if.in['] },
      { label: 'Net Out',  keys: ['net.if.out['] },
    ].map(c => ({
      ...c,
      item: this._find(metrics, ...c.keys),
    })).filter(c => c.item);

    const sel = document.getElementById('metric-sel');
    if (!sel) return;

    sel.innerHTML = candidates.map(c => `
      <button class="btn btn-ghost btn-sm metric-chart-btn"
        data-iid="${c.item.itemid}"
        data-name="${esc(c.label)}"
        data-vtype="${c.item.value_type}"
        data-units="${esc(c.item.units || '')}"
        style="${defItem && defItem.itemid === c.item.itemid ? 'border-color:var(--accent);background:var(--bg-3);' : ''}">
        ${c.label}
      </button>`).join('');

    sel.querySelectorAll('.metric-chart-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sel.querySelectorAll('.metric-chart-btn').forEach(b => b.style.cssText = '');
        btn.style.cssText = 'border-color:var(--accent);background:var(--bg-3);';
        const item = { itemid: btn.dataset.iid, value_type: btn.dataset.vtype, units: btn.dataset.units, name: btn.dataset.name };
        this._loadChart(hostId, item, this._currentRange);
      });
    });
  },

  // ── Range buttons ────────────────────────────────────────────────────
  _bindRangeButtons(hostId, metrics) {
    document.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._currentRange = btn.dataset.range;
        document.querySelectorAll('.range-btn').forEach(b => b.style.cssText = '');
        btn.style.cssText = 'border-color:var(--accent);background:var(--bg-3);';

        // Find currently active metric btn
        const activeMetricBtn = document.querySelector('.metric-chart-btn[style*="accent"]');
        const defItem = this._find(metrics, 'system.cpu.util') || this._find(metrics, 'vm.memory.utilization');
        if (activeMetricBtn) {
          const item = {
            itemid: activeMetricBtn.dataset.iid,
            value_type: activeMetricBtn.dataset.vtype,
            units: activeMetricBtn.dataset.units,
            name: activeMetricBtn.dataset.name,
          };
          this._loadChart(hostId, item, this._currentRange);
        } else if (defItem) {
          this._loadChart(hostId, defItem, this._currentRange);
        }
      });
    });
  },

  // ── Convert range string to hours ───────────────────────────────────
  _rangeToHours(range) {
    const map = { '1H': 1, '6H': 6, '12H': 12, '1D': 24, '1W': 168, '1M': 720 };
    return map[range] || 24;
  },

  // ── Load chart data ──────────────────────────────────────────────────
  async _loadChart(hostId, item, range) {
    const hours = this._rangeToHours(range);
    const canvas = document.getElementById('metric-chart');
    if (!canvas) return;

    // Show loading state
    if (this._chart) { this._chart.destroy(); this._chart = null; }

    try {
      const { history } = await API.getHistory(hostId, item.itemid, hours);

      if (!history || history.length === 0) {
        // Draw empty chart with message
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7d8595';
        ctx.font = '14px Inter Tight, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data for this time range', canvas.width / 2, canvas.height / 2);
        return;
      }

      // Format timestamps properly with timezone
      const tzOffset = new Date().getTimezoneOffset() * -60; // local offset in seconds
      const fmt = (clock) => {
        const d = new Date(parseInt(clock, 10) * 1000);
        if (hours <= 12) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
        if (hours <= 24) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
        if (hours <= 168) return d.toLocaleDateString('en', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit' });
      };

      // Downsample if too many points (keep chart readable)
      let pts = history;
      const maxPts = 300;
      if (pts.length > maxPts) {
        const step = Math.ceil(pts.length / maxPts);
        pts = pts.filter((_, i) => i % step === 0);
      }

      const labels = pts.map(h => fmt(h.clock));
      const values = pts.map(h => parseFloat(h.value));

      const units = item.units || '';
      const isPercent = units === '%';
      const isBytes = ['B', 'Bps'].includes(units);

      this._chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: (item.name || '') + (units ? ` (${units})` : ''),
            data: values,
            borderColor: '#7fffaa',
            backgroundColor: 'rgba(127,255,170,0.07)',
            fill: true,
            tension: 0.3,
            pointRadius: pts.length > 100 ? 0 : 2,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#c0c5d1', font: { family: 'Inter Tight' } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const v = ctx.parsed.y;
                  if (isPercent) return ` ${v.toFixed(2)}%`;
                  if (isBytes) return ` ${this._fmtBytes(v)}/s`;
                  return ` ${v.toFixed(3)} ${units}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: '#7d8595',
                maxTicksLimit: hours <= 6 ? 12 : hours <= 24 ? 8 : 7,
                maxRotation: 0,
                font: { family: 'JetBrains Mono', size: 11 },
              },
              grid: { color: '#2a3142' },
            },
            y: {
              ticks: {
                color: '#7d8595',
                font: { family: 'JetBrains Mono', size: 11 },
                callback: v => isPercent ? v.toFixed(1) + '%' : isBytes ? this._fmtBytes(v) : v,
              },
              grid: { color: '#2a3142' },
              min: isPercent ? 0 : undefined,
              max: isPercent ? 100 : undefined,
            },
          },
        },
      });
    } catch (e) {
      toast('Chart error: ' + e.message, 'err');
    }
  },
};
