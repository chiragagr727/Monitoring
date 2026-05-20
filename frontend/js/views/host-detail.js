/**
 * NeevCloud — Host Detail View
 * Fixed: real IP display, monthly chart via trends, better time labels
 */
const HostDetail = {
  _chart: null,
  _currentRange: '1D',
  _chartCandidates: [],

  async render({ id }) {
    Shell.render('hosts', `
      <div class="page-header">
        <div>
          <a href="#/" style="color:var(--t3);font-size:12px;text-decoration:none;display:inline-block;margin-bottom:4px;">← Hosts</a>
          <h1 class="page-title" id="ptitle" style="font-size:32px;">Loading…</h1>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost btn-sm" id="btn-install">Show install command</button>
          <button class="btn btn-ghost btn-sm" id="btn-refresh">↻ Refresh</button>
          <button class="btn btn-danger btn-sm" id="btn-delete">Delete</button>
        </div>
      </div>
      <div id="content"><div class="c-loader"><span class="spin"></span></div></div>
    `);

    document.getElementById('btn-refresh').onclick = () => this.render({ id });
    document.getElementById('btn-delete').onclick = async () => {
      if (!confirm('Delete this host? Monitoring will stop immediately.')) return;
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

  _copyText(text, btn) {
    const ok = () => {
      toast('Copied!');
      if (btn) { btn.textContent = 'Copied'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500); }
    };
    const fallback = () => {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); ok(); } catch { toast('Copy manually', 'err'); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok).catch(fallback);
    else fallback();
  },

  async _showInstall(id) {
    try {
      const { install_command: ic } = await API.getInstall(id);
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `
        <div class="modal">
          <div class="modal-hd">
            <h3>Install command</h3>
            <button class="modal-close" id="mc">×</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--t2);margin-bottom:10px;font-size:13px;">
              ${ic.type === 'shell' ? 'Run on your Linux server (as root / sudo):' : 'Run in elevated PowerShell on Windows:'}
            </p>
            <div class="cmd-wrap">
              <div class="cmd-box" id="ic-cmd">${esc(ic.command)}</div>
              <button class="copy-btn" id="ic-copy">Copy</button>
            </div>
            <div class="callout warn" style="margin-top:10px;">
              <strong>Note:</strong> ${esc(ic.note)}
            </div>
          </div>
        </div>`;
      document.body.appendChild(ov);
      document.getElementById('ic-copy').onclick = e => this._copyText(ic.command, e.currentTarget);
      ov.addEventListener('click', e => { if (e.target === ov || e.target.id === 'mc') ov.remove(); });
    } catch (e) { toast(e.message, 'err'); }
  },

  _find(metrics, ...keys) {
    for (const k of keys) { const m = metrics.find(m => m.key_ === k); if (m) return m; }
    for (const k of keys) { const m = metrics.find(m => m.key_.startsWith(k)); if (m) return m; }
    return null;
  },
  _pf(v, d = 1) { if (v == null || v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : parseFloat(n.toFixed(d)); },
  _fmtBytes(b) {
    const n = parseFloat(b); if (isNaN(n) || n <= 0) return '—';
    const u = ['B','KB','MB','GB','TB']; let i = 0, v = n;
    while (v >= 1024 && i < 4) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + u[i];
  },
  _fmtUptime(sec) {
    const s = parseInt(sec, 10); if (!s || isNaN(s)) return '—';
    const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
  _cls(v, w, c) { return v == null ? '' : v >= c ? 'crit' : v >= w ? 'warn' : 'ok'; },

  _getDisk(metrics) {
    const pused = this._find(metrics,
      'vfs.fs.dependent.size[/,pused]','vfs.fs.dependent.size[C:,pused]',
      'vfs.fs.size[/,pused]','vfs.fs.size[C:,pused]');
    const pfree = this._find(metrics,
      'vfs.fs.dependent.size[/,pfree]','vfs.fs.size[/,pfree]');
    const total = this._find(metrics,
      'vfs.fs.dependent.size[/,total]','vfs.fs.size[/,total]',
      'vfs.fs.dependent.size[C:,total]','vfs.fs.size[C:,total]');
    const free  = this._find(metrics,
      'vfs.fs.dependent.size[/,free]','vfs.fs.size[/,free]');

    let pct = null;
    if (pused) pct = this._pf(pused.lastvalue, 1);
    else if (pfree) { const f = this._pf(pfree.lastvalue); if (f != null) pct = parseFloat((100-f).toFixed(1)); }
    else if (total && free) {
      const t = parseFloat(total.lastvalue), fr = parseFloat(free.lastvalue);
      if (t > 0) pct = parseFloat(((1-fr/t)*100).toFixed(1));
    }
    return { pct, total: total?.lastvalue };
  },

  _getNet(metrics) {
    const ins  = metrics.filter(m => m.key_.startsWith('net.if.in[')  && !m.key_.includes('[lo]') && !m.key_.includes('[lo,'));
    const outs = metrics.filter(m => m.key_.startsWith('net.if.out[') && !m.key_.includes('[lo]') && !m.key_.includes('[lo,'));
    const best = arr => arr.sort((a,b) => parseFloat(b.lastvalue||0) - parseFloat(a.lastvalue||0))[0] || null;
    return { inItem: best(ins), outItem: best(outs) };
  },

  _getSwap(metrics) {
    const pfree = this._find(metrics, 'system.swap.size[,pfree]');
    const total = this._find(metrics, 'system.swap.size[,total]');
    let pct = null;
    if (pfree) { const f = this._pf(pfree.lastvalue); if (f != null) pct = parseFloat((100-f).toFixed(1)); }
    return { pct, total: total?.lastvalue };
  },

  _getCPU(metrics) {
    return this._find(metrics, 'system.cpu.util') ||
      metrics.find(m => m.key_.startsWith('system.cpu.util') &&
        !m.key_.includes('guest') && !m.key_.includes('nice') &&
        !m.key_.includes('iowait') && !m.key_.includes('idle') &&
        !m.key_.includes('interrupt') && !m.key_.includes('softirq') &&
        !m.key_.includes('steal'));
  },

  _tzLabel() {
    try {
      const tz   = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const abbr = new Date().toLocaleTimeString('en', { timeZoneName:'short' }).split(' ').pop();
      return abbr + ' (' + tz + ')';
    } catch { return 'Local'; }
  },

  _render({ host, zabbix, metrics, problems }, id) {
    const iface     = zabbix?.interfaces?.[0];
    const isOnline  = iface?.available === '1';
    const isUnreach = iface?.available === '2';

    const statusPill = isOnline
      ? `<span class="pill pill-ok"><span class="dot"></span>Online</span>`
      : isUnreach
        ? `<span class="pill pill-err"><span class="dot"></span>Unreachable</span>`
        : `<span class="pill pill-warn"><span class="dot"></span>Waiting for agent</span>`;

    const cpu    = this._getCPU(metrics);
    const mem    = this._find(metrics, 'vm.memory.utilization');
    const uptime = this._find(metrics, 'system.uptime');
    const load1  = this._find(metrics, 'system.cpu.load[all,avg1]', 'system.cpu.load[percpu,avg1]');
    const load5  = this._find(metrics, 'system.cpu.load[all,avg5]', 'system.cpu.load[percpu,avg5]');
    const load15 = this._find(metrics, 'system.cpu.load[all,avg15]', 'system.cpu.load[percpu,avg15]');
    const agentV = this._find(metrics, 'agent.version');
    const procs  = this._find(metrics, 'proc.num');
    const users  = this._find(metrics, 'system.users.num');
    const temp   = this._find(metrics, 'system.hw.sensors[temperature]', 'system.sensors[temp]');
    const memFree  = this._find(metrics, 'vm.memory.size[available]', 'vm.memory.size[free]');
    const memTotal = this._find(metrics, 'vm.memory.size[total]');

    const disk = this._getDisk(metrics);
    const net  = this._getNet(metrics);
    const swap = this._getSwap(metrics);

    // Real IP: prefer host.real_ip (from backend), then interface IP if not 127.0.0.1
    const realIP = host.real_ip
      || (iface?.ip && iface.ip !== '127.0.0.1' ? iface.ip : null)
      || 'Active agent (IP auto-detected)';

    const cpuVal  = this._pf(cpu?.lastvalue);
    const memVal  = this._pf(mem?.lastvalue);
    const diskVal = disk.pct;
    const swapVal = swap.pct;

    const now   = new Date().toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit' });
    const tzLbl = this._tzLabel();

    this._chartCandidates = [
      { label: 'CPU',     item: cpu },
      { label: 'Memory',  item: mem },
      { label: 'Load 1m', item: load1 },
      { label: 'Net In',  item: net.inItem },
      { label: 'Net Out', item: net.outItem },
    ].filter(c => c.item);

    const defChart = this._chartCandidates[0]?.item;

    document.getElementById('content').innerHTML = `
      <div class="sys-info-bar">
        ${statusPill}
        <span class="sys-chip">🖥 ${esc(host.visible_name)}</span>
        ${agentV  ? `<span class="sys-chip">Agent ${esc(agentV.lastvalue)}</span>` : ''}
        <span class="sys-chip">🕐 ${now} ${tzLbl}</span>
        <span class="sys-chip">${esc(realIP)}:${esc(iface?.port || '10050')}</span>
        ${procs   ? `<span class="sys-chip">⚙ ${esc(procs.lastvalue)} processes</span>` : ''}
        ${users   ? `<span class="sys-chip">👤 ${esc(users.lastvalue)} users</span>` : ''}
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">CPU Usage</div>
          <div class="stat-val ${this._cls(cpuVal,70,90)}">${cpuVal !== null ? cpuVal : '—'}<span class="u">%</span></div>
          <div class="stat-foot">Load: ${this._pf(load1?.lastvalue, 2) ?? '—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Memory</div>
          <div class="stat-val ${this._cls(memVal,80,95)}">${memVal !== null ? memVal : '—'}<span class="u">%</span></div>
          <div class="stat-foot">${memFree && memTotal
            ? this._fmtBytes(memFree.lastvalue) + ' free of ' + this._fmtBytes(memTotal.lastvalue)
            : '&nbsp;'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Disk (/)</div>
          <div class="stat-val ${this._cls(diskVal,80,90)}">${diskVal !== null ? diskVal : '—'}<span class="u">%</span></div>
          <div class="stat-foot">${disk.total ? this._fmtBytes(disk.total) + ' total' : 'Root partition'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Swap</div>
          <div class="stat-val ${this._cls(swapVal,60,85)}">${swapVal !== null ? swapVal : '—'}<span class="u">%</span></div>
          <div class="stat-foot">${swap.total ? this._fmtBytes(swap.total) + ' total' : '&nbsp;'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uptime</div>
          <div class="stat-val" style="font-size:${this._fmtUptime(uptime?.lastvalue).length > 8 ? '18px':'24px'};padding-top:4px;">
            ${this._fmtUptime(uptime?.lastvalue)}
          </div>
          <div class="stat-foot">Since last reboot</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Network I/O</div>
          <div class="stat-val" style="font-size:16px;padding-top:6px;">
            ${net.inItem ? '↓ ' + this._fmtBytes(net.inItem.lastvalue) + '/s' : '—'}
          </div>
          <div class="stat-foot">${net.outItem ? '↑ ' + this._fmtBytes(net.outItem.lastvalue) + '/s out' : '&nbsp;'}</div>
        </div>
      </div>

      ${(load1 || load5 || load15) ? `
      <div class="load-bar">
        <span class="load-title">Load Avg</span>
        <span class="load-chip">1m: <b>${this._pf(load1?.lastvalue, 2) ?? '—'}</b></span>
        <span class="load-chip">5m: <b>${this._pf(load5?.lastvalue, 2) ?? '—'}</b></span>
        <span class="load-chip">15m: <b>${this._pf(load15?.lastvalue, 2) ?? '—'}</b></span>
        ${temp ? `<span class="load-chip">🌡 <b>${this._pf(temp.lastvalue, 1)}°C</b></span>` : ''}
        ${procs ? `<span class="load-chip">Procs: <b>${procs.lastvalue}</b></span>` : ''}
      </div>` : ''}

      <div class="panel" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
          <span style="font-size:15px;font-weight:700;">Live Trend</span>
          <span class="tz-badge">${tzLbl}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:5px;">METRIC</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;" id="metric-btns">
              ${this._chartCandidates.map((c, i) => `
                <button class="btn btn-ghost btn-sm metric-btn" data-idx="${i}"
                  style="${i === 0 ? 'border-color:var(--green);background:var(--bg-3);color:var(--green);' : ''}">
                  ${c.label}
                </button>`).join('')}
            </div>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:5px;">RANGE</div>
            <div style="display:flex;gap:4px;" id="range-btns">
              ${['1H','6H','12H','1D','1W','1M'].map(r => `
                <button class="btn btn-ghost btn-sm range-btn" data-range="${r}"
                  style="${r === this._currentRange ? 'border-color:var(--green);background:var(--bg-3);color:var(--green);' : ''}">
                  ${r}
                </button>`).join('')}
            </div>
          </div>
        </div>
        <div class="chart-wrap" style="height:280px;"><canvas id="metric-chart"></canvas></div>
      </div>

      <div class="detail-grid">
        <div class="panel">
          <h4>Active Problems (${problems.length})</h4>
          ${problems.length === 0
            ? '<p style="color:var(--t3);font-size:13px;padding:8px 0;">No active problems — all clear ✓</p>'
            : problems.slice(0,10).map(p => `
                <div class="metric-row">
                  <div>
                    <div class="metric-k">${esc(p.name)}</div>
                    <div class="metric-sub">${['','Info','Warning','Average','High','Disaster'][p.severity]||'Sev '+p.severity} · ${new Date(parseInt(p.clock,10)*1000).toLocaleString()}</div>
                  </div>
                  <span class="pill pill-err" style="font-size:10px;">!</span>
                </div>`).join('')}
        </div>
        <div class="panel">
          <h4>Host Info</h4>
          <div class="metric-row"><div class="metric-k">Display name</div><div class="metric-v">${esc(host.visible_name)}</div></div>
          <div class="metric-row"><div class="metric-k">OS</div><div class="metric-v">${host.os_type}</div></div>
          <div class="metric-row"><div class="metric-k">Agent mode</div><div class="metric-v">${host.agent_mode}</div></div>
          <div class="metric-row"><div class="metric-k">IP Address</div><div class="metric-v" style="font-size:12px;">${esc(realIP)}</div></div>
          <div class="metric-row"><div class="metric-k">Added</div><div class="metric-v" style="font-size:11px;">${new Date(host.created_at+'Z').toLocaleString()}</div></div>
          ${temp ? `<div class="metric-row"><div class="metric-k">Temperature</div><div class="metric-v">${this._pf(temp.lastvalue,1)}°C</div></div>` : ''}
        </div>
      </div>

      <div class="panel">
        <h4>All Metrics (${metrics.length})</h4>
        <div style="max-height:500px;overflow-y:auto;">${this._renderGroups(metrics)}</div>
      </div>
    `;

    document.getElementById('metric-btns')?.querySelectorAll('.metric-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.metric-btn').forEach(b => b.style.cssText = '');
        btn.style.cssText = 'border-color:var(--green);background:var(--bg-3);color:var(--green);';
        const c = this._chartCandidates[+btn.dataset.idx];
        if (c) this._loadChart(id, c.item, this._currentRange);
      };
    });

    document.getElementById('range-btns')?.querySelectorAll('.range-btn').forEach(btn => {
      btn.onclick = () => {
        this._currentRange = btn.dataset.range;
        document.querySelectorAll('.range-btn').forEach(b => b.style.cssText = '');
        btn.style.cssText = 'border-color:var(--green);background:var(--bg-3);color:var(--green);';
        const idx = +( document.querySelector('.metric-btn[style*="green"]')?.dataset.idx ?? 0);
        const c = this._chartCandidates[idx] || this._chartCandidates[0];
        if (c) this._loadChart(id, c.item, this._currentRange);
      };
    });

    if (defChart) this._loadChart(id, defChart, this._currentRange);
  },

  _renderGroups(metrics) {
    const g = { CPU:{icon:'⚙️',items:[]}, Memory:{icon:'🧠',items:[]}, Disk:{icon:'💾',items:[]}, Network:{icon:'🌐',items:[]}, System:{icon:'🖥',items:[]}, Other:{icon:'📊',items:[]} };
    metrics.forEach(m => {
      const k = m.key_;
      if (/^system\.cpu/.test(k))                           g.CPU.items.push(m);
      else if (/^vm\.memory|^mem\./.test(k))                g.Memory.items.push(m);
      else if (/^vfs\.fs|^vfs\.dev|^system\.swap/.test(k))  g.Disk.items.push(m);
      else if (/^net\./.test(k))                            g.Network.items.push(m);
      else if (/^system\.|^agent\.|^kernel\.|^proc\./.test(k)) g.System.items.push(m);
      else                                                   g.Other.items.push(m);
    });
    return Object.entries(g).filter(([,v]) => v.items.length).map(([name,v]) => `
      <div class="metric-category">
        <div class="metric-cat-header">
          <span class="metric-cat-icon">${v.icon}</span>
          <span class="metric-cat-title">${name}</span>
          <span class="metric-cat-count">${v.items.length}</span>
        </div>
        <div class="metric-cat-body">
          ${v.items.map(m => `
            <div class="metric-row">
              <div style="min-width:0;flex:1;overflow:hidden;">
                <div class="metric-k">${esc(m.name)}</div>
                <div class="metric-sub">${esc(m.key_)}</div>
              </div>
              <div class="metric-v">${esc(m.lastvalue||'—')}${m.units?' '+esc(m.units):''}</div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  },

  _rangeHours(r) { return {'1H':1,'6H':6,'12H':12,'1D':24,'1W':168,'1M':720}[r]||24; },

  async _loadChart(hostId, item, range) {
    const canvas = document.getElementById('metric-chart');
    if (!canvas) return;
    if (this._chart) { this._chart.destroy(); this._chart = null; }

    const hours = this._rangeHours(range);

    try {
      const { history, item: info } = await API.getHistory(hostId, item.itemid, hours);

      if (!history || history.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#717a8e'; ctx.font='13px sans-serif'; ctx.textAlign='center';
        ctx.fillText('No data for this period', canvas.width/2, canvas.height/2);
        return;
      }

      // Smart labels — for 1M use "May 1", "May 5" etc; for 1W use "Mon 14:00"
      const fmt = clock => {
        const d = new Date(parseInt(clock,10)*1000);
        if (hours <= 6)   return d.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
        if (hours <= 24)  return d.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
        if (hours <= 168) {
          return d.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'}) + ' '
               + d.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
        }
        // 1M: day + date, no time (trends are hourly averages anyway)
        return d.toLocaleDateString('en',{month:'short',day:'numeric',hour:'2-digit'});
      };

      // Downsample to max 500 points
      let pts = history;
      if (pts.length > 500) {
        const step = Math.ceil(pts.length / 500);
        pts = pts.filter((_, i) => i % step === 0);
      }

      const units   = info?.units || item.units || '';
      const isPct   = units === '%';
      const isBps   = ['bps','Bps','bit/s'].includes(units);
      const isBytes = units === 'B';

      this._chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: pts.map(h => fmt(h.clock)),
          datasets: [{
            label: (info?.name || item.name || '') + (units ? ` (${units})` : ''),
            data: pts.map(h => parseFloat(h.value)),
            borderColor: '#5bffaa',
            backgroundColor: 'rgba(91,255,170,0.06)',
            fill: true,
            tension: 0.3,
            pointRadius: pts.length > 150 ? 0 : 2,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode:'index', intersect:false },
          plugins: {
            legend: { labels: { color:'#b8bfcc', font:{ family:'system-ui', size:12 } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const v = ctx.parsed.y;
                  if (isPct)    return ` ${v.toFixed(2)}%`;
                  if (isBps)    return ` ${this._fmtBytes(v)}/s`;
                  if (isBytes)  return ` ${this._fmtBytes(v)}`;
                  return ` ${v.toFixed(3)} ${units}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color:'#717a8e',
                maxTicksLimit: hours >= 720 ? 15 : hours >= 168 ? 10 : 8,
                maxRotation: hours >= 168 ? 30 : 0,
                font:{ family:'monospace', size:10 },
              },
              grid: { color:'#252d3e' },
            },
            y: {
              ticks: {
                color:'#717a8e', font:{ family:'monospace', size:10 },
                callback: v => isPct ? v.toFixed(0)+'%' : isBps||isBytes ? this._fmtBytes(v) : v,
              },
              grid: { color:'#252d3e' },
              min: isPct ? 0 : undefined,
              max: isPct ? 100 : undefined,
            },
          },
        },
      });
    } catch(e) {
      toast('Chart error: ' + e.message, 'err');
    }
  },
};
