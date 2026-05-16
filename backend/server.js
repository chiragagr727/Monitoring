/**
 * NeevCloud Monitoring - main server.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize database if missing
const dbPath = process.env.DB_PATH || './data/neevcloud.db';
const jsonPath = dbPath.replace(/\.db$/, '.json');
if (!fs.existsSync(jsonPath)) {
  console.log('Database not found; initializing...');
  require('./init-db');
}

const zbx = require('./services/zabbix');
const authRoutes = require('./routes/auth');
const hostRoutes = require('./routes/hosts');
const bootstrapRoutes = require('./routes/bootstrap');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security middleware ---
app.use(helmet({
  contentSecurityPolicy: false, // we serve our own UI; allow inline for dashboard
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- Rate limiting on auth endpoints to slow brute force ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// --- API routes ---
app.use('/api/auth', authRoutes);
app.use('/api/hosts', hostRoutes);

// Bootstrap script delivery is public (token-protected internally)
app.use('/bootstrap', bootstrapRoutes);

// Health check
app.get('/api/health', async (_req, res) => {
  const z = await zbx.ping();
  res.json({ ok: true, zabbix: z });
});

// --- Static frontend ---
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// SPA fallback for any non-API GET
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/bootstrap')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

// --- Boot ---
(async () => {
  console.log('================================================');
  console.log(' NeevCloud Monitoring Platform');
  console.log('================================================');
  console.log(' Zabbix URL :', process.env.ZABBIX_URL);

  try {
    const ping = await zbx.ping();
    if (ping.ok) console.log(' Zabbix API : reachable (version ' + ping.version + ')');
    else         console.log(' Zabbix API : NOT reachable -', ping.error);
  } catch (e) {
    console.log(' Zabbix API : check failed -', e.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(' Listening  : http://0.0.0.0:' + PORT);
    console.log('================================================');
  });
})();
