import { decodeRaw, validateDimensions, validateSpacing } from './core.js';
import { VolumeRenderer } from './renderer.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = (n, digits = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const time = date => new Date(date).toLocaleString('zh-CN', { hour12: false });
const percent = n => number(n * 100, 2);
const roleNames = { admin: '管理员', analyst: '分析员', viewer: '查看者' };
const states = { queued: '排队中', running: '计算中', succeeded: '已完成', failed: '失败', cancelled: '已取消' };
const state = { me: null, csrf: '', projects: [], projectId: '', datasets: [], datasetId: '', volume: null, report: null, labels: null, roi: null, jobId: '', desiredJob: '', epoch: 0, view: 'workbench', jobOffset: 0, auditOffset: 0, polling: false };
let renderer, toastTimer, modalBusy = false;

async function api(path, { method = 'GET', data, bytes, headers = {} } = {}) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: {
    ...(method !== 'GET' ? { 'X-CSRF-Token': state.csrf } : {}),
    ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
  }, body: bytes || (data !== undefined ? JSON.stringify(data) : undefined) });
  if (!response.ok) {
    const message = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (response.status === 401 && path !== '/api/login') signOutUI();
    throw new Error(message.error);
  }
  return response.headers.get('Content-Type')?.includes('application/json') ? response.json() : response.arrayBuffer();
}
function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error-toast', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 4000);
}
function action(fn) { return async event => { try { await fn(event); } catch (e) { toast(e.message, true); } }; }
function writer() { return state.me && state.me.role !== 'viewer'; }
function applyPermissions() {
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = state.me?.role !== 'admin'; });
  document.querySelectorAll('.writer-only').forEach(el => { el.hidden = !writer(); });
}
function signOutUI() {
  state.epoch++; state.me = null; state.csrf = ''; state.volume = null; state.report = null; state.desiredJob = '';
  state.projectId = ''; state.datasetId = ''; state.jobOffset = 0;
  if (renderer) { renderer.visible = false; renderer.clear(); }
  $('modal').close(); $('shell').hidden = true; $('login-screen').hidden = false; $('login-password').value = '';
}
async function enter() {
  state.me = await api('/api/me'); state.csrf = state.me.csrf;
  $('tenant-name').textContent = state.me.tenant; $('user-email').textContent = state.me.email; $('user-role').textContent = roleNames[state.me.role];
  document.querySelector('.avatar').textContent = state.me.email[0].toUpperCase();
  $('login-screen').hidden = true; $('shell').hidden = false; applyPermissions();
  if (!renderer) {
    renderer = new VolumeRenderer($('volume-canvas'));
    $('render-mode').textContent = renderer.gl ? 'WebGL · GPU' : 'Canvas2D · 兼容模式';
    $('rotate-button').classList.toggle('active', renderer.auto); $('rotate-button').setAttribute('aria-pressed', String(renderer.auto));
  }
  showView('workbench'); await refreshProjects();
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; $('login-error').textContent = '';
  try { const result = await api('/api/login', { method: 'POST', data: { email: $('login-email').value, password: $('login-password').value } }); state.csrf = result.csrf; await enter(); }
  catch (e) { $('login-error').textContent = e.message; } finally { button.disabled = false; }
});
$('logout').addEventListener('click', action(async () => { await api('/api/logout', { method: 'POST', data: {} }); signOutUI(); }));

function showView(view) {
  if (['team', 'audit'].includes(view) && state.me?.role !== 'admin') return;
  state.view = view;
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  if (renderer) { renderer.visible = view === 'workbench'; renderer.resize(); }
  if (view === 'jobs') void refreshJobs().catch(e => toast(e.message, true));
  if (view === 'team') void refreshTeam().catch(e => toast(e.message, true));
  if (view === 'audit') void refreshAudit().catch(e => toast(e.message, true));
  if (view === 'workbench') requestAnimationFrame(drawCharts);
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));

