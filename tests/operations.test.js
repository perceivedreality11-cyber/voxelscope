import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app.js';
const exec = promisify(execFile);
const password = 'Operations-Integration-Test-2026!';
const settings = { method: 'manual', threshold: 95, dark: true, connectivity: 26, minSize: 1, shape: 'box', inset: 0 };

async function setup(config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'voxelscope-ops-'));
  const app = await createApp({ directory, bootstrap: { tenantName: 'Operations', email: 'ops@local', password }, ...config });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let csrf = '', cookie = '';
  async function request(path, method = 'GET', data, extra = {}) {
    const response = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), 'X-CSRF-Token': csrf, ...(data ? { 'Content-Type': 'application/json' } : {}), ...extra.headers }, body: extra.bytes || (data ? JSON.stringify(data) : undefined) });
    const result = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (result.csrf) csrf = result.csrf;
    return { ...result, status: response.status };
  }
  await request('/api/login', 'POST', { email: 'ops@local', password });
  const project = await request('/api/projects', 'POST', { name: 'Operations fixture' });
  async function upload() {
    const meta = { projectId: project.id, name: 'Small fixture', dims: [4, 4, 4], spacing: [1, 1, 1], bits: 8 };
    return request('/api/datasets', 'POST', null, { bytes: new Uint8Array(64).fill(10), headers: { 'Content-Type': 'application/octet-stream', 'X-Volume-Meta': encodeURIComponent(JSON.stringify(meta)) } });
  }
  return { app, directory, request, projectId: project.id, upload, async close() { await app.close(); await rm(directory, { recursive: true, force: true }); } };
}
test('storage quota is enforced under concurrent upload requests', async () => {
  const s = await setup({ quotaBytes: 100 });
  try {
    const results = await Promise.all([s.upload(), s.upload(), s.upload()]);
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.equal(results.filter(r => r.status === 413).length, 2);
  } finally { await s.close(); }
});
test('worker wall-clock timeout persists failure and keeps API responsive', async () => {
  const s = await setup({ jobTimeout: 1 });
  try {
    const dataset = await s.upload();
    const job = await s.request('/api/jobs', 'POST', { datasetId: dataset.id, settings });
    let result;
    for (let i = 0; i < 100; i++) { result = await s.request(`/api/jobs/${job.id}`); if (result.state === 'failed') break; await delay(15); }
    assert.equal(result.state, 'failed'); assert.match(result.error, /time limit/);
    assert.equal((await s.request('/api/health')).status, 200);
  } finally { await s.close(); }
});
test('queued and active jobs can both be cancelled', async () => {
  const s = await setup();
  try {
    const dataset = await s.request('/api/demo', 'POST', { projectId: s.projectId });
    const first = await s.request('/api/jobs', 'POST', { datasetId: dataset.id, settings });
    const second = await s.request('/api/jobs', 'POST', { datasetId: dataset.id, settings });
    assert.equal((await s.request(`/api/jobs/${second.id}/cancel`, 'POST', {})).status, 200);
    assert.equal((await s.request(`/api/jobs/${second.id}`)).state, 'cancelled');
    assert.equal((await s.request(`/api/jobs/${first.id}/cancel`, 'POST', {})).status, 200);
    assert.equal((await s.request(`/api/jobs/${first.id}`)).state, 'cancelled');
    assert.equal((await s.request(`/api/jobs/${first.id}/report`)).status, 409);
  } finally { await s.close(); }
});
test('snapshot backup restores projects, immutable volumes and completed results', async () => {
  const s = await setup(); const backupRoot = await mkdtemp(join(tmpdir(), 'voxelscope-backup-test-'));
  let restored;
  try {
    const dataset = await s.upload();
    const job = await s.request('/api/jobs', 'POST', { datasetId: dataset.id, settings });
    for (let i = 0; i < 100; i++) { if ((await s.request(`/api/jobs/${job.id}`)).state === 'succeeded') break; await delay(20); }
    const target = join(backupRoot, 'snapshot');
    await exec(process.execPath, [resolve('scripts/backup.mjs'), target], { env: { ...process.env, DATA_DIR: s.directory } });
    const manifest = JSON.parse(await readFile(join(target, 'BACKUP.json'), 'utf8')); assert.equal(manifest.complete, true);
    restored = await createApp({ directory: target });
    assert.equal(restored.store.get('SELECT id FROM projects WHERE id=?', s.projectId).id, s.projectId);
    assert.equal((await readFile(join(target, 'volumes', `${dataset.id}.bin`))).length, 64);
    assert.equal(JSON.parse(await readFile(join(target, 'results', job.id, 'report.json'), 'utf8')).summary.porosity, 1);
    await new Promise(done => restored.server.listen(0, '127.0.0.1', done));
  } finally {
    if (restored) await restored.close(); await s.close(); await rm(backupRoot, { recursive: true, force: true });
  }
});
test('login attempts are rate limited', async () => {
  const s = await setup();
  try {
    let result;
    for (let i = 0; i < 13; i++) result = await s.request('/api/login', 'POST', { email: 'nobody@local', password: 'wrong' });
    assert.equal(result.status, 429);
  } finally { await s.close(); }
});
test('analysis detects corruption of a stored volume before producing measurements', async () => {
  const s = await setup();
  try {
    const dataset = await s.upload();
    await writeFile(join(s.directory, 'volumes', `${dataset.id}.bin`), new Uint8Array(64).fill(200));
    const job = await s.request('/api/jobs', 'POST', { datasetId: dataset.id, settings });
    let result;
    for (let i = 0; i < 100; i++) { result = await s.request(`/api/jobs/${job.id}`); if (result.state === 'failed') break; await delay(20); }
    assert.equal(result.state, 'failed'); assert.match(result.error, /SHA-256 mismatch/);
  } finally { await s.close(); }
});
