# NeevCloud Monitoring Platform

A multi-tenant monitoring SaaS platform that uses **Zabbix 7.4** as its backend.
Users sign in, add their servers through a guided UI, get a one-line install
command (curl|bash for Linux, PowerShell for Windows), and start seeing
CPU/RAM/storage/uptime/temperature metrics in their dashboard within 1-2 minutes.

It's a "Site24x7-style" frontend layered on top of your existing Zabbix instance.

## Architecture

```
  ┌────────────────────────────────────┐
  │  NeevCloud Frontend (this repo)    │
  │  - Multi-tenant login              │
  │  - Add host wizard                 │
  │  - Live dashboards + alerts        │
  └─────────────┬──────────────────────┘
                │  Zabbix JSON-RPC API
                ▼
  ┌────────────────────────────────────┐
  │  Zabbix Server 7.4                 │
  │  http://103.192.199.53             │
  └─────────────▲──────────────────────┘
                │  Encrypted (PSK) agent traffic
                │
   ┌────────────┴─────────────┐
   │  Client Servers (anywhere)│
   │  zabbix-agent2 installed  │
   └───────────────────────────┘
```

## Which Zabbix template to select (your question from the image)

You are on the Host Wizard's "Select a template" screen. **None of the AWS or
Azure templates apply to your use case** — those are for monitoring cloud
provider APIs, not customer servers.

For your platform, scroll down (or type in the search) and pick one of:

| Server type            | Template name to select                |
|------------------------|----------------------------------------|
| Linux (recommended)    | `Linux by Zabbix agent active`         |
| Linux (passive mode)   | `Linux by Zabbix agent`                |
| Windows                | `Windows by Zabbix agent`              |

This codebase already does that selection automatically through the Zabbix API
when a user adds a host — you don't actually need to use the Host Wizard
manually. The values are in `.env` as `DEFAULT_LINUX_TEMPLATE`,
`DEFAULT_LINUX_ACTIVE_TEMPLATE`, and `DEFAULT_WINDOWS_TEMPLATE`.

**Quick verification:** open `http://103.192.199.53` → Data collection →
Templates, and confirm those three template names exist. They are part of the
default Zabbix 7.4 installation.

## Quick start (development)

```bash
# 1. Install Node.js 18+
node --version

# 2. Install dependencies
cd neevcloud-monitoring
npm install

# 3. Configure (edit .env if needed)
cat .env

# 4. Initialize database (creates SQLite db + default admin user)
npm run init-db

# 5. Start the server
npm start
```

Now visit **http://localhost:3000**.

Default credentials:
- Email: `admin@neevcloud.com`
- Password: `admin123`

**Change the password immediately in production.**

## Deploying to an Ubuntu server (production)

### One-time setup on a fresh Ubuntu 22.04/24.04 box

```bash
# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# Install PM2 (process manager)
sudo npm install -g pm2

# Clone or upload this code, then:
cd neevcloud-monitoring
npm install --omit=dev
npm run init-db

# Edit .env with production secrets and your Zabbix details
nano .env
# IMPORTANT: change JWT_SECRET to a long random string
# python3 -c "import secrets; print(secrets.token_hex(48))"   # generate one

# Start under PM2
pm2 start backend/server.js --name neevcloud-monitoring
pm2 save
pm2 startup    # follow the printed instructions
```

### Reverse proxy with NGINX + HTTPS

Create `/etc/nginx/sites-available/neevcloud`:

```nginx
server {
    listen 80;
    server_name monitoring.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/neevcloud /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Add HTTPS with Let's Encrypt:
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d monitoring.yourdomain.com
```

### Open Zabbix ports for agent traffic

On the **Zabbix server** (103.192.199.53), make sure these ports are reachable
from client servers on the public internet:

| Port  | Direction          | Use                                 |
|-------|--------------------|-------------------------------------|
| 10050 | Inbound (passive)  | Zabbix server → agent (passive mode)|
| 10051 | Inbound (active)   | Agent → Zabbix server (active mode) |