function modal(title, fields, submit, buttonLabel = '确认') {
  $('modal-title').textContent = title; $('modal-fields').innerHTML = fields; $('modal-error').textContent = ''; $('modal-submit').textContent = buttonLabel;
  $('modal-form').onsubmit = async e => {
    e.preventDefault(); if (modalBusy) return;
    modalBusy = true; $('modal-submit').disabled = true; $('modal-cancel').disabled = true; $('modal-close').disabled = true;
    $('modal-error').textContent = '';
    try { await submit(new FormData($('modal-form'))); $('modal').close(); }
    catch (e) { $('modal-error').textContent = e.message; }
    finally { modalBusy = false; $('modal-submit').disabled = false; $('modal-cancel').disabled = false; $('modal-close').disabled = false; }
  };
  $('modal').showModal();
}
$('modal-close').onclick = $('modal-cancel').onclick = () => { if (!modalBusy) $('modal').close(); };
$('modal').addEventListener('cancel', e => { if (modalBusy) e.preventDefault(); });
function createProject() {
  modal('创建检测项目', '<p class="modal-note">按工件批次、检测任务或客户组织项目。企业内成员共享项目与结果。</p><label>项目名称<input name="name" placeholder="例如 SiC/SiC 复合材料 · 批次 01" maxlength="120" required></label><label>说明<textarea name="description" maxlength="1000" placeholder="材料、扫描设备、检测目的…"></textarea></label>', async form => {
    const result = await api('/api/projects', { method: 'POST', data: Object.fromEntries(form) });
    state.projectId = result.id; await refreshProjects(); toast('项目已创建');
  }, '创建项目');
}
$('new-project').onclick = $('empty-create').onclick = createProject;
async function refreshProjects() {
  state.projects = await api('/api/projects');
  if (!state.projects.find(p => p.id === state.projectId)) state.projectId = state.projects[0]?.id || '';
  renderProjects(); await selectProject(state.projectId);
}
function renderProjects() {
  $('project-list').innerHTML = state.projects.map(p => `<button class="project-item ${p.id === state.projectId ? 'active' : ''}" data-project="${esc(p.id)}" title="${esc(p.description || p.name)}"><span>${esc(p.name)}</span></button>`).join('') || '<p class="tiny muted">尚无项目</p>';
  $('project-list').querySelectorAll('button').forEach(el => el.onclick = action(() => selectProject(el.dataset.project)));
}
async function selectProject(id) {
  state.epoch++; const epoch = state.epoch; state.projectId = id; state.jobOffset = 0; state.desiredJob = ''; state.jobId = '';
  state.datasetId = ''; state.volume = null; clearResult();
  renderProjects(); $('breadcrumb-project').textContent = state.projects.find(p => p.id === id)?.name || '分析工作台';
  $('empty-state').hidden = Boolean(id); $('workbench-content').hidden = !id;
  $('demo-button').disabled = $('import-button').disabled = !id;
  if (!id) { $('job-rows').innerHTML = '<tr class="no-data-row"><td colspan="6">请先创建或选择项目</td></tr>'; return; }
  const datasets = await api(`/api/datasets?project=${id}`);
  if (epoch !== state.epoch) return;
  state.datasets = datasets; renderDatasets();
  if (datasets.length) await selectDataset(datasets[0].id);
  await refreshJobs();
}
function renderDatasets() {
  $('dataset-select').innerHTML = state.datasets.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('') || '<option value="">尚无数据集 · 导入或加载演示</option>';
  $('dataset-select').value = state.datasetId;
}
async function refreshDatasets(selected) {
  const projectId = state.projectId;
  const datasets = await api(`/api/datasets?project=${projectId}`);
  if (projectId !== state.projectId) return;
  state.datasets = datasets; renderDatasets(); await selectDataset(selected || datasets[0]?.id);
}
function clearResult() {
  state.report = null; state.labels = null; state.roi = null; state.jobId = '';
  if (renderer) renderer.clear();
  for (const id of ['stat-porosity', 'stat-count', 'stat-diameter', 'stat-boundary']) $(id).textContent = '—';
  $('stat-raw').textContent = '等待分析任务'; $('stat-filter').textContent = '按最小体素数筛选'; $('point-count').textContent = '0 points';
  $('result-provenance').textContent = '尚无结果'; $('effective-threshold').textContent = '—';
  $('export-json').disabled = $('export-csv').disabled = true;
  $('component-rows').innerHTML = '<tr><td colspan="6" class="muted">运行分析后显示测量结果</td></tr>';
  drawSlices(); drawCharts();
  $('run-analysis').disabled = !state.volume;
}
async function selectDataset(id, autoResult = true) {
  state.epoch++; const epoch = state.epoch; state.datasetId = id || ''; state.desiredJob = ''; state.volume = null; clearResult();
  $('dataset-select').value = id || '';
  const dataset = state.datasets.find(d => d.id === id);
  if (!dataset) { $('dataset-meta').textContent = '尚未导入体数据'; return; }
  $('dataset-meta').textContent = '正在载入体数据…';
  const bytes = await api(`/api/datasets/${id}/raw`);
  if (epoch !== state.epoch) return;
  const meta = dataset.meta;
  state.volume = { ...meta, data: decodeRaw(bytes, meta.dims, { bits: meta.bits }) };
  $('dataset-meta').textContent = `${meta.dims.join(' × ')} VOXELS  /  ${meta.bits}-BIT  /  ${meta.spacing.join(' × ')} µm  /  SHA256 ${dataset.sha256.slice(0, 12)}…`;
  $('source-badge').textContent = meta.source.kind === 'synthetic' ? 'SYNTHETIC · SEED 42' : 'IMPORTED DATA';
  $('threshold').max = meta.bits === 16 ? 65535 : 255;
  for (const [axis, index] of [['x', 0], ['y', 1], ['z', 2]]) { $(`slice-${axis}-range`).max = meta.dims[index] - 1; $(`slice-${axis}-range`).value = Math.floor(meta.dims[index] / 2); }
  $('run-analysis').disabled = !writer(); $('analysis-status').textContent = '数据集已载入 · 可提交分析任务'; drawSlices();
  if (autoResult) {
    const jobs = await api(`/api/jobs?project=${state.projectId}&limit=100`);
    if (epoch !== state.epoch) return;
    const latest = jobs.find(j => j.dataset_id === id && j.state === 'succeeded');
    if (latest) await openResult(latest.id);
  }
}
$('dataset-select').addEventListener('change', action(e => selectDataset(e.target.value)));
$('demo-button').addEventListener('click', action(async e => {
  const projectId = state.projectId; e.currentTarget.disabled = true;
  try { const result = await api('/api/demo', { method: 'POST', data: { projectId } }); if (projectId !== state.projectId) return; await refreshDatasets(result.id); toast('已载入合成体数据，正在提交验证分析'); await submitAnalysis(); }
  finally { $('demo-button').disabled = !state.projectId; }
}));

