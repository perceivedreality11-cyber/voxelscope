import { analyze, makeDemo, pointCloud, VERSION } from '../src/core.js';
import { platform, arch, cpus } from 'node:os';
const results = [];
for (const size of [64, 96, 128]) {
  const v = makeDemo(size, 42), start = performance.now();
  const r = analyze(v, { method: 'otsu', minSize: 1 });
  const cloud = pointCloud(r, v.dims, v.spacing), elapsed = performance.now() - start;
  if (r.summary.segmentedVoxels !== v.source.truthCount) throw new Error('Phantom truth mismatch.');
  results.push({ size, voxels: v.data.length, elapsedMs: Math.round(elapsed * 100) / 100, components: r.summary.componentCount, porosity: r.summary.porosity, truthCount: v.source.truthCount, renderedPoints: cloud.renderedPoints, rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
}
console.log(JSON.stringify({ engine: VERSION, timestamp: new Date().toISOString(), node: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, note: 'Single local run; excludes phantom generation and network/disk I/O. Synthetic validation only, not a concurrency or real-CT accuracy benchmark.', results }, null, 2));
