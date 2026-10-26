/** Pure, deterministic analysis. Axis order: x fastest, then y, then z. */
export const MAX_VOXELS = 4_194_304;
export const VERSION = '1.0.0';

export function validateDimensions(dims) {
  if (!Array.isArray(dims) || dims.length !== 3 || !dims.every(n => Number.isSafeInteger(n) && n >= 2 && n <= 2048)) {
    throw new Error('Each dimension must be an integer between 2 and 2048.');
  }
  const n = dims[0] * dims[1] * dims[2];
  if (n > MAX_VOXELS) throw new Error(`Volume exceeds ${MAX_VOXELS.toLocaleString()} voxels. Crop or downsample before importing.`);
  return n;
}

export function validateSpacing(spacing) {
  if (!Array.isArray(spacing) || spacing.length !== 3 || !spacing.every(n => Number.isFinite(n) && n >= 0.001 && n <= 1e6)) {
    throw new Error('Voxel spacing must be between 0.001 and 1,000,000 µm.');
  }
}

export function decodeRaw(buffer, dims, { bits = 8, littleEndian = true, offset = 0 } = {}) {
  const n = validateDimensions(dims);
  if (![8, 16].includes(bits) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid RAW format.');
  if (buffer.byteLength !== offset + n * bits / 8) throw new Error('RAW byte count does not match dimensions, bit depth and header offset.');
  const view = new DataView(buffer, offset);
  const data = bits === 8 ? new Uint8Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) data[i] = bits === 8 ? view.getUint8(i) : view.getUint16(i * 2, littleEndian);
  return data;
}

export function makeDemo(size = 96, seed = 42) {
  const dims = [size, size, size];
  validateDimensions(dims);
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const pores = Array.from({ length: 72 }, () => ({
    x: 0.06 + random() * 0.88, y: 0.06 + random() * 0.88, z: 0.06 + random() * 0.88,
    rx: 0.014 + random() * 0.064, ry: 0.015 + random() * 0.042, rz: 0.018 + random() * 0.080,
  }));
  const data = new Uint8Array(size ** 3);
  let truthCount = 0;
  for (let z = 0, i = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++, i++) {
    const X = x / (size - 1), Y = y / (size - 1), Z = z / (size - 1);
    let pore = (X - 0.47 - 0.07 * Math.sin(Z * 9)) ** 2 + (Y - 0.49 - 0.08 * Math.cos(Z * 7)) ** 2 < 0.022 ** 2;
    for (const p of pores) {
      if (Math.abs(X - p.x) > p.rx || Math.abs(Y - p.y) > p.ry || Math.abs(Z - p.z) > p.rz) continue;
      if (((X - p.x) / p.rx) ** 2 + ((Y - p.y) / p.ry) ** 2 + ((Z - p.z) / p.rz) ** 2 < 1) { pore = true; break; }
    }
    if (pore) truthCount++;
    data[i] = pore ? 28 + Math.floor(random() * 44) : Math.min(255, Math.round(174 + 21 * Math.sin(X * 80 + Math.sin(Y * 24)) + 12 * Math.cos(Z * 60) + random() * 28));
  }
  return { data, dims, spacing: [8, 8, 12], source: { name: 'Woven composite · synthetic phantom', kind: 'synthetic', seed, truthCount, truthPorosity: truthCount / data.length } };
}

export function makeROI(dims, { shape = 'box', inset = 0 } = {}) {
  const n = validateDimensions(dims);
  if (!['box', 'cylinder'].includes(shape) || !Number.isFinite(inset) || inset < 0 || inset > 0.4) throw new Error('Invalid ROI.');
  const [w, h, d] = dims;
  const margin = dims.map(n => Math.floor(n * inset));
  const roi = new Uint8Array(n);
  let count = 0;
  for (let z = margin[2]; z < d - margin[2]; z++) for (let y = margin[1]; y < h - margin[1]; y++) for (let x = margin[0]; x < w - margin[0]; x++) {
    if (shape === 'cylinder') {
      const rx = (w - margin[0] * 2) / 2, ry = (h - margin[1] * 2) / 2;
      if (((x + 0.5 - w / 2) / rx) ** 2 + ((y + 0.5 - h / 2) / ry) ** 2 > 1) continue;
    }
    roi[x + w * (y + h * z)] = 1;
    count++;
  }
  return { roi, count };
}