$('import-button').onclick = () => {
  const projectId = state.projectId;
  modal('导入 CT 体数据', `<p class="modal-note">支持 RAW（uint8 / uint16）或 PNG / JPEG / BMP 切片序列。切片按文件名自然排序，同尺寸、至少 2 张；图片统一转为 8 位灰度。每个体数据上限 4,194,304 体素。TIFF / DICOM 请先在重建软件转换。</p>
    <label>数据集名称<input name="name" maxlength="120" placeholder="工件编号 · 扫描批次" required></label><label>文件<input name="files" type="file" accept=".raw,.bin,.png,.jpg,.jpeg,.bmp" multiple required></label>
    <p class="tiny muted">体素间距来自重建参数；单位 µm，XYZ 分别填写。</p><div class="modal-fields-grid"><label>X 间距<input name="sx" type="number" value="8" min="0.001" max="1000000" step="any" required></label><label>Y 间距<input name="sy" type="number" value="8" min="0.001" max="1000000" step="any" required></label><label>Z 间距<input name="sz" type="number" value="12" min="0.001" max="1000000" step="any" required></label></div>
    <details class="import-options" open><summary>RAW 参数（图片序列不使用）</summary><div class="modal-fields-grid"><label>宽度 X<input name="w" type="number" value="96" min="2" max="2048"></label><label>高度 Y<input name="h" type="number" value="96" min="2" max="2048"></label><label>层数 Z<input name="d" type="number" value="96" min="2" max="2048"></label></div><div class="form-row"><label>位深<select name="bits"><option value="8">uint8</option><option value="16">uint16</option></select></label><label>字节序<select name="endian"><option value="little">Little endian</option><option value="big">Big endian</option></select></label></div><label>文件头偏移 / bytes<input name="offset" type="number" min="0" value="0"></label></details><p id="import-progress" class="progress-note"></p>`, async form => {
    const spacing = ['sx', 'sy', 'sz'].map(k => Number(form.get(k))); validateSpacing(spacing);
    const files = form.getAll('files').filter(f => f.size);
    if (!files.length) throw new Error('请选择文件');
    let data, dims, bits, format;
    if (files.length === 1 && /\.(raw|bin)$/i.test(files[0].name)) {
      dims = ['w', 'h', 'd'].map(k => Number(form.get(k))); validateDimensions(dims); bits = Number(form.get('bits')); format = 'RAW';
      const offset = Number(form.get('offset'));
      if (!Number.isSafeInteger(offset) || offset < 0 || files[0].size !== dims[0] * dims[1] * dims[2] * bits / 8 + offset) throw new Error('RAW 文件大小与尺寸、位深或文件头偏移不一致');
      data = decodeRaw(await files[0].slice(offset).arrayBuffer(), dims, { bits, littleEndian: form.get('endian') === 'little' });
    } else {
      if (files.length < 2 || files.some(f => !/\.(png|jpe?g|bmp)$/i.test(f.name))) throw new Error('请选择单个 RAW 文件，或至少两张 PNG/JPEG/BMP 切片');
      const collator = new Intl.Collator('en', { numeric: true }); files.sort((a, b) => collator.compare(a.name, b.name));
      if (new Set(files.map(f => f.name.toLowerCase())).size !== files.length) throw new Error('切片文件名重复，请重新命名后导入');
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      for (let z = 0; z < files.length; z++) {
        $('import-progress').textContent = `转换切片 ${z + 1} / ${files.length} · ${files[z].name}`;
        const image = await createImageBitmap(files[z], { colorSpaceConversion: 'none' });
        try {
          if (!z) { dims = [image.width, image.height, files.length]; validateDimensions(dims); data = new Uint8Array(dims[0] * dims[1] * dims[2]); canvas.width = dims[0]; canvas.height = dims[1]; }
          if (image.width !== dims[0] || image.height !== dims[1]) throw new Error('切片尺寸不一致');
          ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
          const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 0; i < dims[0] * dims[1]; i++) { if (rgba[i * 4 + 3] !== 255) throw new Error('不支持带透明像素的切片'); data[z * dims[0] * dims[1] + i] = Math.round(0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]); }
        } finally { image.close(); }
      }
      bits = 8; format = `Image stack; ${files.length} slices; natural order`;
    }
    const bytes = new Uint8Array(data.length * bits / 8), view = new DataView(bytes.buffer);
    for (let i = 0; i < data.length; i++) if (bits === 8) bytes[i] = data[i]; else view.setUint16(i * 2, data[i], true);
    const meta = { projectId, name: form.get('name'), dims, spacing, bits, format };
    $('import-progress').textContent = '正在写入服务器…';
    const result = await api('/api/datasets', { method: 'POST', bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-Volume-Meta': encodeURIComponent(JSON.stringify(meta)) } });
    if (projectId === state.projectId) await refreshDatasets(result.id); toast('体数据已保存，SHA-256 指纹已记录');
  }, '导入数据');
};

