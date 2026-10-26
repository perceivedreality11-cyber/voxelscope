import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp, provision } from '../server/app.js';

let app, directory, base, admin, viewer, analyst, foreign, projectId, datasetId, jobId;
const password = 'Automated-Test-Password-849!';
function client() {
  let cookie = '', csrf = '';
  return {
    async request(path, { method = 'GET', data, bytes, headers = {}, raw = false } = {}) {
      const res = await fetch(`${base}${path}`, { method, headers: {
        ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
      }, body: bytes || (data !== undefined ? JSON.stringify(data) : undefined) });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      const body = raw ? await res.arrayBuffer() : await res.json();
      if (body.csrf) csrf = body.csrf;
      return { status: res.status, body, headers: res.headers };
    },
    async login(email) { return this.request('/api/login', { method: 'POST', data: { email, password } }); },
  };
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'voxelscope-test-'));
  app = await createApp({ directory, bootstrap: { tenantName: 'Tenant A', email: 'admin@a.local', password } });
  await provision(app.store, { tenantName: 'Tenant B', email: 'admin@b.local', password });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  admin = client(); assert.equal((await admin.login('admin@a.local')).status, 200);
  foreign = client(); assert.equal((await foreign.login('admin@b.local')).status, 200);
});
after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('health is public, API is authenticated, static serving does not expose server data', async () => {
  const anon = client(); assert.equal((await anon.request('/api/health')).body.status, 'ok');
  assert.equal((await anon.request('/api/projects')).status, 401);
  const staticRes = await fetch(base); assert.match(await staticRes.text(), /VoxelScope/);
  for (const path of ['/server/app.js', '/data/voxelscope.sqlite', '/package.json', '/.git/config']) assert.equal((await fetch(base + path)).status, 404);
  assert.match(staticRes.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('sessions use HttpOnly cookies and reject incorrect password', async () => {
  const login = await client().login('admin@a.local');
  assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  // Re-login the shared test client because the service permits one session per account.
  await admin.login('admin@a.local');
  assert.equal((await client().request('/api/login', { method: 'POST', data: { email: 'admin@a.local', password: 'wrong' } })).status, 401);
});
test('mutations require CSRF and reject foreign origins', async () => {
  assert.equal((await admin.request('/api/projects', { method: 'POST', data: { name: 'Bad' }, headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await admin.request('/api/projects', { method: 'POST', data: { name: 'Bad' }, headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await admin.request('/api/projects', { method: 'POST', data: null })).status, 400);
});
test('admin provisions roles and projects, with no tenant assignment controlled by the client', async () => {
  for (const role of ['viewer', 'analyst']) assert.equal((await admin.request('/api/users', { method: 'POST', data: { email: `${role}@a.local`, password, role, tenant_id: 'forged' } })).status, 201);
  viewer = client(); analyst = client(); await viewer.login('viewer@a.local'); await analyst.login('analyst@a.local');
  assert.equal((await viewer.request('/api/projects', { method: 'POST', data: { name: 'Forbidden' } })).status, 403);
  assert.equal((await analyst.request('/api/users')).status, 403);
  const result = await analyst.request('/api/projects', { method: 'POST', data: { name: 'SiC/SiC validation', description: 'Fixture tests' } });
  assert.equal(result.status, 201); projectId = result.body.id;
  assert.equal((await viewer.request('/api/projects')).body.length, 1);
  assert.equal((await foreign.request('/api/projects')).body.length, 0);
  assert.equal((await foreign.request(`/api/datasets?project=${projectId}`)).status, 404);
});
test('RAW import preserves native data with SHA256 and validates byte counts', async () => {
  const bytes = new Uint8Array(64).fill(200); bytes[21] = 0;
  const meta = { name: 'Known fixture', projectId, dims: [4, 4, 4], spacing: [2, 3, 4], bits: 8, format: 'RAW' };
  const upload = () => ({ method: 'POST', bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-Volume-Meta': encodeURIComponent(JSON.stringify(meta)) } });
  assert.equal((await viewer.request('/api/datasets', upload())).status, 403);
  assert.equal((await foreign.request('/api/datasets', upload())).status, 404);
  const result = await analyst.request('/api/datasets', upload()); assert.equal(result.status, 201); datasetId = result.body.id;
  assert.match(result.body.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(new Uint8Array((await viewer.request(`/api/datasets/${datasetId}/raw`, { raw: true })).body), bytes);
  assert.equal((await foreign.request(`/api/datasets/${datasetId}/raw`)).status, 404);
  const bad = upload(); bad.bytes = new Uint8Array(63);
  assert.equal((await analyst.request('/api/datasets', bad)).status, 400);
});
test('RAW sampling provenance is validated and preserved by the server', async () => {
  const rawSource = { dims: [8, 8, 8], spacing: [1, 1.5, 2], bits: 8, offset: 0, littleEndian: true, origin: [0, 0, 0], size: [8, 8, 8], stride: [2, 2, 2] };
  const meta = { name: 'Sampled source fixture', projectId, dims: [4, 4, 4], spacing: [2, 3, 4], bits: 8, format: 'RAW', rawSource };
  const upload = () => ({ method: 'POST', bytes: new Uint8Array(64).fill(100), headers: { 'Content-Type': 'application/octet-stream', 'X-Volume-Meta': encodeURIComponent(JSON.stringify(meta)) } });
  const created = await analyst.request('/api/datasets', upload());
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.meta.source.rawImport, rawSource);
  meta.spacing = [1, 1, 1];
  assert.equal((await analyst.request('/api/datasets', upload())).status, 400);
  const invalid = upload(); invalid.headers['X-Volume-Meta'] = 'null';
  assert.equal((await analyst.request('/api/datasets', invalid)).status, 400);
});
test('analysis runs in the persistent worker queue and returns an exact, traceable report', async () => {
  const settings = { method: 'manual', threshold: 95, dark: true, connectivity: 26, minSize: 1, shape: 'box', inset: 0 };
  assert.equal((await viewer.request('/api/jobs', { method: 'POST', data: { datasetId, settings } })).status, 403);
  assert.equal((await foreign.request('/api/jobs', { method: 'POST', data: { datasetId, settings } })).status, 404);
  assert.equal((await analyst.request('/api/jobs', { method: 'POST', data: { datasetId, settings: { ...settings, connectivity: 7 } } })).status, 400);
  const result = await analyst.request('/api/jobs', { method: 'POST', data: { datasetId, settings } }); assert.equal(result.status, 202); jobId = result.body.id;
  for (let i = 0; i < 100; i++) {
    const job = (await viewer.request(`/api/jobs/${jobId}`)).body;
    if (job.state === 'succeeded') break;
    assert.notEqual(job.state, 'failed', job.error); await delay(30);
  }
  const report = await viewer.request(`/api/jobs/${jobId}/report`); assert.equal(report.status, 200);
  assert.equal(report.body.summary.porosity, 1 / 64); assert.equal(report.body.components[0].volumeUm3, 24);
  assert.equal(report.body.provenance.datasetId, datasetId); assert.match(report.body.provenance.sha256, /^[a-f0-9]{64}$/);
  for (const file of ['report', 'labels', 'roi', 'vertices']) assert.equal((await foreign.request(`/api/jobs/${jobId}/${file}`)).status, 404);
  const labels = await viewer.request(`/api/jobs/${jobId}/labels`, { raw: true }); assert.equal(labels.body.byteLength, 256);
  assert.equal((await viewer.request(`/api/jobs?project=${projectId}&limit=-1`)).status, 400);
});
test('review decisions are append-only, scoped, and audited', async () => {
  const data = { decision: 'accepted', comment: 'ROI and segmentation reviewed against fixture.' };
  assert.equal((await viewer.request(`/api/jobs/${jobId}/reviews`, { method: 'POST', data })).status, 403);
  assert.equal((await analyst.request(`/api/jobs/${jobId}/reviews`, { method: 'POST', data })).status, 201);
  assert.equal((await viewer.request(`/api/jobs/${jobId}/reviews`)).body.length, 1);
  assert.equal((await foreign.request(`/api/jobs/${jobId}/reviews`)).status, 404);
  assert.equal((await analyst.request(`/api/jobs/${jobId}/reviews`, { method: 'DELETE' })).status, 404);
});
test('audit chain verifies, detects a modified event, and remains tenant scoped', async () => {
  const response = await admin.request('/api/audit'); assert.equal(response.body.verification.valid, true);
  assert.ok(response.body.events.some(e => e.action === 'review.accepted'));
  assert.equal((await viewer.request('/api/audit')).status, 403);
  const b = await foreign.request('/api/audit'); assert.ok(!b.body.events.some(e => e.target === jobId));
  const row = app.store.get('SELECT * FROM audit WHERE tenant_id=? ORDER BY seq LIMIT 1', (await app.store.get('SELECT tenant_id FROM projects WHERE id=?', projectId)).tenant_id);
  app.store.run('UPDATE audit SET details=? WHERE seq=?', '{"tampered":true}', row.seq);
  assert.equal((await admin.request('/api/audit')).body.verification.valid, false);
  app.store.run('UPDATE audit SET details=? WHERE seq=?', row.details, row.seq);
  assert.equal((await admin.request('/api/audit')).body.verification.valid, true);
});
test('disabling users immediately invalidates sessions and retains history', async () => {
  const users = (await admin.request('/api/users')).body;
  const target = users.find(u => u.email === 'viewer@a.local');
  assert.equal((await admin.request(`/api/users/${target.id}/disable`, { method: 'POST', data: {} })).status, 200);
  assert.equal((await viewer.request('/api/me')).status, 401);
  assert.equal((await viewer.login('viewer@a.local')).status, 401);
});
test('password changes revoke old sessions', async () => {
  assert.equal((await analyst.request('/api/password', { method: 'POST', data: { currentPassword: 'wrong', password: 'Changed-Password-2026!' } })).status, 401);
  assert.equal((await analyst.request('/api/password', { method: 'POST', data: { currentPassword: password, password: 'Changed-Password-2026!' } })).status, 200);
  assert.equal((await analyst.request('/api/me')).status, 401);
});
test('data and completed results survive a server restart; interrupted jobs become failures', async () => {
  const tenant = app.store.get('SELECT tenant_id FROM projects WHERE id=?', projectId).tenant_id;
  app.store.run('INSERT INTO jobs(id,tenant_id,dataset_id,state,settings,created_by,created_at) VALUES(?,?,?,?,?,?,?)', 'interrupted-fixture', tenant, datasetId, 'running', '{}', 'system', new Date().toISOString());
  await app.close();
  app = await createApp({ directory }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await admin.request('/api/projects')).body[0].id, projectId);
  assert.equal((await admin.request(`/api/jobs/${jobId}/report`)).body.summary.keptVoxels, 1);
  assert.equal((await admin.request('/api/jobs/interrupted-fixture')).body.state, 'failed');
  assert.ok((await readFile(join(directory, 'voxelscope.sqlite'))).length > 0);
});
