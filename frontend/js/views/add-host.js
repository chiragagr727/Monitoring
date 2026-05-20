const AddHost = {
  render() {
    Shell.render('add', `
      <div class="page-header">
        <div>
          <h1 class="page-title">Add a <em>new host</em></h1>
          <p class="page-sub">Register a server. We'll give you one command to run on it.</p>
        </div>
      </div>
      <div id="content">
        <div class="panel" style="max-width:580px;">
          <form id="hform">
            <div class="field">
              <label>Server display name</label>
              <input name="visible_name" required placeholder="e.g. prod-web-01" />
            </div>
            <div class="field">
              <label>Operating system</label>
              <select name="os_type">
                <option value="linux">Linux (Ubuntu, Debian, CentOS, Rocky…)</option>
                <option value="windows">Windows Server</option>
              </select>
            </div>
            <div class="field">
              <label>Agent mode</label>
              <select name="agent_mode" id="mode-sel">
                <option value="active">Active — agent pushes data (recommended, works behind NAT)</option>
                <option value="passive">Passive — server polls agent (requires open port 10050)</option>
              </select>
            </div>
            <div class="field" id="ip-wrap" style="display:none;">
              <label>Server public IP address</label>
              <input name="ip_address" placeholder="e.g. 203.0.113.10" />
              <div style="color:var(--t3);font-size:12px;margin-top:4px;">Required for passive mode.</div>
            </div>
            <div class="callout">
              <strong>How it works:</strong> We register your server in NeevCloud, generate a
              unique encrypted key for it, then give you a single <code>curl | bash</code>
              (or PowerShell) command. Metrics start appearing within 1–2 minutes.
            </div>
            <div style="margin-top:20px;display:flex;gap:10px;">
              <button type="submit" class="btn btn-primary" id="sbtn" style="width:auto;">
                Generate install command
              </button>
              <a href="#/" class="btn btn-ghost" style="text-decoration:none;">Cancel</a>
            </div>
          </form>
        </div>
      </div>
    `);

    document.getElementById('mode-sel').onchange = e => {
      document.getElementById('ip-wrap').style.display = e.target.value === 'passive' ? 'block' : 'none';
    };

    document.getElementById('hform').onsubmit = async e => {
      e.preventDefault();
      const btn = document.getElementById('sbtn');
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Registering…';
      try {
        const body = Object.fromEntries(new FormData(e.target));
        const res  = await API.addHost(body);
        this._showResult(res);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Generate install command';
      }
    };
  },

  _showResult({ host, install_command, templateName }) {
    document.getElementById('content').innerHTML = `
      <div class="panel" style="max-width:680px;">
        <h4 style="margin-bottom:12px;">Host registered — now run this on your server</h4>
        <p style="color:var(--t2);margin-bottom:16px;font-size:13px;line-height:1.6;">
          Your host <strong>${esc(host.visible_name)}</strong> is registered.
          Paste the command below on your server. The monitoring agent installs
          and starts sending data within ~2 minutes.
        </p>

        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:6px;">
          ${install_command.type === 'shell' ? 'Linux — run as root (sudo)' : 'Windows — elevated PowerShell'}
        </div>
        <div class="cmd-wrap">
          <div class="cmd-box" id="cmdbox">${esc(install_command.command)}</div>
          <button class="copy-btn" id="copybtn">Copy</button>
        </div>

        <div class="callout warn" style="margin-top:12px;">
          <strong>Note:</strong> ${esc(install_command.note)}
        </div>
        <div class="callout" style="margin-top:8px;">
          <strong>Lost the command?</strong> Open the host detail page anytime and click
          <em>Show install command</em> to get it again.
        </div>

        <div style="margin-top:20px;display:flex;gap:10px;">
          <a href="#/host/${host.id}" class="btn btn-primary" style="width:auto;text-decoration:none;">
            Open host dashboard
          </a>
          <a href="#/" class="btn btn-ghost" style="text-decoration:none;">Back to fleet</a>
        </div>
      </div>
    `;

    // Wire copy button after DOM is ready
    const copyBtn = document.getElementById('copybtn');
    const cmdText = install_command.command;
    copyBtn.onclick = () => {
      const doFallback = () => {
        const ta = document.createElement('textarea');
        ta.value = cmdText;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { document.execCommand('copy'); toast('Copied!'); copyBtn.textContent = 'Copied'; copyBtn.classList.add('copied'); setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1500); }
        catch { toast('Please copy manually', 'err'); }
        document.body.removeChild(ta);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(cmdText).then(() => {
          toast('Copied!'); copyBtn.textContent = 'Copied'; copyBtn.classList.add('copied');
          setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1500);
        }).catch(doFallback);
      } else { doFallback(); }
    };
  },
};
