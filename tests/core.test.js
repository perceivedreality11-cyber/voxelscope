import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, makeDemo, makeROI, decodeRaw, validateDimensions, validateSpacing, histogram, otsu, pointCloud } from '../src/core.js';

function volume(dims = [5, 5, 5], spacing = [2, 3, 4]) { return { dims, spacing, data: new Uint8Array(dims.reduce((a, b) => a * b)).fill(200) }; }
const idx = (v, x, y, z) => x + v.dims[0] * (y + v.dims[1] * z);
const options = { threshold: 95, minSize: 1, connectivity: 6 };

test('single interior pore has exact anisotropic volume, centroid, area and porosity', () => {
  const v = volume(); v.data[idx(v, 2, 2, 2)] = 10;
  const r = analyze(v, options), c = r.components[0];
  assert.equal(r.summary.keptVoxels, 1); assert.equal(r.summary.porosity, 1 / 125);
  assert.equal(c.volumeUm3, 24); assert.equal(c.faceAreaUm2, 52);
  assert.deepEqual(c.centroidUm, [5, 7.5, 10]); assert.equal(c.touchesROI, false);
  assert.ok(Math.abs(c.equivalentDiameterUm - Math.cbrt(144 / Math.PI)) < 1e-10);
});
test('6 and 26 connectivity differ at diagonal contacts', () => {
  const v = volume(); v.data[idx(v, 1, 1, 1)] = 20; v.data[idx(v, 2, 2, 2)] = 20;
  assert.equal(analyze(v, { ...options, connectivity: 6 }).components.length, 2);
  assert.equal(analyze(v, { ...options, connectivity: 26 }).components.length, 1);
});
test('minimum size filtering preserves raw porosity and excludes rejected labels', () => {
  const v = volume(); v.data[idx(v, 1, 1, 1)] = 10;
  const r = analyze(v, { ...options, minSize: 2 });
  assert.equal(r.summary.rawPorosity, 1 / 125); assert.equal(r.summary.porosity, 0);
  assert.equal(r.summary.filteredComponents, 1); assert.equal(r.labels.reduce((a, b) => a + b), 0);
});
test('adjacent voxels lose their shared surface faces', () => {
  const v = volume(); v.data[idx(v, 2, 2, 2)] = v.data[idx(v, 3, 2, 2)] = 0;
  assert.equal(analyze(v, options).components[0].faceAreaUm2, 2 * 52 - 2 * 3 * 4);
});
test('ROI boundary contact is correctly recorded at both specimen and cropped edges', () => {
  const v = volume(); v.data[idx(v, 0, 2, 2)] = v.data[idx(v, 1, 2, 2)] = 0;
  assert.equal(analyze(v, options).summary.boundaryPoreFraction, 1);
  const cropped = analyze(v, { ...options, inset: 0.2 });
  assert.equal(cropped.summary.roiVoxels, 27); assert.equal(cropped.summary.keptVoxels, 1); assert.equal(cropped.components[0].touchesROI, true);
});
test('bright polarity uses strictly greater than the threshold', () => {
  const v = volume(); v.data.fill(95); v.data[0] = 96;
  assert.equal(analyze(v, { ...options, dark: false }).summary.keptVoxels, 1);
});
test('scanline connectivity never wraps rows or planes', () => {
  const v = volume([4, 4, 4]); v.data[idx(v, 3, 1, 1)] = v.data[idx(v, 0, 2, 1)] = 0;
  assert.equal(analyze(v, { ...options, connectivity: 26 }).components.length, 2);
});
test('Otsu separates the deterministic phantom exactly before filtering', () => {
  const v = makeDemo(40, 42), r = analyze(v, { method: 'otsu', minSize: 1 });
  assert.equal(r.summary.segmentedVoxels, v.source.truthCount);
  assert.equal(r.summary.porosity, v.source.truthPorosity);
  assert.deepEqual(makeDemo(40, 42).data, v.data);
  assert.notDeepEqual(makeDemo(40, 43).data, v.data);
});
test('16-bit RAW endian and header decoding do not discard precision', () => {
  const buffer = new ArrayBuffer(18), view = new DataView(buffer);
  for (let i = 0; i < 8; i++) view.setUint16(2 + i * 2, 1000 + i * 5000, false);
  assert.deepEqual(Array.from(decodeRaw(buffer, [2, 2, 2], { bits: 16, littleEndian: false, offset: 2 })), [1000, 6000, 11000, 16000, 21000, 26000, 31000, 36000]);
  assert.throws(() => decodeRaw(buffer, [2, 2, 2]), /byte count/);
});
test('native uint16 analysis preserves exact manual threshold comparisons', () => {
  const v = volume([2, 2, 2]); v.data = new Uint16Array([1000, 2000, 3000, 4000, 5000, 6000, 65534, 65535]);
  assert.equal(analyze(v, { ...options, threshold: 3000 }).summary.keptVoxels, 3);
});
test('profile conserves retained and ROI volumes including excluded planes', () => {
  const v = makeDemo(32), r = analyze(v, { ...options, shape: 'cylinder', inset: 0.2 });
  assert.equal(r.profile.reduce((s, p) => s + p.poreVoxels, 0), r.summary.keptVoxels);
  assert.equal(r.profile.reduce((s, p) => s + p.roiVoxels, 0), r.summary.roiVoxels);
  assert.equal(r.profile[0].porosity, null);
  assert.ok(r.sensitivity.every((p, i, arr) => !i || p.rawPorosity >= arr[i - 1].rawPorosity));
});
test('point sampling obeys limits and physical anisotropy', () => {
  const v = volume(); v.data.fill(0); const r = analyze(v, options), cloud = pointCloud(r, v.dims, v.spacing, 10);
  assert.equal(cloud.renderedPoints, 10); assert.equal(cloud.vertices.length, 40);
  assert.equal(cloud.surfaceVoxels, 125 - 27); assert.ok(cloud.extent[0] < cloud.extent[2]);
  assert.ok(Array.from(cloud.vertices).every(Number.isFinite));
});
test('empty pore mask yields finite zero metrics and no points', () => {
  const v = volume(); const r = analyze(v, options);
  assert.equal(r.summary.porosity, 0); assert.equal(r.summary.largestComponentFraction, 0);
  assert.equal(pointCloud(r, v.dims, v.spacing).vertices.length, 0);
});
test('invalid dimensions, spacing and analysis settings fail explicitly', () => {
  for (const dims of [[1, 2, 2], [2.1, 2, 2], [256, 256, 256], [2, 2]]) assert.throws(() => validateDimensions(dims));
  for (const s of [[0, 1, 1], [1, NaN, 1], [1, 1, Infinity]]) assert.throws(() => validateSpacing(s));
  for (const opts of [{ connectivity: 18 }, { minSize: 0 }, { threshold: NaN }, { inset: -1 }, { shape: 'banana' }]) assert.throws(() => analyze(volume(), opts));
});
test('ROI histogram excludes external regions and includes extreme values', () => {
  const v = volume(); v.data[0] = 0;
  const { roi } = makeROI(v.dims, { inset: 0.2 });
  const hist = histogram(v.data, roi); assert.equal(hist.min, 200); assert.equal(hist.max, 200);
  assert.equal(hist.counts.reduce((a, b) => a + b), 27);
  assert.ok(Number.isFinite(otsu(hist)));
});