function currentSettings() {
  return { method: $('method').value, threshold: Number($('threshold').value), dark: $('polarity').value === 'dark', connectivity: Number($('connectivity').value), minSize: Number($('min-size').value), shape: $('roi-shape').value, inset: Number($('roi-inset').value) / 100 };
}
async function submitAnalysis() {
  if (!state.datasetId || !state.volume) throw new Error('请先载入体数据');
  const datasetId = state.datasetId;
  $('run-analysis').disabled = true;
  try {
    const result = await api('/api/jobs', { method: 'POST', data: { datasetId, settings: currentSettings() } });
    if (datasetId === state.datasetId) { state.desiredJob = result.id; $('analysis-status').textContent = `任务 ${result.id.slice(0, 8)} 已入队 · 可继续操作`; }
    await refreshJobs();
  } finally { $('run-analysis').disabled = !writer() || !state.volume; }
}
$('analysis-form').addEventListener('submit', action(async e => { e.preventDefault(); await submitAnalysis(); }));
$('threshold').addEventListener('input', () => { $('threshold-value').textContent = $('threshold').value; $('method').value = 'manual'; });
$('analysis-form').addEventListener('change', () => { if (state.report) $('analysis-status').textContent = '参数已更改 · 当前图表仍为上次已完成结果'; });

