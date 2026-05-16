/**
 * JSON file-based database — drop-in replacement for better-sqlite3.
 *
 * Stores users and hosts as JSON on disk.  Exposes a prepare() method that
 * returns objects with .get(), .all(), .run() so every call-site that was
 * written for better-sqlite3 keeps working without changes.
 *
 * Why not SQLite?  The native better-sqlite3 package needs Python + C++ build
 * tools (node-gyp), which are often missing on Windows dev machines.  Our local
 * DB only stores account info and Zabbix-host mappings — a JSON file is fine.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/neevcloud.db';
// We use .json extension for clarity
const jsonPath = dbPath.replace(/\.db$/, '.json');
const dbDir = path.dirname(jsonPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// ── Load or bootstrap ──────────────────────────────────────────────────
let data;
try {
  data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
} catch {
  data = { users: [], hosts: [], _seq: { users: 0, hosts: 0 } };
}

function save() {
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Tiny SQL-ish query engine ──────────────────────────────────────────
// We support only the patterns actually used by the codebase.

/**
 * Very small WHERE evaluator.
 * Supports: `WHERE col = ?`, `WHERE a = ? AND b = ?`
 */
function matchesWhere(row, whereCols, whereVals) {
  return whereCols.every((col, i) => String(row[col]) === String(whereVals[i]));
}

/**
 * Parse the SQL text to figure out table, action, columns, etc.
 * We only need to handle the exact SQL patterns the codebase uses.
 */
function parseSql(sql) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // SELECT COUNT(*) as c FROM table
  let m = s.match(/^SELECT COUNT\(\*\) as (\w+) FROM (\w+)/i);
  if (m) return { action: 'count', alias: m[1], table: m[2] };

  // SELECT ... FROM table WHERE ...
  m = s.match(/^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?:\s+ORDER BY (.+?))?$/i);
  if (m) {
    const cols = m[1].trim();
    const table = m[2];
    const whereStr = m[3] || '';
    const orderStr = m[4] || '';
    const whereCols = [];
    if (whereStr) {
      // Extract col = ? pairs
      const parts = whereStr.split(/\s+AND\s+/i);
      parts.forEach(p => {
        const pm = p.trim().match(/^(\w+)\s*=\s*\?$/);
        if (pm) whereCols.push(pm[1]);
      });
    }
    let orderBy = null;
    let orderDir = 'ASC';
    if (orderStr) {
      const op = orderStr.trim().split(/\s+/);
      orderBy = op[0];
      if (op[1] && op[1].toUpperCase() === 'DESC') orderDir = 'DESC';
    }
    return { action: 'select', cols, table, whereCols, orderBy, orderDir };
  }

  // INSERT INTO table (cols) VALUES (?,?,...)
  m = s.match(/^INSERT INTO (\w+) \((.+?)\)\s+VALUES\s*\((.+?)\)/i);
  if (m) {
    const table = m[1];
    const cols = m[2].split(',').map(c => c.trim().replace(/['"]/g, ''));
    return { action: 'insert', table, cols };
  }

  // DELETE FROM table WHERE ...
  m = s.match(/^DELETE FROM (\w+) WHERE (.+)$/i);
  if (m) {
    const table = m[1];
    const whereStr = m[2];
    const whereCols = [];
    const parts = whereStr.split(/\s+AND\s+/i);
    parts.forEach(p => {
      const pm = p.trim().match(/^(\w+)\s*=\s*\?$/);
      if (pm) whereCols.push(pm[1]);
    });
    return { action: 'delete', table, whereCols };
  }

  // UPDATE table SET ... WHERE ...
  m = s.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i);
  if (m) {
    const table = m[1];
    const setCols = m[2].split(',').map(p => p.trim().match(/^(\w+)\s*=\s*\?$/)?.[1]).filter(Boolean);
    const whereCols = [];
    const parts = m[3].split(/\s+AND\s+/i);
    parts.forEach(p => {
      const pm = p.trim().match(/^(\w+)\s*=\s*\?$/);
      if (pm) whereCols.push(pm[1]);
    });
    return { action: 'update', table, setCols, whereCols };
  }

  throw new Error(`db.js: unsupported SQL: ${sql}`);
}

function prepare(sql) {
  const parsed = parseSql(sql);

  return {
    get(...args) {
      const rows = data[parsed.table] || [];
      if (parsed.action === 'count') {
        return { [parsed.alias]: rows.length };
      }
      if (parsed.action === 'select') {
        const vals = args;
        const match = rows.find(r => matchesWhere(r, parsed.whereCols, vals));
        return match || undefined;
      }
      throw new Error('get() not supported for: ' + parsed.action);
    },

    all(...args) {
      if (parsed.action !== 'select') throw new Error('all() only for SELECT');
      let rows = data[parsed.table] || [];
      if (parsed.whereCols.length > 0) {
        rows = rows.filter(r => matchesWhere(r, parsed.whereCols, args));
      }
      if (parsed.orderBy) {
        rows = [...rows].sort((a, b) => {
          const va = a[parsed.orderBy] || '';
          const vb = b[parsed.orderBy] || '';
          const cmp = va < vb ? -1 : va > vb ? 1 : 0;
          return parsed.orderDir === 'DESC' ? -cmp : cmp;
        });
      }
      return rows;
    },

    run(...args) {
      if (parsed.action === 'insert') {
        if (!data[parsed.table]) data[parsed.table] = [];
        if (!data._seq) data._seq = {};
        if (!data._seq[parsed.table]) data._seq[parsed.table] = 0;
        data._seq[parsed.table]++;
        const row = { id: data._seq[parsed.table] };
        parsed.cols.forEach((col, i) => {
          if (col !== 'id') row[col] = args[i];
        });
        // Auto-set created_at if the column list includes it or if it's expected
        if (!row.created_at) row.created_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        data[parsed.table].push(row);
        save();
        return { lastInsertRowid: row.id, changes: 1 };
      }

      if (parsed.action === 'delete') {
        const rows = data[parsed.table] || [];
        const whereVals = args;
        const before = rows.length;
        data[parsed.table] = rows.filter(r => !matchesWhere(r, parsed.whereCols, whereVals));
        save();
        return { changes: before - data[parsed.table].length };
      }

      if (parsed.action === 'update') {
        const rows = data[parsed.table] || [];
        const setVals = args.slice(0, parsed.setCols.length);
        const whereVals = args.slice(parsed.setCols.length);
        let changes = 0;
        rows.forEach(r => {
          if (matchesWhere(r, parsed.whereCols, whereVals)) {
            parsed.setCols.forEach((col, i) => { r[col] = setVals[i]; });
            changes++;
          }
        });
        save();
        return { changes };
      }

      throw new Error('run() not supported for: ' + parsed.action);
    },
  };
}

// Compatibility: better-sqlite3 exec() — we just ignore DDL
function exec() { }

// Compatibility: pragma
function pragma() { }

// close — no-op
function close() { save(); }

module.exports = { prepare, exec, pragma, close, _data: data, _save: save, _jsonPath: jsonPath };
