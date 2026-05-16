/**
 * Database initialization
 * Seeds the JSON store with the default admin user if no users exist yet.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/neevcloud.db';
const jsonPath = dbPath.replace(/\.db$/, '.json');
const dbDir = path.dirname(jsonPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Load or create
let data;
try {
  data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
} catch {
  data = { users: [], hosts: [], _seq: { users: 0, hosts: 0 } };
}

// Ensure structure
if (!data.users) data.users = [];
if (!data.hosts) data.hosts = [];
if (!data._seq) data._seq = {};
if (!data._seq.users) data._seq.users = data.users.length;
if (!data._seq.hosts) data._seq.hosts = data.hosts.length;

console.log('Initializing database at:', jsonPath);

// Seed default admin if no users exist
if (data.users.length === 0) {
  const passwordHash = bcrypt.hashSync('admin123', 10);
  data._seq.users++;
  data.users.push({
    id: data._seq.users,
    email: 'admin@neevcloud.com',
    password_hash: passwordHash,
    full_name: 'NeevCloud Admin',
    company: 'NeevCloud',
    role: 'admin',
    zabbix_usergroup_id: null,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });

  console.log('');
  console.log('Default admin user created:');
  console.log('   Email:    admin@neevcloud.com');
  console.log('   Password: admin123');
  console.log('   CHANGE THIS PASSWORD AFTER FIRST LOGIN');
  console.log('');
} else {
  console.log(`Database already has ${data.users.length} user(s), skipping seed.`);
}

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
console.log('Database initialized successfully.');