function u32LE(bytes) { const view = new DataView(bytes), array = new Uint32Array(bytes.byteLength / 4); for (let i = 0; i < array.length; i++) array[i] = view.getUint32(i * 4, true); return array; }
function f32LE(bytes) { const view = new DataView(bytes), array = new Float32Array(bytes.byteLength / 4); for (let i = 0; i < array.length; i++) array[i] = view.getFloat32(i * 4, true); return array; }
async function openResult(jobId) {
  const epoch = state.epoch, datasetId = state.datasetId; state.desiredJob = jobId;
  const [report, labels, roi, vertices] = await Promise.all(['report', 'labels', 'roi', 'vertices'].map(k => api(`/api/jobs/${jobId}/${k}`)));
  if (epoch !== state.epoch || state.desiredJob !== jobId || report.provenance.datasetId !== datasetId) return;
  state.report = report; state.labels = u32LE(labels); state.roi = new Uint8Array(roi); state.jobId = jobId; state.desiredJob = '';
  renderer.update(f32LE(vertices), report.cloud.extent);
  const { summary: s, components, settings } = report;
  $('stat-porosity').innerHTML = `${percent(s.porosity)}<em>%</em>`; $('stat-count').textContent = number(s.componentCount);
  $('stat-diameter').innerHTML = `${number(components[0]?.equivalentDiameterUm || 0, 1)}<em>µm</em>`;
  $('stat-boundary').innerHTML = `${percent(s.boundaryPoreFraction)}<em>%</em>`;
  $('stat-raw').textContent = `未筛选 ${percent(s.rawPorosity)}% · ROI ${number(s.roiVoxels)} vox`;
  $('stat-filter').textContent = `移除 ${number(s.filteredVoxels)} 体素 / ${number(s.filteredComponents)} 个小连通域`;
  $('point-count').textContent = `${number(report.cloud.renderedPoints)} / ${number(report.cloud.surfaceVoxels)} surface voxels`;
  $('effective-threshold').textContent = `T = ${number(settings.effectiveThreshold, 1)}`;
  $('method').value = settings.method; $('threshold').value = settings.threshold; $('threshold-value').textContent = settings.threshold;
  $('polarity').value = settings.dark ? 'dark' : 'bright'; $('connectivity').value = settings.connectivity; $('min-size').value = settings.minSize; $('roi-shape').value = settings.shape; $('roi-inset').value = Math.round(settings.inset * 100);
  $('result-provenance').textContent = `JOB ${jobId.slice(0, 8)} · ENGINE ${report.provenance.engine} · ${number(report.provenance.elapsedMs, 0)} ms`;
  $('analysis-status').textContent = `已完成 · ${time(report.provenance.createdAt)} · 参数及结果已留存`;
  $('component-rows').innerHTML = components.slice(0, 100).map(c => `<tr><td><span class="teal">#${c.id}</span></td><td>${number(c.voxels)}</td><td>${number(c.volumeUm3)}</td><td>${number(c.equivalentDiameterUm, 2)}</td><td>${c.centroidUm.map(v => number(v, 1)).join(' / ')}</td><td><span class="status ${c.touchesROI ? 'running' : 'succeeded'}">${c.touchesROI ? '接触 / 截断' : '未接触'}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">当前参数下无保留孔隙</td></tr>';
  $('export-json').disabled = $('export-csv').disabled = false;
  drawSlices(); drawCharts();
  await refreshJobs();
}

function drawSlices() {
  for (const [axis, fixed, a, b] of [['z', 2, 0, 1], ['y', 1, 0, 2], ['x', 0, 1, 2]]) {
    const canvas = $(`slice-${axis}`), ctx = canvas.getContext('2d');
    if (!state.volume) { canvas.width = 128; canvas.height = 96; ctx.clearRect(0, 0, 128, 96); $(`slice-${axis}-value`).textContent = '—'; continue; }
    const { dims, data, spacing } = state.volume, index = Number($(`slice-${axis}-range`).value);
    const w = dims[a], h = dims[b], image = new ImageData(w, h);
    const hist = state.report?.histogram; let min = hist?.min ?? 0, max = hist?.max ?? (state.volume.bits === 8 ? 255 : 65535);
    if (max === min) max = min + 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xyz = []; xyz[fixed] = index; xyz[a] = x; xyz[b] = h - 1 - y;
      const i = xyz[0] + dims[0] * (xyz[1] + dims[1] * xyz[2]), p = (x + w * y) * 4;
      let gray = Math.max(0, Math.min(255, Math.round((data[i] - min) / (max - min) * 255)));
      if (state.roi && !state.roi[i]) gray = Math.round(gray * 0.22);
      if (state.labels?.[i]) { image.data[p] = 93; image.data[p + 1] = 224; image.data[p + 2] = 194; }
      else image.data[p] = image.data[p + 1] = image.data[p + 2] = gray;
      image.data[p + 3] = 255;
    }
    // Resample onto a physical-aspect canvas; metrics use the original voxel grid.
    const temp = document.createElement('canvas'); temp.width = w; temp.height = h; temp.getContext('2d').putImageData(image, 0, 0);
    const physicalW = w * spacing[a], physicalH = h * spacing[b], scale = 400 / Math.max(physicalW, physicalH);
    canvas.width = Math.max(1, Math.round(physicalW * scale)); canvas.height = Math.max(1, Math.round(physicalH * scale));
    ctx.imageSmoothingEnabled = false; ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);
    $(`slice-${axis}-value`).textContent = `${axis.toUpperCase()} ${index + 1}/${dims[fixed]} · ${number((index + 0.5) * spacing[fixed], 0)} µm`;
  }
}
for (const axis of ['x', 'y', 'z']) $(`slice-${axis}-range`).addEventListener('input', drawSlices);

function chart(id, values, { bars = false, color = '#66e4c5', leftLabel = '', rightLabel = '' } = {}) {
  const canvas = $(id), rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = Math.min(devicePixelRatio || 1, 2); canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const w = rect.width, h = rect.height, pad = { l: 38, r: 15, t: 18, b: 28 }, cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  ctx.clearRect(0, 0, w, h); const maximum = Math.max(...values, 0.01) * 1.12;
  ctx.font = '8px Consolas, monospace'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) { const y = pad.t + ch * i / 3; ctx.strokeStyle = '#26354b'; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillStyle = '#647b98'; ctx.fillText(number(maximum * (1 - i / 3), maximum > 100 ? 0 : 1), 5, y); }
  ctx.fillStyle = '#647b98'; ctx.fillText(leftLabel, pad.l, h - 11); ctx.textAlign = 'right'; ctx.fillText(rightLabel, w - pad.r, h - 11); ctx.textAlign = 'left';
  if (!values.length) return;
  const points = values.map((v, i) => [pad.l + (values.length === 1 ? 0 : i / (values.length - 1) * cw), pad.t + ch * (1 - v / maximum)]);
  if (bars) { ctx.fillStyle = color; points.forEach(([x, y]) => ctx.fillRect(x, y, Math.max(1, cw / values.length), pad.t + ch - y)); }
  else {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.lineTo(points.at(-1)[0], pad.t + ch); ctx.lineTo(pad.l, pad.t + ch); ctx.closePath();
    const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch); gradient.addColorStop(0, `${color}35`); gradient.addColorStop(1, `${color}00`); ctx.fillStyle = gradient; ctx.fill();
    if (values.length < 10) for (const [x, y] of points) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
  }
}
function drawCharts() {
  const r = state.report;
  chart('profile-chart', r ? r.profile.map(p => (p.porosity || 0) * 100) : [], { leftLabel: 'Z 0', rightLabel: r ? `${number(r.volume.dims[2] * r.volume.spacing[2])} µm` : '' });
  chart('histogram-chart', r?.histogram.counts || [], { bars: true, color: '#a796f3', leftLabel: r ? number(r.histogram.min) : '', rightLabel: r ? number(r.histogram.max) : '' });
  chart('sensitivity-chart', r?.sensitivity.map(s => s.rawPorosity * 100) || [], { color: '#e9b88e', leftLabel: r ? `T ${number(r.sensitivity[0].threshold, 1)}` : '', rightLabel: r ? `T ${number(r.sensitivity.at(-1).threshold, 1)}` : '' });
}
new ResizeObserver(() => { if (state.view === 'workbench') drawCharts(); }).observe($('workbench-content'));
$('rotate-button').onclick = () => { renderer.auto = !renderer.auto; $('rotate-button').classList.toggle('active', renderer.auto); $('rotate-button').setAttribute('aria-pressed', String(renderer.auto)); };
$('reset-view').onclick = () => renderer.reset();
function download(name, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
$('snapshot').onclick = () => {
  renderer.draw(); const source = $('volume-canvas'), canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0c1421'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0);
  ctx.fillStyle = '#8191a9'; ctx.font = '12px Consolas'; ctx.fillText(`VoxelScope | ${state.jobId || 'No result'} | visualization only`, 18, canvas.height - 16);
  canvas.toBlob(blob => { if (blob) download(`voxelscope-${state.jobId.slice(0, 8) || 'view'}.png`, blob); });
};
$('export-json').onclick = () => { if (state.report) download(`voxelscope-${state.jobId}.json`, JSON.stringify(state.report, null, 2), 'application/json'); };
$('export-csv').onclick = () => {
  if (!state.report) return;
  const columns = ['id', 'voxels', 'volume_um3', 'equivalent_diameter_um', 'voxel_face_area_um2', 'centroid_x_um', 'centroid_y_um', 'centroid_z_um', 'touches_roi'];
  const rows = state.report.components.map(c => [c.id, c.voxels, c.volumeUm3, c.equivalentDiameterUm, c.faceAreaUm2, ...c.centroidUm, Number(c.touchesROI)].join(','));
  download(`voxelscope-${state.jobId}-components.csv`, [columns.join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
};

async function refreshJobs() {
  if (!state.projectId || !state.me) return;
  const projectId = state.projectId, offset = state.jobOffset;
  const jobs = await api(`/api/jobs?project=${projectId}&limit=25&offset=${offset}`);
  if (projectId !== state.projectId || offset !== state.jobOffset) return;
  $('job-badge').textContent = String(jobs.filter(j => ['queued', 'running'].includes(j.state)).length);
  $('job-rows').innerHTML = jobs.map(j => `<tr><td>${esc(j.dataset_name)}<small>${esc(j.id)}</small>${j.error ? `<small class="error">${esc(j.error)}</small>` : ''}</td><td><span class="status ${esc(j.state)}">${states[j.state]}</span></td><td>${esc(j.settings.method.toUpperCase())} · ${j.settings.connectivity}N</td><td>${j.elapsed_ms ? `${number(j.elapsed_ms)} ms` : '—'}</td><td>${esc(time(j.created_at))}</td><td>${j.state === 'succeeded' ? `<button class="mini" data-open="${j.id}" data-dataset="${j.dataset_id}">打开结果</button><button class="mini" data-review="${j.id}">复核记录</button>` : ['running', 'queued'].includes(j.state) && writer() ? `<button class="mini" data-cancel="${j.id}">取消</button>` : '—'}</td></tr>`).join('') || '<tr class="no-data-row"><td colspan="6">当前页暂无分析任务</td></tr>';
  $('jobs-page').textContent = `第 ${Math.floor(offset / 25) + 1} 页`; $('jobs-prev').disabled = !offset; $('jobs-next').disabled = jobs.length < 25;
  $('job-rows').querySelectorAll('[data-open]').forEach(el => el.onclick = action(async () => { showView('workbench'); if (el.dataset.dataset !== state.datasetId) await selectDataset(el.dataset.dataset, false); await openResult(el.dataset.open); }));
  $('job-rows').querySelectorAll('[data-review]').forEach(el => el.onclick = action(() => reviewModal(el.dataset.review)));
  $('job-rows').querySelectorAll('[data-cancel]').forEach(el => el.onclick = action(async () => { await api(`/api/jobs/${el.dataset.cancel}/cancel`, { method: 'POST', data: {} }); await refreshJobs(); toast('任务已取消'); }));
}
async function poll() {
  if (!state.me || state.polling || document.hidden) return;
  state.polling = true;
  try {
    if (state.desiredJob && state.desiredJob !== state.jobId) {
      const desired = state.desiredJob, epoch = state.epoch;
      const job = await api(`/api/jobs/${desired}`);
      if (epoch === state.epoch && desired === state.desiredJob) {
        if (job.state === 'succeeded') { await openResult(job.id); toast('分析已完成，结果已保存'); }
        else if (['failed', 'cancelled'].includes(job.state)) { state.desiredJob = ''; $('analysis-status').textContent = `任务${states[job.state]}：${job.error || ''}`; toast($('analysis-status').textContent, true); }
        else $('analysis-status').textContent = job.state === 'running' ? '独立线程正在分析 · 可切换页面' : '任务排队中';
      }
    }
    if (state.view === 'jobs') await refreshJobs();
  } catch (e) { if (state.me) toast(e.message, true); } finally { state.polling = false; }
}
setInterval(poll, 1800);
$('refresh-jobs').onclick = action(refreshJobs);
$('jobs-prev').onclick = action(async () => { state.jobOffset = Math.max(0, state.jobOffset - 25); await refreshJobs(); });
$('jobs-next').onclick = action(async () => { state.jobOffset += 25; await refreshJobs(); });

async function reviewModal(jobId) {
  const reviews = await api(`/api/jobs/${jobId}/reviews`);
  modal(`结果复核 · ${jobId.slice(0, 8)}`, `<div class="review-list">${reviews.map(r => `<div class="review-entry"><span class="status ${r.decision}">${r.decision === 'accepted' ? '接受' : '退回'}</span> ${esc(r.reviewer)} · ${esc(time(r.created_at))}<p>${esc(r.comment)}</p></div>`).join('') || '尚无复核意见。'}</div>${writer() ? '<label>复核结论<select name="decision"><option value="accepted">接受此结果</option><option value="rejected">退回重新分析</option></select></label><label>复核意见<textarea name="comment" required maxlength="1000" placeholder="记录 ROI、分割质量与测量结论检查情况"></textarea></label><p class="tiny muted">复核意见追加保存，不能覆盖或删除。此处为工作流记录，不构成法规电子签名。</p>' : '<p class="muted">查看者可以查阅复核记录。</p>'}`, async form => {
    if (writer()) await api(`/api/jobs/${jobId}/reviews`, { method: 'POST', data: Object.fromEntries(form) });
    toast(writer() ? '复核意见已保存' : '已关闭');
  }, writer() ? '保存复核意见' : '关闭');
}
async function refreshTeam() {
  const users = await api('/api/users');
  $('user-rows').innerHTML = users.map(u => `<tr><td>${esc(u.email)}</td><td>${roleNames[u.role]}</td><td><span class="status ${u.active ? 'succeeded' : 'cancelled'}">${u.active ? '已启用' : '已停用'}</span></td><td>${esc(time(u.created_at))}</td><td>${u.active && u.id !== state.me.id ? `<button class="mini" data-disable="${u.id}" data-email="${esc(u.email)}">停用账号</button>` : '—'}</td></tr>`).join('');
  $('user-rows').querySelectorAll('[data-disable]').forEach(el => el.onclick = () => modal('停用团队成员', `<p class="modal-note">停用 ${esc(el.dataset.email)} 后，该成员的会话会立即撤销，已有检测记录继续保留。</p>`, async () => { await api(`/api/users/${el.dataset.disable}/disable`, { method: 'POST', data: {} }); await refreshTeam(); }, '停用账号'));
}
$('new-user').onclick = () => modal('添加团队成员', '<label>成员邮箱<input name="email" type="email" autocomplete="off" required maxlength="120"></label><label>初始密码<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>角色<select name="role"><option value="analyst">分析员 · 导入 / 分析 / 复核</option><option value="viewer">查看者 · 只读访问</option><option value="admin">管理员 · 完整企业管理权限</option></select></label>', async form => { await api('/api/users', { method: 'POST', data: Object.fromEntries(form) }); await refreshTeam(); toast('成员已创建，请通过你们的内部渠道提供初始凭据'); }, '创建成员');
async function refreshAudit() {
  const result = await api(`/api/audit?offset=${state.auditOffset}`);
  $('audit-verification').classList.toggle('invalid', !result.verification.valid);
  $('audit-verification').textContent = result.verification.valid ? `✓ 已验证 ${result.verification.count} 条记录 · 记录链连续。此检查不能防止持有数据库写权限的人重算整条链。` : `记录链校验失败 · 序号 ${result.verification.failedAt}`;
  $('audit-rows').innerHTML = result.events.map(e => `<tr><td>${e.seq}</td><td>${esc(time(e.timestamp))}</td><td>${esc(e.actor_email || e.actor)}</td><td>${esc(e.action)}</td><td title="${esc(e.details)}">${esc(e.target.slice(0, 12))}…</td><td title="${esc(e.hash)}"><code>${esc(e.hash.slice(0, 18))}…</code></td></tr>`).join('');
  $('audit-prev').disabled = !state.auditOffset; $('audit-next').disabled = result.events.length < 100;
}
$('refresh-audit').onclick = action(refreshAudit);
$('audit-prev').onclick = action(async () => { state.auditOffset = Math.max(0, state.auditOffset - 100); await refreshAudit(); });
$('audit-next').onclick = action(async () => { state.auditOffset += 100; await refreshAudit(); });
$('account-button').onclick = () => modal('账户安全', '<p class="modal-note">修改密码会撤销该账号的所有会话，请重新登录。</p><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>新密码<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>', async form => { await api('/api/password', { method: 'POST', data: Object.fromEntries(form) }); signOutUI(); toast('密码已更改，请重新登录'); }, '更新密码');

enter().catch(e => { if (state.me) toast(e.message, true); });