export function histogram(data, roi, bins = 256) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) if (!roi || roi[i]) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
  if (!Number.isFinite(min)) throw new Error('Empty ROI.');
  const counts = new Uint32Array(bins);
  const step = max > min ? (max - min) / (bins - 1) : 1;
  for (let i = 0; i < data.length; i++) if (!roi || roi[i]) counts[Math.round((data[i] - min) / step)]++;
  return { min, max, step, counts: Array.from(counts) };
}

export function otsu(hist) {
  const { counts, min, step } = hist;
  const total = counts.reduce((a, b) => a + b, 0);
  let sum = 0;
  counts.forEach((n, i) => { sum += n * i; });
  let weight = 0, partial = 0, best = -1, threshold = 0;
  counts.forEach((n, i) => {
    weight += n; partial += i * n;
    if (!weight || weight === total) return;
    const delta = partial / weight - (sum - partial) / (total - weight);
    const score = weight * (total - weight) * delta * delta;
    if (score > best) { best = score; threshold = i; }
  });
  // Bin centres align with rounded values; include all values in the winning bin.
  return Math.min(hist.max, min + (threshold + 0.5) * step);
}

export function analyze(volume, options = {}) {
  const { data, dims, spacing } = volume;
  const n = validateDimensions(dims);
  validateSpacing(spacing);
  if (!(data instanceof Uint8Array || data instanceof Uint16Array) || data.length !== n) throw new Error('Expected unsigned 8/16-bit volume.');
  const settings = { method: 'manual', threshold: 95, dark: true, connectivity: 26, minSize: 4, shape: 'box', inset: 0, ...options };
  if (!['manual', 'otsu'].includes(settings.method) || ![6, 26].includes(settings.connectivity) || !Number.isFinite(settings.threshold) || settings.threshold < 0 || settings.threshold > 65535 || !Number.isSafeInteger(settings.minSize) || settings.minSize < 1 || settings.minSize > n || typeof settings.dark !== 'boolean') throw new Error('Invalid analysis settings.');
  const { roi, count: roiVoxels } = makeROI(dims, settings);
  const hist = histogram(data, roi);
  const threshold = settings.method === 'otsu' ? otsu(hist) : settings.threshold;
  const labels = new Uint32Array(n), candidates = new Uint8Array(n), queue = new Uint32Array(n);
  let segmentedVoxels = 0;
  for (let i = 0; i < n; i++) if (roi[i] && (settings.dark ? data[i] <= threshold : data[i] > threshold)) { candidates[i] = 1; segmentedVoxels++; }
  const [w, h, d] = dims, plane = w * h;
  const voxelVolume = spacing[0] * spacing[1] * spacing[2];
  const offsets = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (dist && (settings.connectivity === 26 || dist === 1)) offsets.push([dx, dy, dz]);
  }
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const components = [];
  let id = 0, keptVoxels = 0, boundaryVoxels = 0, filteredComponents = 0;
  const profileCount = new Uint32Array(d), profileROI = new Uint32Array(d);
  for (let i = 0; i < n; i++) if (roi[i]) profileROI[Math.floor(i / plane)]++;
  for (let start = 0; start < n; start++) {
    if (!candidates[start] || labels[start]) continue;
    if (++id > 100_000) throw new Error('Over 100,000 components: denoise or crop the volume first.');
    let head = 0, tail = 1, sx = 0, sy = 0, sz = 0, area = 0, boundary = false;
    let lo = [w, h, d], hi = [0, 0, 0];
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / plane);
      sx += x + 0.5; sy += y + 0.5; sz += z + 0.5;
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
      for (let f = 0; f < faces.length; f++) {
        const [dx, dy, dz] = faces[f], X = x + dx, Y = y + dy, Z = z + dz;
        const inside = X >= 0 && X < w && Y >= 0 && Y < h && Z >= 0 && Z < d;
        const j = X + w * (Y + h * Z);
        if (!inside || !roi[j]) boundary = true;
        if (!inside || !candidates[j]) area += f < 2 ? spacing[1] * spacing[2] : f < 4 ? spacing[0] * spacing[2] : spacing[0] * spacing[1];
      }
      for (const [dx, dy, dz] of offsets) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || X >= w || Y < 0 || Y >= h || Z < 0 || Z >= d) continue;
        const j = X + w * (Y + h * Z);
        if (candidates[j] && !labels[j]) { labels[j] = id; queue[tail++] = j; }
      }
    }
    if (tail < settings.minSize) {
      filteredComponents++;
      // A sentinel prevents rejected components being visited a second time.
      for (let q = 0; q < tail; q++) labels[queue[q]] = 0xffffffff;
      continue;
    }
    keptVoxels += tail;
    if (boundary) boundaryVoxels += tail;
    for (let q = 0; q < tail; q++) profileCount[Math.floor(queue[q] / plane)]++;
    const physicalVolume = tail * voxelVolume;
    components.push({ id, voxels: tail, volumeUm3: physicalVolume,
      equivalentDiameterUm: Math.cbrt(6 * physicalVolume / Math.PI),
      faceAreaUm2: area, touchesROI: boundary,
      centroidUm: [sx / tail * spacing[0], sy / tail * spacing[1], sz / tail * spacing[2]],
      boundsVoxel: [lo, hi] });
  }
  for (let i = 0; i < n; i++) if (labels[i] === 0xffffffff) labels[i] = 0;
  components.sort((a, b) => b.voxels - a.voxels || a.id - b.id);
  const delta = Math.max(1, (hist.max - hist.min) * 0.025);
  const sensitivity = [-2, -1, 0, 1, 2].map(k => {
    const t = Math.max(0, Math.min(65535, threshold + k * delta));
    let count = 0;
    for (let i = 0; i < n; i++) if (roi[i] && (settings.dark ? data[i] <= t : data[i] > t)) count++;
    return { threshold: t, rawPorosity: count / roiVoxels };
  });
  return { labels, roi, histogram: hist, components,
    settings: { ...settings, effectiveThreshold: threshold },
    summary: { totalVoxels: n, roiVoxels, segmentedVoxels, keptVoxels, filteredVoxels: segmentedVoxels - keptVoxels,
      filteredComponents, porosity: keptVoxels / roiVoxels, rawPorosity: segmentedVoxels / roiVoxels,
      roiVolumeUm3: roiVoxels * voxelVolume, poreVolumeUm3: keptVoxels * voxelVolume,
      componentCount: components.length, boundaryComponentCount: components.filter(c => c.touchesROI).length,
      boundaryVoxels, boundaryPoreFraction: keptVoxels ? boundaryVoxels / keptVoxels : 0,
      largestComponentFraction: keptVoxels ? components[0].voxels / keptVoxels : 0 },
    profile: Array.from(profileCount, (count, z) => ({ z, positionUm: (z + 0.5) * spacing[2], roiVoxels: profileROI[z], poreVoxels: count, porosity: profileROI[z] ? count / profileROI[z] : null })),
    sensitivity };
}

