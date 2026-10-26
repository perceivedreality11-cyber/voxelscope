import { validateDimensions, validateSpacing } from './core.js';

export const RAW_READ_CHUNK_BYTES = 4 * 1024 * 1024;
const invalid = message => Object.assign(new Error(message), { status: 400 });
const triple = (value, min, max) => Array.isArray(value) && value.length === 3 && value.every(n => Number.isSafeInteger(n) && n >= min && n <= max);

/** Source dimensions are independent of the bounded analysis grid. Zero size means remaining extent. */
export function planRawRegion(options = {}) {
  if (!options || typeof options !== 'object') throw invalid('Invalid RAW source parameters.');
  const { dims, spacing, bits = 8, offset = 0, littleEndian = true, origin = [0, 0, 0], size = [0, 0, 0], stride = [1, 1, 1] } = options;
  if (!triple(dims, 2, 1_000_000) || ![8, 16].includes(bits) || !Number.isSafeInteger(offset) || offset < 0 || typeof littleEndian !== 'boolean') throw invalid('Invalid RAW source dimensions, bit depth or header.');
  validateSpacing(spacing);
  if (!triple(origin, 0, 999_999) || !triple(size, 0, 1_000_000) || !triple(stride, 1, 1_000_000)) throw invalid('Invalid RAW region or sampling stride.');
  const bytesPerVoxel = bits / 8;
  const expectedBytes = dims.reduce((n, v) => n * v, bytesPerVoxel) + offset;
  if (!Number.isSafeInteger(expectedBytes)) throw invalid('RAW source byte count exceeds safe integer addressing.');
  const extent = size.map((v, a) => v || dims[a] - origin[a]);
  if (extent.some((v, a) => v < 1 || origin[a] + v > dims[a])) throw invalid('RAW region must lie inside the source volume.');
  const outputDims = extent.map((v, a) => Math.ceil(v / stride[a]));
  const outputSpacing = spacing.map((v, a) => v * stride[a]);
  const voxels = validateDimensions(outputDims);
  validateSpacing(outputSpacing);
  return { source: { dims: [...dims], spacing: [...spacing], bits, offset, littleEndian, origin: [...origin], size: extent, stride: [...stride] },
    dims: outputDims, spacing: outputSpacing, expectedBytes, voxels, outputBytes: voxels * bytesPerVoxel, bytesPerVoxel };
}

/** Read a File/Blob-like source with bounded slices; never materialize the original file. */
export async function readRawRegion(source, options, { signal, onProgress } = {}) {
  const plan = planRawRegion(options);
  if (source?.size !== plan.expectedBytes || typeof source.slice !== 'function') throw invalid('RAW byte count does not match source dimensions, bit depth and header offset.');
  const { dims: [w, h, d], source: input, bytesPerVoxel: bpp } = plan;
  const data = input.bits === 8 ? new Uint8Array(plan.voxels) : new Uint16Array(plan.voxels);
  const rowSpan = ((w - 1) * input.stride[0] + 1) * bpp;
  const rowStep = input.dims[0] * input.stride[1] * bpp;
  // Batch nearby rows; avoid reading large Y gaps merely to save a slice call.
  const batchRows = input.stride[1] <= 4 ? Math.max(1, Math.floor((RAW_READ_CHUNK_BYTES - rowSpan) / rowStep) + 1) : 1;
  let completed = 0, bytesRead = 0;
  const checkAbort = () => { if (signal?.aborted) throw Object.assign(new Error('RAW import cancelled.'), { name: 'AbortError' }); };
  onProgress?.({ completed, total: plan.voxels, bytesRead });
  for (let z = 0; z < d; z++) for (let y = 0; y < h;) {
    checkAbort();
    const rows = Math.min(batchRows, h - y);
    const start = input.offset + bpp * (input.origin[0] + input.dims[0] * (input.origin[1] + y * input.stride[1] + input.dims[1] * (input.origin[2] + z * input.stride[2])));
    const length = (rows - 1) * rowStep + rowSpan;
    const buffer = await source.slice(start, start + length).arrayBuffer();
    checkAbort();
    if (buffer.byteLength !== length) throw invalid('RAW source returned an incomplete region.');
    const view = new DataView(buffer);
    for (let row = 0; row < rows; row++) for (let x = 0; x < w; x++) {
      const position = row * rowStep + x * input.stride[0] * bpp;
      data[x + w * (y + row + h * z)] = bpp === 1 ? view.getUint8(position) : view.getUint16(position, input.littleEndian);
    }
    completed += rows * w; bytesRead += length; y += rows;
    onProgress?.({ completed, total: plan.voxels, bytesRead });
  }
  return { data, dims: plan.dims, spacing: plan.spacing, rawSource: plan.source };
}
