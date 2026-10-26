import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openStore } from './store.js';
import { createQueue } from './queue.js';
import { digest, token, hashPassword, verifyPassword, readSession, sessionCookie } from './auth.js';
import { decodeRaw, makeDemo, validateDimensions, validateSpacing, MAX_VOXELS } from '../src/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowedStatic = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ...['app', 'renderer', 'core'].map(name => [`/src/${name}.js`, [`src/${name}.js`, 'text/javascript; charset=utf-8']]),
]);
const error = (status, message) => Object.assign(new Error(message), { status });
const cleanName = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw error(400, 'Invalid name or text length.');
  return value.trim();
};
const emailName = value => {
  const email = cleanName(value).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw error(400, 'Invalid email.');
  return email;
};
function boundedNumber(value, fallback, min, max) {
  const result = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw error(400, 'Invalid pagination.');
  return result;
}
async function body(req, limit = 64 * 1024) {
  if (Number(req.headers['content-length']) > limit) throw error(413, 'Request is too large.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw error(413, 'Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw error(415, 'Expected application/json.');
  try {
    const input = JSON.parse((await body(req)).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw error(400, 'Expected a JSON object.');
    return input;
  } catch (e) { if (e.status) throw e; throw error(400, 'Invalid JSON.'); }
}

export async function provision(store, { tenantName, email, password }) {
  const passwordHash = await hashPassword(password);
  return store.transaction(() => {
    const tenantId = store.createTenant(cleanName(tenantName));
    const id = randomUUID();
    store.run('INSERT INTO users(id,tenant_id,email,password,role,created_at) VALUES(?,?,?,?,?,?)', id, tenantId, emailName(email), passwordHash, 'admin', new Date().toISOString());
    store.audit(tenantId, id, 'tenant.created', tenantId);
    return { tenantId, id };
  });
}

export async function createApp({ directory, bootstrap, secureCookies = false, publicOrigin = null, jobTimeout = 120_000, quotaBytes = 512 * 1024 * 1024 } = {}) {
  if (!directory) throw new Error('A data directory is required.');
  const store = openStore(resolve(directory));
  await mkdir(join(store.directory, 'volumes'), { recursive: true });
  let initialized = false;
  if (!store.get('SELECT id FROM users LIMIT 1')) {
    if (!bootstrap) throw new Error('An initial administrator is required.');
    await provision(store, bootstrap);
    initialized = true;
  }
  store.db.exec(`CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), actor TEXT NOT NULL REFERENCES users(id), decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')), comment TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const queue = createQueue(store, { timeout: jobTimeout });
  const attempts = new Map();
  let authInFlight = 0;
  // A real hash is used for unknown users, too.
  const dummyHash = await hashPassword(token());
  const housekeeping = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    store.run('DELETE FROM sessions WHERE expires<?', now);
  }, 60_000).unref();
  function audit(user, action, target, details) { store.audit(user.tenant_id, user.id, action, target, details); }
  function role(user, ...roles) { if (!roles.includes(user.role)) throw error(403, 'Your role does not permit this operation.'); }
  function project(user, id) {
    const row = store.get('SELECT * FROM projects WHERE id=? AND tenant_id=?', id, user.tenant_id);
    if (!row) throw error(404, 'Project not found.'); return row;
  }
  function dataset(user, id) {
    const row = store.get('SELECT * FROM datasets WHERE id=? AND tenant_id=? AND ready=1', id, user.tenant_id);
    if (!row) throw error(404, 'Dataset not found.'); return row;
  }
  function job(user, id) {
    const row = store.get('SELECT * FROM jobs WHERE id=? AND tenant_id=?', id, user.tenant_id);
    if (!row) throw error(404, 'Job not found.'); return row;
  }
  async function saveDataset(user, meta, bytes) {
    // Quota check follows the last await and the reservation insert follows it synchronously.
    // Pending uploads count against quota before the actual file write.
    project(user, meta.projectId);
    const usage = store.get('SELECT COALESCE(SUM(bytes),0) AS size,COUNT(*) AS count FROM datasets WHERE tenant_id=?', user.tenant_id);
    if (usage.size + bytes.length > quotaBytes || usage.count >= 200) throw error(413, 'Tenant storage quota reached.');
    const id = randomUUID(), hash = digest(bytes), createdAt = new Date().toISOString();
    // Synchronous metadata reservation prevents concurrent uploads bypassing quota.
    store.run('INSERT INTO datasets(id,tenant_id,project_id,name,meta,sha256,bytes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, user.tenant_id, meta.projectId, meta.name, JSON.stringify(meta), hash, bytes.length, user.id, createdAt);
    try { await writeFile(join(store.directory, 'volumes', `${id}.bin`), bytes, { flag: 'wx' }); }
    catch (e) { store.run('DELETE FROM datasets WHERE id=?', id); throw e; }
    store.transaction(() => {
      store.run('UPDATE datasets SET ready=1 WHERE id=?', id);
      audit(user, 'dataset.imported', id, { name: meta.name, sha256: hash, bytes: bytes.length, synthetic: meta.source.kind === 'synthetic' });
    });
    return { id, sha256: hash, meta };
  }
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, value) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname, method = req.method;
      if (!path.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw error(405, 'Method not allowed.');
        const entry = allowedStatic.get(path);
        if (!entry) throw error(404, 'Not found.');
        const bytes = await readFile(join(root, entry[0]));
        res.setHeader('Content-Type', entry[1]); res.setHeader('Cache-Control', 'no-cache');
        res.end(method === 'HEAD' ? undefined : bytes); return;
      }
      if (method === 'GET' && path === '/api/health') { send(200, { status: 'ok', version: '1.0.0' }); return; }
      if (!['GET', 'HEAD'].includes(method)) {
        // Explicit public origin is required behind a reverse proxy; forwarded headers are never trusted.
        const origin = publicOrigin || `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== origin) throw error(403, 'Origin rejected.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw error(403, 'Cross-site request rejected.');
      }
      if (method === 'POST' && path === '/api/login') {
        const ip = req.socket.remoteAddress;
        const key = ip;
        const now = Date.now();
        const entry = attempts.get(key);
        if (entry && entry.until > now && entry.count >= 12) { res.setHeader('Retry-After', '900'); throw error(429, 'Too many login attempts. Try again in 15 minutes.'); }
        if (authInFlight >= 4) throw error(429, 'Authentication is busy. Retry shortly.');
        if (attempts.size >= 10_000 && !entry) throw error(429, 'Rate limit capacity reached.');
        attempts.set(key, { count: (entry && entry.until > now ? entry.count : 0) + 1, until: entry && entry.until > now ? entry.until : now + 900_000 });
        const input = await jsonBody(req);
        const email = emailName(input.email);
        const user = store.get('SELECT * FROM users WHERE email=?', email);
        authInFlight++;
        let valid;
        try { valid = await verifyPassword(input.password, user?.password || dummyHash); } finally { authInFlight--; }
        if (!valid || !user?.active) { if (user) audit(user, 'auth.failed', user.id); throw error(401, 'Invalid credentials.'); }
        const value = token(), csrf = token();
        store.transaction(() => {
          store.run('DELETE FROM sessions WHERE user_id=?', user.id);
          store.run('INSERT INTO sessions(hash,user_id,csrf,expires) VALUES(?,?,?,?)', digest(value), user.id, csrf, now + 28_800_000);
          audit(user, 'auth.login', user.id);
        });
        res.setHeader('Set-Cookie', sessionCookie(value, secureCookies));
        send(200, { csrf }); return;
      }
      const sessionHash = readSession(req);
      const user = store.get('SELECT u.*,s.csrf,t.name AS tenant_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=u.tenant_id WHERE s.hash=? AND s.expires>? AND u.active=1', sessionHash, Date.now());
      if (!user) throw error(401, 'Please sign in.');
      if (!['GET', 'HEAD'].includes(method) && req.headers['x-csrf-token'] !== user.csrf) throw error(403, 'Invalid CSRF token. Refresh and sign in again.');
      if (method === 'GET' && path === '/api/me') { send(200, { id: user.id, email: user.email, role: user.role, tenant: user.tenant_name, csrf: user.csrf }); return; }
      if (method === 'POST' && path === '/api/logout') {
        store.transaction(() => { store.run('DELETE FROM sessions WHERE hash=?', sessionHash); audit(user, 'auth.logout', user.id); });
        res.setHeader('Set-Cookie', sessionCookie('', secureCookies, true)); send(200, { ok: true }); return;
      }
      if (path === '/api/projects') {
        if (method === 'GET') {
          send(200, store.all('SELECT p.*, (SELECT COUNT(*) FROM datasets d WHERE d.project_id=p.id) AS dataset_count FROM projects p WHERE p.tenant_id=? ORDER BY p.created_at DESC LIMIT 200', user.tenant_id)); return;
        }
        if (method === 'POST') {
          role(user, 'admin', 'analyst'); const input = await jsonBody(req);
          const name = cleanName(input.name), description = input.description ? cleanName(input.description, 1000) : '';
          if (store.get('SELECT COUNT(*) AS n FROM projects WHERE tenant_id=?', user.tenant_id).n >= 200) throw error(409, 'Project limit reached.');
          const id = randomUUID();
          store.transaction(() => {
            store.run('INSERT INTO projects(id,tenant_id,name,description,created_by,created_at) VALUES(?,?,?,?,?,?)', id, user.tenant_id, name, description, user.id, new Date().toISOString());
            audit(user, 'project.created', id, { name });
          });
          send(201, { id }); return;
        }
      }
      if (path === '/api/datasets' && method === 'GET') {
        const projectId = url.searchParams.get('project'); project(user, projectId);
        send(200, store.all('SELECT * FROM datasets WHERE tenant_id=? AND project_id=? AND ready=1 ORDER BY created_at DESC LIMIT 200', user.tenant_id, projectId).map(r => ({ ...r, meta: JSON.parse(r.meta) }))); return;
      }
      if (path === '/api/datasets' && method === 'POST') {
        role(user, 'admin', 'analyst');
        if (req.headers['content-type'] !== 'application/octet-stream') throw error(415, 'Expected application/octet-stream.');
        let input;
        try { input = JSON.parse(decodeURIComponent(req.headers['x-volume-meta'] || '')); } catch { throw error(400, 'Invalid volume metadata.'); }
        const meta = { projectId: input.projectId, name: cleanName(input.name), dims: input.dims, spacing: input.spacing, bits: input.bits, source: { kind: 'imported', format: cleanName(input.format || 'RAW', 50) } };
        validateDimensions(meta.dims); validateSpacing(meta.spacing); project(user, meta.projectId);
        if (![8, 16].includes(meta.bits)) throw error(400, 'Expected uint8 or uint16 data.');
        const bytes = await body(req, MAX_VOXELS * 2);
        decodeRaw(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), meta.dims, { bits: meta.bits });
        send(201, await saveDataset(user, meta, bytes)); return;
      }
      if (path === '/api/demo' && method === 'POST') {
        role(user, 'admin', 'analyst'); const input = await jsonBody(req); project(user, input.projectId);
        const demo = makeDemo();
        const meta = { projectId: input.projectId, name: 'CMC · synthetic validation phantom', dims: demo.dims, spacing: demo.spacing, bits: 8, source: demo.source };
        send(201, await saveDataset(user, meta, Buffer.from(demo.data))); return;
      }
      let match = path.match(/^\/api\/datasets\/([^/]+)\/raw$/);
      if (match && method === 'GET') {
        const row = dataset(user, match[1]);
        const bytes = await readFile(join(store.directory, 'volumes', `${row.id}.bin`));
        res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store'); res.end(bytes); return;
      }
      if (path === '/api/jobs' && method === 'GET') {
        const projectId = url.searchParams.get('project'); project(user, projectId);
        const limit = boundedNumber(url.searchParams.get('limit'), 50, 1, 100);
        const offset = boundedNumber(url.searchParams.get('offset'), 0, 0, 100_000);
        send(200, store.all('SELECT j.*,d.name AS dataset_name FROM jobs j JOIN datasets d ON d.id=j.dataset_id WHERE j.tenant_id=? AND d.project_id=? ORDER BY j.created_at DESC LIMIT ? OFFSET ?', user.tenant_id, projectId, limit, offset).map(r => ({ ...r, settings: JSON.parse(r.settings) }))); return;
      }
      if (path === '/api/jobs' && method === 'POST') {
        role(user, 'admin', 'analyst'); const input = await jsonBody(req); dataset(user, input.datasetId);
        const settings = input.settings;
        if (!settings || !['manual', 'otsu'].includes(settings.method) || ![6, 26].includes(settings.connectivity) || typeof settings.dark !== 'boolean' || !Number.isFinite(settings.threshold) || settings.threshold < 0 || settings.threshold > 65535 || !Number.isSafeInteger(settings.minSize) || settings.minSize < 1 || settings.minSize > MAX_VOXELS || !['box', 'cylinder'].includes(settings.shape) || !Number.isFinite(settings.inset) || settings.inset < 0 || settings.inset > 0.4) throw error(400, 'Invalid analysis settings.');
        const count = store.get('SELECT COUNT(*) AS total,SUM(state IN (\'queued\',\'running\')) AS pending FROM jobs WHERE tenant_id=?', user.tenant_id);
        if (count.total >= 2000 || count.pending >= 10) throw error(429, 'Job quota reached (10 pending / 2000 total).');
        const id = randomUUID();
        store.transaction(() => {
          store.run('INSERT INTO jobs(id,tenant_id,dataset_id,state,settings,created_by,created_at) VALUES(?,?,?,?,?,?,?)', id, user.tenant_id, input.datasetId, 'queued', JSON.stringify(settings), user.id, new Date().toISOString());
          audit(user, 'job.queued', id, { datasetId: input.datasetId, settings });
        });
        queue.pump(); send(202, { id }); return;
      }
      match = path.match(/^\/api\/jobs\/([^/]+)(?:\/(report|labels|roi|vertices|cancel|reviews))?$/);
      if (match) {
        const row = job(user, match[1]), action = match[2];
        if (!action && method === 'GET') { send(200, { ...row, settings: JSON.parse(row.settings) }); return; }
        if (action === 'cancel' && method === 'POST') {
          role(user, 'admin', 'analyst');
          if (!['queued', 'running'].includes(row.state)) throw error(409, 'Job is already finished.');
          if (row.state === 'running') queue.cancel(row.id);
          else store.run("UPDATE jobs SET state='cancelled',finished_at=? WHERE id=?", new Date().toISOString(), row.id);
          audit(user, 'job.cancel.requested', row.id); send(200, { ok: true }); return;
        }
        if (action === 'reviews') {
          if (method === 'GET') { send(200, store.all('SELECT r.*,u.email AS reviewer FROM reviews r JOIN users u ON u.id=r.actor WHERE r.job_id=? AND r.tenant_id=? ORDER BY r.created_at', row.id, user.tenant_id)); return; }
          if (method === 'POST') {
            role(user, 'admin', 'analyst'); if (row.state !== 'succeeded') throw error(409, 'Only completed results can be reviewed.');
            const input = await jsonBody(req);
            if (!['accepted', 'rejected'].includes(input.decision)) throw error(400, 'Invalid decision.');
            const comment = cleanName(input.comment, 1000), id = randomUUID();
            store.transaction(() => {
              store.run('INSERT INTO reviews(id,job_id,tenant_id,actor,decision,comment,created_at) VALUES(?,?,?,?,?,?,?)', id, row.id, user.tenant_id, user.id, input.decision, comment, new Date().toISOString());
              audit(user, `review.${input.decision}`, row.id, { reviewId: id, comment });
            });
            send(201, { id }); return;
          }
        }
        if (['report', 'labels', 'roi', 'vertices'].includes(action) && method === 'GET') {
          if (row.state !== 'succeeded') throw error(409, 'Result is not available.');
          const file = action === 'report' ? 'report.json' : `${action}.bin`;
          const bytes = await readFile(join(store.directory, 'results', row.id, file));
          res.setHeader('Content-Type', action === 'report' ? 'application/json; charset=utf-8' : 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store'); res.end(bytes); return;
        }
      }
      if (path === '/api/users') {
        role(user, 'admin');
        if (method === 'GET') { send(200, store.all('SELECT id,email,role,active,created_at FROM users WHERE tenant_id=? ORDER BY created_at LIMIT 200', user.tenant_id)); return; }
        if (method === 'POST') {
          const input = await jsonBody(req), email = emailName(input.email);
          if (!['admin', 'analyst', 'viewer'].includes(input.role)) throw error(400, 'Invalid role.');
          if (store.get('SELECT COUNT(*) AS n FROM users WHERE tenant_id=?', user.tenant_id).n >= 200) throw error(409, 'User limit reached.');
          if (authInFlight >= 4) throw error(429, 'Authentication is busy. Retry shortly.');
          let password;
          authInFlight++;
          try { password = await hashPassword(input.password); } finally { authInFlight--; }
          const id = randomUUID();
          try { store.transaction(() => {
            store.run('INSERT INTO users(id,tenant_id,email,password,role,created_at) VALUES(?,?,?,?,?,?)', id, user.tenant_id, email, password, input.role, new Date().toISOString());
            audit(user, 'user.created', id, { email, role: input.role });
          }); } catch (e) { if (e.code?.startsWith('ERR_SQLITE')) throw error(409, 'Account could not be created. Email may be in use.'); throw e; }
          send(201, { id }); return;
        }
      }
      match = path.match(/^\/api\/users\/([^/]+)\/disable$/);
      if (match && method === 'POST') {
        role(user, 'admin');
        const target = store.get('SELECT * FROM users WHERE id=? AND tenant_id=?', match[1], user.tenant_id);
        if (!target) throw error(404, 'User not found.');
        if (target.id === user.id) throw error(409, 'You cannot disable your own account.');
        store.transaction(() => { store.run('UPDATE users SET active=0 WHERE id=?', target.id); store.run('DELETE FROM sessions WHERE user_id=?', target.id); audit(user, 'user.disabled', target.id); });
        send(200, { ok: true }); return;
      }
      if (path === '/api/password' && method === 'POST') {
        const input = await jsonBody(req);
        if (authInFlight >= 4) throw error(429, 'Authentication is busy.');
        authInFlight++;
        let password;
        try {
          if (!await verifyPassword(input.currentPassword, user.password)) throw error(401, 'Current password is incorrect.');
          password = await hashPassword(input.password);
        } finally { authInFlight--; }
        store.transaction(() => {
          store.run('UPDATE users SET password=? WHERE id=?', password, user.id);
          store.run('DELETE FROM sessions WHERE user_id=?', user.id);
          audit(user, 'user.password.changed', user.id);
        });
        res.setHeader('Set-Cookie', sessionCookie('', secureCookies, true)); send(200, { ok: true }); return;
      }
      if (path === '/api/audit' && method === 'GET') {
        role(user, 'admin');
        const offset = boundedNumber(url.searchParams.get('offset'), 0, 0, 100_000);
        send(200, { verification: store.verifyAudit(user.tenant_id), events: store.all('SELECT a.*,u.email AS actor_email FROM audit a LEFT JOIN users u ON u.id=a.actor WHERE a.tenant_id=? ORDER BY a.seq DESC LIMIT 100 OFFSET ?', user.tenant_id, offset) }); return;
      }
      throw error(404, 'API endpoint not found.');
    } catch (e) {
      const validation = e.message?.match(/^(Each dimension|Volume exceeds|Voxel spacing|RAW byte|Invalid RAW)/);
      const status = e.status || (validation ? 400 : 500);
      if (status === 500) console.error(JSON.stringify({ requestId, error: e.message }));
      if (!res.headersSent) send(status, { error: status === 500 ? 'Internal server error.' : e.message, requestId });
      else res.destroy();
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxRequestsPerSocket = 1000;
  queue.pump();
  return { server, store, queue, initialized, async close() {
    clearInterval(housekeeping);
    await queue.close();
    await new Promise((done, reject) => { server.close(e => e ? reject(e) : done()); server.closeAllConnections(); });
    store.db.close();
  } };
}