/** A deterministic subsample of exposed voxel centres; visualization only. */
export function pointCloud(result, dims, spacing, limit = 100_000) {
  const { labels } = result, [w, h, d] = dims, plane = w * h;
  const size = dims.map((v, a) => v * spacing[a]), scale = Math.max(...size);
  const surfaces = [];
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / plane);
    if (!x || x === w - 1 || !y || y === h - 1 || !z || z === d - 1 || !labels[i - 1] || !labels[i + 1] || !labels[i - w] || !labels[i + w] || !labels[i - plane] || !labels[i + plane]) surfaces.push(i);
  }
  const count = Math.min(limit, surfaces.length), vertices = new Float32Array(count * 4);
  const componentSizes = new Map(result.components.map(c => [c.id, c.voxels]));
  const largest = result.components[0]?.voxels || 1;
  for (let p = 0; p < count; p++) {
    const i = surfaces[Math.floor(p * surfaces.length / count)];
    const xyz = [i % w, Math.floor(i / w) % h, Math.floor(i / plane)];
    for (let a = 0; a < 3; a++) vertices[p * 4 + a] = ((xyz[a] + 0.5) * spacing[a] - size[a] / 2) / scale * 1.65;
    vertices[p * 4 + 3] = Math.log1p(componentSizes.get(labels[i])) / Math.log1p(largest);
  }
  return { vertices, renderedPoints: count, surfaceVoxels: surfaces.length, extent: size.map(v => v / scale * 1.65) };
}
