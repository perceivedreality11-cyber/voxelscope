import { Worker } from 'node:worker_threads';
import { join } from 'node:path';

/** Persistent queue; one analysis at a time, with a hard wall-clock timeout. */
export function createQueue(store, { timeout = 120_000 } = {}) {
  let active = null, closed = false;
  // A killed process cannot finish a running job: make the interruption explicit.
  store.transaction(() => {
    for (const job of store.all("SELECT * FROM jobs WHERE state='running'")) {
      store.run("UPDATE jobs SET state='failed',error='Server restarted during analysis',finished_at=? WHERE id=?", new Date().toISOString(), job.id);
      store.audit(job.tenant_id, 'system', 'job.interrupted', job.id);
    }
  });
  function pump() {
    if (closed || active) return;
    const job = store.get("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1");
    if (!job) return;
    const dataset = store.get('SELECT * FROM datasets WHERE id=? AND tenant_id=?', job.dataset_id, job.tenant_id);
    store.transaction(() => {
      store.run("UPDATE jobs SET state='running' WHERE id=?", job.id);
      store.audit(job.tenant_id, 'system', 'job.started', job.id);
    });
    const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { workerData: {
      inputPath: join(store.directory, 'volumes', `${dataset.id}.bin`),
      outputPath: join(store.directory, 'results', job.id), meta: JSON.parse(dataset.meta), settings: JSON.parse(job.settings),
      provenance: { jobId: job.id, datasetId: dataset.id, sha256: dataset.sha256, requestedBy: job.created_by },
    }, resourceLimits: { maxOldGenerationSizeMb: 384 } });
    active = { worker, id: job.id };
    let finished = false;
    const finish = (state, error = null, elapsed = null) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (!closed) store.transaction(() => {
        store.run('UPDATE jobs SET state=?,error=?,finished_at=?,elapsed_ms=? WHERE id=?', state, error, new Date().toISOString(), elapsed, job.id);
        store.audit(job.tenant_id, 'system', `job.${state}`, job.id, error ? { error } : { elapsedMs: elapsed });
      });
      active = null;
      void worker.terminate();
      if (!closed) setImmediate(pump);
    };
    const timer = setTimeout(() => finish('failed', 'Analysis exceeded its time limit'), timeout);
    worker.on('message', message => message.ok ? finish('succeeded', null, message.elapsed) : finish('failed', message.error));
    worker.on('error', e => finish('failed', e.message));
    worker.on('exit', code => { if (!finished) finish('failed', `Worker exited before completion (${code})`); });
    active.cancel = () => finish('cancelled', 'Cancelled by user');
  }
  return { pump,
    cancel(id) { if (active?.id === id) active.cancel(); },
    async close() { closed = true; if (active) await active.worker.terminate(); },
  };
}
