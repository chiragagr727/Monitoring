/**
 * Bootstrap script delivery.
 *
 * When a user runs `curl ... | sudo bash` on their server, it hits one of these
 * endpoints, which respond with a generated shell/PowerShell script that:
 *   - detects the OS
 *   - installs the Zabbix 7.4 agent2
 *   - writes the per-host PSK file
 *   - points the agent at our Zabbix server
 *   - enables + starts the service
 *
 * The script is generated dynamically so it carries the unique PSK identity/key
 * and the correct server IP for THIS specific host.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
require('dotenv').config();

const router = express.Router();

function verifyBootstrapToken(host, token) {
  const secret = process.env.JWT_SECRET || 'fallback';
  const expected = crypto.createHmac('sha256', secret)
    .update(`${host.id}:${host.psk_identity}`)
    .digest('hex').slice(0, 32);
  return token === expected;
}

router.get('/linux/:hostId', (req, res) => {
  const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.hostId);
  if (!host) return res.status(404).send('# Host not found\n');
  if (!verifyBootstrapToken(host, req.query.t)) return res.status(403).send('# Invalid token\n');

  const serverIp = process.env.ZABBIX_SERVER_IP;
  const serverActive = host.agent_mode === 'active' ? serverIp : '';
  const serverPassive = host.agent_mode === 'passive' ? serverIp : serverIp; // both modes still set Server
  const pskId = host.psk_identity;
  const pskKey = host.psk_key;
  const hostname = host.host_name;

  const script = `#!/usr/bin/env bash
# ============================================================
#  NeevCloud Monitoring - Linux Agent Bootstrap
#  Host: ${host.visible_name}
#  Generated: ${new Date().toISOString()}
# ============================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)."
  exit 1
fi

echo ""
echo "================================================="
echo " NeevCloud Monitoring - Agent Installer"
echo "================================================="
echo ""

# --- Detect distro ---
if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO=$ID
  VERSION=$VERSION_ID
else
  echo "Cannot detect OS. /etc/os-release missing."
  exit 1
fi
echo "Detected: $DISTRO $VERSION"

# --- Install Zabbix 7.4 agent2 ---
case "$DISTRO" in
  ubuntu)
    CODENAME=$(. /etc/os-release && echo "\${VERSION_CODENAME}")
    REL_URL="https://repo.zabbix.com/zabbix/7.4/release/ubuntu/pool/main/z/zabbix-release/zabbix-release_latest_7.4+ubuntu\${VERSION_ID}_all.deb"
    echo "Installing Zabbix repo: $REL_URL"
    cd /tmp
    wget -q "$REL_URL" -O zabbix-release.deb || {
      echo "Repo package not found for Ubuntu \${VERSION_ID}; falling back to distro package."
    }
    [ -f zabbix-release.deb ] && dpkg -i zabbix-release.deb || true
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y zabbix-agent2 || \\
      DEBIAN_FRONTEND=noninteractive apt-get install -y zabbix-agent
    ;;
  debian)
    REL_URL="https://repo.zabbix.com/zabbix/7.4/release/debian/pool/main/z/zabbix-release/zabbix-release_latest_7.4+debian\${VERSION_ID}_all.deb"
    cd /tmp
    wget -q "$REL_URL" -O zabbix-release.deb || true
    [ -f zabbix-release.deb ] && dpkg -i zabbix-release.deb || true
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y zabbix-agent2 || \\
      DEBIAN_FRONTEND=noninteractive apt-get install -y zabbix-agent
    ;;
  centos|rhel|rocky|almalinux)
    MAJOR=\${VERSION_ID%%.*}
    rpm -Uvh "https://repo.zabbix.com/zabbix/7.4/release/rhel/\${MAJOR}/x86_64/zabbix-release-latest-7.4.el\${MAJOR}.noarch.rpm" || true
    yum clean all
    yum install -y zabbix-agent2 || yum install -y zabbix-agent
    ;;
  *)
    echo "Unsupported distro: $DISTRO. Attempting generic install..."
    if command -v apt-get >/dev/null; then
      apt-get update -y && apt-get install -y zabbix-agent2 || apt-get install -y zabbix-agent
    elif command -v yum >/dev/null; then
      yum install -y zabbix-agent2 || yum install -y zabbix-agent
    else
      echo "No supported package manager found."
      exit 1
    fi
    ;;
esac

# --- Determine config file & service name ---
if [ -f /etc/zabbix/zabbix_agent2.conf ]; then
  CONF=/etc/zabbix/zabbix_agent2.conf
  SERVICE=zabbix-agent2
elif [ -f /etc/zabbix/zabbix_agentd.conf ]; then
  CONF=/etc/zabbix/zabbix_agentd.conf
  SERVICE=zabbix-agent
else
  echo "Zabbix agent config not found after install."
  exit 1
fi
echo "Configuring $CONF (service: $SERVICE)"

# --- Write PSK file ---
PSK_FILE=/etc/zabbix/neevcloud.psk
echo "${pskKey}" > "$PSK_FILE"
chmod 640 "$PSK_FILE"
chown root:zabbix "$PSK_FILE" 2>/dev/null || true

# --- Backup original config (once) ---
[ ! -f "\${CONF}.neev-backup" ] && cp "$CONF" "\${CONF}.neev-backup"

# --- Rewrite config with our values ---
set_conf() {
  local key="$1"; local val="$2"
  if grep -qE "^[# ]*\${key}=" "$CONF"; then
    sed -i "s|^[# ]*\${key}=.*|\${key}=\${val}|" "$CONF"
  else
    echo "\${key}=\${val}" >> "$CONF"
  fi
}

set_conf Server "${serverPassive}"
set_conf ServerActive "${serverActive || serverIp}"
set_conf Hostname "${hostname}"
set_conf TLSConnect psk
set_conf TLSAccept psk
set_conf TLSPSKIdentity "${pskId}"
set_conf TLSPSKFile "$PSK_FILE"

# --- Open firewall port 10050 for passive mode (best-effort) ---
if [ "${host.agent_mode}" = "passive" ]; then
  if command -v ufw >/dev/null; then ufw allow 10050/tcp || true; fi
  if command -v firewall-cmd >/dev/null; then firewall-cmd --permanent --add-port=10050/tcp || true; firewall-cmd --reload || true; fi
fi

# --- Enable + start ---
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
sleep 2

echo ""
echo "================================================="
if systemctl is-active --quiet "$SERVICE"; then
  echo " Zabbix agent is running."
  echo " It may take ~1-2 minutes for data to appear in your"
  echo " NeevCloud dashboard."
else
  echo " WARNING: agent service is not active. Check:"
  echo "   journalctl -u $SERVICE -n 50"
fi
echo "================================================="
`;

  res.set('Content-Type', 'text/plain');
  res.send(script);
});

router.get('/windows/:hostId', (req, res) => {
  const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.hostId);
  if (!host) return res.status(404).send('# Host not found');
  if (!verifyBootstrapToken(host, req.query.t)) return res.status(403).send('# Invalid token');

  const serverIp = process.env.ZABBIX_SERVER_IP;

  // Built with concatenation because PowerShell uses backticks for escapes,
  // which conflict with JS template literals.
  const NL = '\n';
  const BT_QUOTE = '`"';  // PowerShell escaped double-quote
  const BT_N = '`n';      // PowerShell newline in double-quoted string

  const lines = [
    '# ============================================================',
    '#  NeevCloud Monitoring - Windows Agent Bootstrap',
    '#  Host: ' + host.visible_name,
    '# ============================================================',
    '',
    '$ErrorActionPreference = "Stop"',
    'Write-Host ""',
    'Write-Host "================================================="',
    'Write-Host " NeevCloud Monitoring - Windows Agent Installer"',
    'Write-Host "================================================="',
    '',
    '$installerUrl = "https://cdn.zabbix.com/zabbix/binaries/stable/7.4/7.4.0/zabbix_agent2-7.4.0-windows-amd64-openssl.msi"',
    '$installerPath = "$env:TEMP\\zabbix_agent2.msi"',
    'Write-Host "Downloading Zabbix agent..."',
    'Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing',
    '',
    'Write-Host "Installing..."',
    'Start-Process msiexec.exe -ArgumentList "/i ' + BT_QUOTE + '$installerPath' + BT_QUOTE +
      ' /qn SERVER=' + serverIp + ' SERVERACTIVE=' + serverIp +
      ' HOSTNAME=' + host.host_name + '" -Wait',
    '',
    '# Write PSK file',
    '$pskFile = "C:\\Program Files\\Zabbix Agent 2\\neevcloud.psk"',
    '"' + host.psk_key + '" | Out-File -FilePath $pskFile -Encoding ascii -NoNewline',
    '',
    '# Patch config',
    '$conf = "C:\\Program Files\\Zabbix Agent 2\\zabbix_agent2.conf"',
    '$content = Get-Content $conf -Raw',
    "$content = $content -replace '(?m)^[# ]*TLSConnect=.*',     \"TLSConnect=psk\"",
    "$content = $content -replace '(?m)^[# ]*TLSAccept=.*',      \"TLSAccept=psk\"",
    "$content = $content -replace '(?m)^[# ]*TLSPSKIdentity=.*', \"TLSPSKIdentity=" + host.psk_identity + "\"",
    "$content = $content -replace '(?m)^[# ]*TLSPSKFile=.*',     \"TLSPSKFile=$pskFile\"",
    "if ($content -notmatch 'TLSConnect=')     { $content += \"" + BT_N + "TLSConnect=psk\" }",
    "if ($content -notmatch 'TLSAccept=')      { $content += \"" + BT_N + "TLSAccept=psk\" }",
    "if ($content -notmatch 'TLSPSKIdentity=') { $content += \"" + BT_N + "TLSPSKIdentity=" + host.psk_identity + "\" }",
    "if ($content -notmatch 'TLSPSKFile=')     { $content += \"" + BT_N + "TLSPSKFile=$pskFile\" }",
    'Set-Content -Path $conf -Value $content',
    '',
    '# Open firewall',
    'netsh advfirewall firewall add rule name="Zabbix Agent 2" dir=in action=allow protocol=TCP localport=10050 | Out-Null',
    '',
    'Restart-Service "Zabbix Agent 2"',
    '',
    'Write-Host ""',
    'Write-Host " Installation complete. Data will appear in NeevCloud within 1-2 minutes."',
  ];

  res.set('Content-Type', 'text/plain');
  res.send(lines.join(NL));
});

module.exports = router;