Active mode is preferred (works behind NAT) — clients only need outbound 10051.

## How the user flow works

1. **User signs up** in the frontend.
2. **User clicks Add Host**, picks Linux/Windows + active/passive.
3. Backend calls Zabbix API:
   - Creates a host with the right template (Linux/Windows agent).
   - Generates a unique PSK key + identity for that host.
   - Tags the host with `neevcloud_user=<user_id>` so we can scope queries.
4. Backend returns a one-line `curl ... | sudo bash` command.
5. User pastes it on their server. The bootstrap script:
   - Installs `zabbix-agent2` from the official Zabbix 7.4 repo.
   - Writes the unique PSK file (encrypted channel).
   - Points the agent at our Zabbix server (`ZABBIX_SERVER_IP`).
   - Starts and enables the service.
6. Within 1-2 minutes, Zabbix collects the first metrics. Our dashboard's
   queries scope by host ID (we only show the user *their* hosts).

## Multi-tenancy & isolation

- Each host is owned by exactly one user in our SQLite DB.
- When a user requests host data, we look up *their* host IDs and pass only
  those IDs to Zabbix's `host.get`, `item.get`, `problem.get`, `history.get`.
- A user can never see another user's host because the host-id list is built
  from `WHERE user_id = current_user`.
- For full Zabbix-side isolation (e.g. if you give users direct Zabbix
  frontend access too), you can additionally create Zabbix user groups and host
  groups per tenant. This codebase doesn't require that — our app is the only
  layer users see.

## File layout

```
neevcloud-monitoring/
├── backend/
│   ├── server.js              # Express app entry
│   ├── init-db.js             # Creates SQLite schema + admin user
│   ├── db.js                  # SQLite connection
│   ├── middleware/auth.js     # JWT auth middleware
│   ├── routes/
│   │   ├── auth.js            # /api/auth/*
│   │   ├── hosts.js           # /api/hosts/*
│   │   └── bootstrap.js       # /bootstrap/* (script for client servers)
│   └── services/zabbix.js     # All Zabbix JSON-RPC calls
├── frontend/
│   ├── index.html
│   ├── css/main.css
│   └── js/
│       ├── api.js             # Fetch wrapper
│       ├── router.js          # Hash router
│       ├── app.js             # Routes + auth gating
│       └── views/             # Login, Dashboard, Add host, Detail, Alerts
├── data/                      # SQLite db lives here (auto-created)
├── package.json
├── .env                       # Your config (gitignored in real life)
└── .env.example
```

## Troubleshooting

**"Zabbix API NOT reachable" on startup.**
Check that the URL in `.env` (`ZABBIX_URL`) is right and that your machine can
reach the Zabbix frontend. Test with `curl http://103.192.199.53/api_jsonrpc.php`.

**"Template not found in Zabbix".**
Log into Zabbix → Data collection → Templates and confirm a template named
exactly `Linux by Zabbix agent` (or whatever you set in `.env`) exists. Names
are case-sensitive.

**Agent installed but no data appears.**
- Check the agent is running on the client: `systemctl status zabbix-agent2`.
- Check the Zabbix server firewall allows inbound 10051 (active mode).
- View agent logs: `journalctl -u zabbix-agent2 -n 100`.
- In Zabbix frontend → Latest data, filter by the host name and verify items
  are populating.

**Login broken / "Invalid token".**
Token expired (7 days by default). Just sign in again. To extend, change
`JWT_EXPIRY` in `.env`.

## Security checklist before going live

- [ ] Change `JWT_SECRET` to a 64+ char random string in `.env`.
- [ ] Change the default admin password (`admin@neevcloud.com` / `admin123`).
- [ ] Change the Zabbix `Admin` account password and update `ZABBIX_API_PASSWORD`.
  (Better: create a dedicated read/write API user in Zabbix.)
- [ ] Put NGINX + HTTPS in front of the app.
- [ ] Restrict the Zabbix frontend (`http://103.192.199.53`) to internal access
  if possible — clients should never need to log into it directly.
- [ ] Back up `data/neevcloud.db` regularly.
