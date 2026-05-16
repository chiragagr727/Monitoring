/* Add host wizard. */
const AddHost = {
  async render() {
    Shell.render('add', `
      <div class="page-header">
        <div>
          <h1 class="page-title">Add a <em>new host</em></h1>
          <div class="page-sub">Register a server. We'll give you one command to run on it.</div>
        </div>
      </div>
      <div id="content">${this.formHtml()}</div>
    `);

    this.bindForm();
  },

  formHtml() {
    return `
      <div class="panel" style="max-width:640px;">
        <form id="add-form">
          <div class="field">
            <label>Server display name</label>
            <input name="visible_name" required placeholder="e.g. prod-api-01" />
          </div>

          <div class="field">
            <label>Operating system</label>
            <select name="os_type">
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </select>
          </div>

          <div class="field">
            <label>Agent mode</label>
            <select name="agent_mode" id="agent-mode">
              <option value="active">Active — agent pushes data (recommended, works behind NAT)</option>
              <option value="passive">Passive — Zabbix server pulls data (requires inbound port 10050)</option>
            </select>
          </div>

          <div class="field" id="ip-field" style="display:none;">
            <label>Server public IP</label>
            <input name="ip_address" placeholder="e.g. 203.0.113.42" />
            <div style="color:var(--text-3);font-size:12px;margin-top:6px;">
              Required only for passive mode — must be reachable from our Zabbix server.
            </div>
          </div>

          <div class="callout">
            <strong>What happens next:</strong> we register your server in Zabbix and generate a unique install command.
            Paste it on your server, hit enter, and metrics start flowing within ~2 minutes.
            All agent-server traffic is PSK-encrypted.
          </div>

          <div style="margin-top:24px;display:flex;gap:10px;">
            <button type="submit" class="btn btn-primary" id="submit-btn" style="width:auto;">Generate install command</button>
            <a href="#/" class="btn btn-ghost" style="text-decoration:none;">Cancel</a>
          </div>
        </form>
      </div>
    `;
  },

  bindForm() {
    const modeSel = document.getElementById('agent-mode');
    const ipField = document.getElementById('ip-field');
    modeSel.addEventListener('change', () => {
      ipField.style.display = modeSel.value === 'passive' ? 'block' : 'none';
    });

    document.getElementById('add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      try {
        const res = await API.addHost(body);
        this.renderResult(res);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Generate install command';
      }
    });
  },

  renderResult(res) {
    const { host, install_command } = res;
    document.getElementById('content').innerHTML = `
      <div class="panel" style="max-width:760px;">
        <h4>Your host is registered — finish on your server</h4>
        <p style="color:var(--text-2);margin-bottom:20px;">
          Run the command below on <strong>${escapeHtml(host.visible_name)}</strong>.
          The agent installs in under a minute. Once it connects, status will flip to "Online" on your dashboard.
        </p>

        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);font-weight:600;">
          ${install_command.type === 'shell' ? 'Linux — run with sudo' : 'Windows — run in elevated PowerShell'}
        </label>
        <div class="install-box" id="cmd-box">
          <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('cmd-text').textContent); toast('Copied');">Copy</button>
          <span id="cmd-text">${escapeHtml(install_command.command)}</span>
        </div>

        <div class="callout warn">
          <strong>Important:</strong> ${install_command.note}
        </div>

        <div class="callout">
          <strong>Tip:</strong> If you lose this command, open the host on the dashboard and click "Show install command" — we can re-generate it any time.
        </div>

        <div style="margin-top:24px;display:flex;gap:10px;">
          <a href="#/host/${host.id}" class="btn btn-primary" style="width:auto;text-decoration:none;">Open host detail</a>
          <a href="#/" class="btn btn-ghost" style="text-decoration:none;">Back to dashboard</a>
        </div>
      </div>
    `;
  },
};
