import { parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { analyze, pointCloud, decodeRaw, VERSION } from '../src/core.js';
try {
  const { inputPath, outputPath, meta, settings, provenance } = workerData;
  const bytes = await readFile(inputPath);
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.sha256) throw new Error('Dataset SHA-256 mismatch: stored volume was modified.');
  const data = decodeRaw(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), meta.dims, { bits: meta.bits, littleEndian: true });
  const start = performance.now();
  const result = analyze({ data, dims: meta.dims, spacing: meta.spacing }, settings);
  const cloud = pointCloud(result, meta.dims, meta.spacing);
  const elapsed = performance.now() - start;
  const { labels, roi, ...report } = result;
  const { vertices, ...cloudMeta } = cloud;
  await mkdir(outputPath, { recursive: true });
  // Explicit LE encoding makes result files portable across architectures.
  const labelBytes = Buffer.alloc(labels.length * 4), vertexBytes = Buffer.alloc(vertices.length * 4);
  for (let i = 0; i < labels.length; i++) labelBytes.writeUInt32LE(labels[i], i * 4);
  for (let i = 0; i < vertices.length; i++) vertexBytes.writeFloatLE(vertices[i], i * 4);
  await Promise.all([
    writeFile(join(outputPath, 'labels.bin'), labelBytes), writeFile(join(outputPath, 'roi.bin'), roi),
    writeFile(join(outputPath, 'vertices.bin'), vertexBytes),
    writeFile(join(outputPath, 'report.json'), JSON.stringify({ ...report, cloud: cloudMeta, provenance: { ...provenance, engine: VERSION, createdAt: new Date().toISOString(), elapsedMs: elapsed }, volume: meta })),
  ]);
  parentPort.postMessage({ ok: true, elapsed });
} catch (e) { parentPort.postMessage({ ok: false, error: e.message }); }
