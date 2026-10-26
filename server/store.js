import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './auth.js';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'voxelscope.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','analyst','viewer')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, meta TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), dataset_id TEXT NOT NULL REFERENCES datasets(id), state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled')), settings TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, error TEXT, elapsed_ms REAL);
    CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id), actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL, timestamp TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS datasets_tenant ON datasets(tenant_id,project_id);
    CREATE INDEX IF NOT EXISTS jobs_tenant ON jobs(tenant_id,created_at);
    CREATE INDEX IF NOT EXISTS audit_tenant ON audit(tenant_id,seq);
    PRAGMA user_version=1;`);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  let insideTransaction = false;
  const transaction = fn => {
    if (insideTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    insideTransaction = true;
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { insideTransaction = false; }
  };
  function audit(tenant, actor, action, target = '', details = {}) {
    return transaction(() => {
    const previous = get('SELECT hash FROM audit WHERE tenant_id=? ORDER BY seq DESC LIMIT 1', tenant)?.hash || '0'.repeat(64);
    const payload = { tenant_id: tenant, actor, action, target, details: JSON.stringify(details), timestamp: new Date().toISOString(), previous_hash: previous };
    const hash = digest(JSON.stringify(payload));
    run('INSERT INTO audit(tenant_id,actor,action,target,details,timestamp,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?)', ...Object.values(payload), hash);
    return hash;
    });
  }
  function verifyAudit(tenant) {
    let previous = '0'.repeat(64), count = 0;
    for (const row of all('SELECT * FROM audit WHERE tenant_id=? ORDER BY seq', tenant)) {
      const payload = { tenant_id: row.tenant_id, actor: row.actor, action: row.action, target: row.target, details: row.details, timestamp: row.timestamp, previous_hash: row.previous_hash };
      if (row.previous_hash !== previous || digest(JSON.stringify(payload)) !== row.hash) return { valid: false, count, failedAt: row.seq };
      previous = row.hash; count++;
    }
    return { valid: true, count, head: previous };
  }
  function createTenant(name) {
    const id = randomUUID(); run('INSERT INTO tenants(id,name) VALUES(?,?)', id, name); return id;
  }
  return { db, get, all, run, transaction, audit, verifyAudit, createTenant, directory };
}
