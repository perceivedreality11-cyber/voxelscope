import test from 'node:test';
import assert from 'node:assert/strict';
import { planRawRegion, readRawRegion, RAW_READ_CHUNK_BYTES } from '../src/raw-volume.js';

const base = { dims: [8, 6, 4], spacing: [2, 3, 5], bits: 16, offset: 5, littleEndian: false };
function fixture(options = base) {
  const bytes = new Uint8Array(options.offset + options.dims.reduce((n, v) => n * v, options.bits / 8));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < (bytes.length - options.offset) / (options.bits / 8); i++) {
    if (options.bits === 16) view.setUint16(options.offset + i * 2, 1000 + i, options.littleEndian);
    else view.setUint8(options.offset + i, i % 256);
  }
  return new Blob([bytes]);
}

test('RAW region import crops and subsamples all three axes, preserving uint16 BE and physical spacing', async () => {
  const result = await readRawRegion(fixture(), { ...base, origin: [1, 1, 0], size: [6, 4, 4], stride: [2, 2, 2] });
  assert.deepEqual(result.dims, [3, 2, 2]);
  assert.deepEqual(result.spacing, [4, 6, 10]);
  const expected = [];
  for (const z of [0, 2]) for (const y of [1, 3]) for (const x of [1, 3, 5]) expected.push(1000 + x + 8 * (y + 6 * z));
  assert.deepEqual([...result.data], expected);
  assert.deepEqual(result.rawSource.size, [6, 4, 4]);
});

test('RAW full-grid import and zero-size remaining extent retain exact native bytes', async () => {
  const options = { dims: [5, 4, 3], spacing: [1, 2, 3], bits: 8, offset: 3 };
  const result = await readRawRegion(fixture(options), options);
  assert.deepEqual([...result.data], Array.from({ length: 60 }, (_, i) => i));
  const cropped = await readRawRegion(fixture(options), { ...options, origin: [1, 1, 1] });
  assert.deepEqual(cropped.dims, [4, 3, 2]);
  assert.equal(cropped.data[0], 26);
});

test('RAW reader addresses beyond 4 GiB with a bounded virtual 8 GiB source', async () => {
  // Virtual File adapter: exercises large offsets without allocating or claiming a real 8 GiB scan.
  const options = { dims: [2048, 2048, 1024], spacing: [1, 1, 1], bits: 16, offset: 5, littleEndian: true,
    origin: [17, 19, 700], size: [8, 8, 4], stride: [2, 2, 2] };
  const requests = [];
  const source = { size: 8 * 1024 ** 3 + 5, slice(start, end) {
    requests.push({ start, end });
    return { async arrayBuffer() {
      const bytes = new Uint8Array(end - start);
      for (let i = 0; i < bytes.length; i++) {
        const position = start + i - options.offset, value = Math.floor(position / 2) % 65536;
        bytes[i] = position % 2 ? Math.floor(value / 256) : value % 256;
      }
      return bytes.buffer;
    } };
  } };
  const result = await readRawRegion(source, options);
  assert.deepEqual(result.dims, [4, 4, 2]);
  const expected = [];
  for (let z = 700; z < 704; z += 2) for (let y = 19; y < 27; y += 2) for (let x = 17; x < 25; x += 2) expected.push((x + 2048 * (y + 2048 * z)) % 65536);
  assert.deepEqual([...result.data], expected);
  assert.ok(requests.every(r => r.start > 2 ** 32 && r.end - r.start <= RAW_READ_CHUNK_BYTES));
});

test('RAW reader batches rows within its fixed read budget and reports completed output', async () => {
  const options = { dims: [1024, 1024, 4], spacing: [1, 1, 1], bits: 16, stride: [2, 1, 1] };
  const lengths = [], progress = [];
  const source = { size: 8 * 1024 ** 2, slice(start, end) { lengths.push(end - start); return { async arrayBuffer() { return new ArrayBuffer(end - start); } }; } };
  const result = await readRawRegion(source, options, { onProgress: p => progress.push(p) });
  assert.equal(result.data.length, 2_097_152);
  assert.ok(Math.max(...lengths) <= RAW_READ_CHUNK_BYTES);
  assert.ok(lengths.length < 20, 'Nearby rows should be batched, not read one at a time');
  assert.equal(progress.at(-1).completed, result.data.length);
});

test('RAW reader cancels before reads and after asynchronous slice completion', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readRawRegion(fixture(), base, { signal: controller.signal }), { name: 'AbortError' });
  const later = new AbortController();
  const source = { size: fixture().size, slice(start, end) { return { async arrayBuffer() { later.abort(); return new ArrayBuffer(end - start); } }; } };
  await assert.rejects(readRawRegion(source, base, { signal: later.signal }), { name: 'AbortError' });
});

test('RAW import rejects invalid regions, unsafe addresses, overlarge grids and short reads', async () => {
  assert.throws(() => planRawRegion({ ...base, stride: [0, 1, 1] }), /stride/);
  assert.throws(() => planRawRegion({ ...base, origin: [7, 0, 0], size: [2, 2, 2] }), /inside/);
  assert.throws(() => planRawRegion({ ...base, dims: [1_000_000, 1_000_000, 1_000_000] }), /safe integer/);
  assert.throws(() => planRawRegion({ ...base, dims: [2048, 2048, 2048] }), /Volume exceeds/);
  await assert.rejects(readRawRegion(new Blob([new Uint8Array(2)]), base), /byte count/);
  await assert.rejects(readRawRegion({ size: fixture().size, slice() { return { async arrayBuffer() { return new ArrayBuffer(1); } }; } }, base), /incomplete/);
});
