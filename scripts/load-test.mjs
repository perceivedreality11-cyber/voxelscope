/** Reproducible loopback HTTP workload with distinct accounts and background analysis. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, platform, cpus } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app.js';

const clients = Number(process.argv[2] || 8), requestsPerClient = Number(process.argv[3] || 50);
if (!Number.isSafeInteger(clients) || clients < 1 || clients > 8 || !Number.isSafeInteger(requestsPerClient) || requestsPerClient < 1 || requestsPerClient > 10_000) throw new Error('Usage: node scripts/load-test.mjs [clients 1..8] [requests per client 1..10000]');
const directory = await mkdtemp(join(tmpdir(), 'voxelscope-load-'));
const password = 'Temporary-Workload-Fixture-2026!';
let app;
try {
  app = await createApp({ directory, bootstrap: { tenantName: 'Workload fixture', email: 'load@local', password } });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  function client() {
    let cookie = '', csrf = '';
    return async (path, method = 'GET', data, bytes, headers = {}) => {
      const response = await fetch(base + path, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf,
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: bytes || (data !== undefined ? JSON.stringify(data) : undefined) });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const value = await response.json();
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${value.error}`);
      if (value.csrf) csrf = value.csrf;
      return value;
    };
  }
  const admin = client(); await admin('/api/login', 'POST', { email: 'load@local', password });
  const project = await admin('/api/projects', 'POST', { name: 'Concurrent workload' });
  const bytes = new Uint8Array(64).fill(200); bytes[21] = 10;
  const meta = { projectId: project.id, name: 'Known one-pore fixture', dims: [4, 4, 4], spacing: [1, 1, 1], bits: 8 };
  const dataset = await admin('/api/datasets', 'POST', undefined, bytes, { 'Content-Type': 'application/octet-stream', 'X-Volume-Meta': encodeURIComponent(JSON.stringify(meta)) });
  const readers = [];
  for (let i = 0; i < clients; i++) {
    const email = `reader${i}@local`;
    await admin('/api/users', 'POST', { email, password, role: 'viewer' });
    const reader = client(); await reader('/api/login', 'POST', { email, password }); readers.push(reader);
  }
  const settings = { method: 'manual', threshold: 95, dark: true, connectivity: 26, minSize: 1, shape: 'box', inset: 0 };
  const jobs = [];
  for (let i = 0; i < clients; i++) jobs.push(await admin('/api/jobs', 'POST', { datasetId: dataset.id, settings }));
  const endpoints = ['/api/me', '/api/projects', `/api/datasets?project=${project.id}`, `/api/jobs?project=${project.id}`];
  const latencies = [], failures = [];
  const start = performance.now();
  await Promise.all(readers.map(async reader => {
    for (let i = 0; i < requestsPerClient; i++) {
      const requestStart = performance.now();
      try { await reader(endpoints[i % endpoints.length]); } catch (e) { failures.push(e.message); }
      latencies.push(performance.now() - requestStart);
    }
  }));
  const elapsedMs = performance.now() - start;
  for (const job of jobs) {
    const deadline = Date.now() + 30_000;
    while (true) {
      const state = await admin(`/api/jobs/${job.id}`);
      if (state.state === 'succeeded') break;
      assert.ok(['queued', 'running'].includes(state.state), state.error);
      assert.ok(Date.now() < deadline, 'Analysis workload timed out');
      await delay(20);
    }
    const report = await readers[0](`/api/jobs/${job.id}/report`);
    assert.equal(report.summary.porosity, 1 / 64);
  }
  latencies.sort((a, b) => a - b);
  const percentile = p => Math.round(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)] * 100) / 100;
  const result = { timestamp: new Date().toISOString(), node: process.version, platform: platform(), cpu: cpus()[0]?.model,
    scope: 'Local loopback HTTP, distinct viewer sessions, synthetic 4x4x4 data, one background analysis worker. TLS, real customer volumes and long-duration operation are separate deployment acceptance measurements.',
    clients, requestsPerClient, totalRequests: latencies.length, failures: failures.length, elapsedMs: Math.round(elapsedMs * 100) / 100,
    requestsPerSecond: Math.round(latencies.length / elapsedMs * 1000), latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    completedAnalysisJobs: jobs.length, exactMeasurementChecks: jobs.length, rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(failures, []);
} finally {
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}
