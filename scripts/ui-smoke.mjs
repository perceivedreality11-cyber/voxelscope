/** Optional real-browser test: npm install --no-save playwright@1.62.1 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
const { chromium } = await import(process.env.VOXELSCOPE_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'voxelscope-browser-'));
const password = 'Browser-Test-Password-2026!';
const app = await createApp({ directory, bootstrap: { tenantName: '先进材料检测中心', email: 'admin@local', password } });
await new Promise(done => app.server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${app.server.address().port}`;
let browser;
let page;
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1540, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()); });
  await page.goto(base);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page.locator('#shell').waitFor({ state: 'visible' });
  await page.locator('#empty-create').click();
  await page.locator('[name=name]').fill('SiC/SiC · 复合材料孔隙检测');
  await page.locator('[name=description]').fill('可复现合成体数据 · 非真实工件 · 检测工作流验证');
  await page.locator('#modal-submit').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('#demo-button').click();
  await page.locator('#export-json').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('export-json').disabled, undefined, { timeout: 30_000 });
  assert.match(await page.locator('#source-badge').textContent(), /SYNTHETIC/);
  assert.ok(Number((await page.locator('#stat-count').textContent()).replace(/,/g, '')) > 0);
  await page.locator('#rotate-button').click();
  const output = resolve(process.env.SCREENSHOT_DIR || 'docs/screenshots'); await mkdir(output, { recursive: true });
  await page.locator('#toast').evaluate(el => { el.hidden = true; });
  await page.screenshot({ path: join(output, 'workbench.png') });
  // Export downloads are checked against parsed measurement values.
  const jsonDownload = page.waitForEvent('download'); await page.locator('#export-json').click();
  const reportDownload = await jsonDownload; assert.match(reportDownload.suggestedFilename(), /\.json$/);
  const report = JSON.parse(await readFile(await reportDownload.path(), 'utf8'));
  assert.equal(report.volume.source.kind, 'synthetic');
  assert.equal(report.summary.segmentedVoxels, report.volume.source.truthCount);
  assert.equal(report.summary.componentCount, report.components.length);
  assert.equal(report.summary.keptVoxels, report.components.reduce((sum, c) => sum + c.voxels, 0));
  const savedReport = await page.request.get(`${base}/api/jobs/${report.provenance.jobId}/report`);
  assert.equal(savedReport.status(), 200);
  assert.deepEqual(await savedReport.json(), report);
  const csvDownload = page.waitForEvent('download'); await page.locator('#export-csv').click();
  const componentsDownload = await csvDownload; assert.match(componentsDownload.suggestedFilename(), /components\.csv$/);
  const [header, ...rows] = (await readFile(await componentsDownload.path(), 'utf8')).trim().split(/\r?\n/);
  assert.equal(header, 'id,voxels,volume_um3,equivalent_diameter_um,voxel_face_area_um2,centroid_x_um,centroid_y_um,centroid_z_um,touches_roi');
  assert.deepEqual(rows.map(row => row.split(',').map(Number)), report.components.map(c => [c.id, c.voxels, c.volumeUm3, c.equivalentDiameterUm, c.faceAreaUm2, ...c.centroidUm, Number(c.touchesROI)]));
  const pngDownload = page.waitForEvent('download'); await page.locator('#snapshot').click();
  const snapshot = await readFile(await (await pngDownload).path());
  assert.deepEqual([...snapshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(snapshot.readUInt32BE(16) > 0 && snapshot.readUInt32BE(20) > 0);
  await page.locator('[data-view=jobs]').click();
  await page.locator('[data-review]').first().click();
  await page.locator('[name=comment]').fill('Synthetic phantom checked. ROI and threshold are consistent.');
  await page.locator('#modal-submit').click(); await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(output, 'jobs.png'), fullPage: true });
  await page.locator('[data-view=team]').click();
  for (const role of ['analyst', 'viewer']) {
    await page.locator('#new-user').click();
    await page.locator('[name=email]').fill(`${role}@example.local`); await page.locator('[name=password]').fill(password);
    await page.locator('[name=role]').selectOption(role);
    await page.locator('#modal-submit').click(); await page.locator('#modal').waitFor({ state: 'hidden' });
    await page.getByRole('cell', { name: `${role}@example.local` }).waitFor();
  }
  await page.locator('[data-view=audit]').click();
  await page.waitForFunction(() => document.getElementById('audit-verification').textContent.includes('已验证'));
  await page.screenshot({ path: join(output, 'audit.png'), fullPage: true });
  await page.locator('[data-view=workbench]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Mobile page should not overflow horizontally');
  await page.setViewportSize({ width: 1540, height: 1100 });
  // Natural-order PNG stack import through the real file picker.
  await page.locator('#import-button').click();
  const pixelPngs = await page.evaluate(() => {
    return [200, 220].map(gray => {
      const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.fillStyle = `rgb(${gray},${gray},${gray})`; x.fillRect(0, 0, 8, 8); x.fillStyle = '#111'; x.fillRect(3, 3, 2, 2); return c.toDataURL().split(',')[1];
    });
  });
  await page.locator('[name=name]').fill('Image stack browser fixture');
  await page.locator('[name=files]').setInputFiles([{ name: 'slice10.png', mimeType: 'image/png', buffer: Buffer.from(pixelPngs[1], 'base64') }, { name: 'slice2.png', mimeType: 'image/png', buffer: Buffer.from(pixelPngs[0], 'base64') }]);
  await page.locator('#modal-submit').click(); await page.locator('#modal').waitFor({ state: 'hidden' });
  const stackId = await page.locator('#dataset-select').inputValue();
  const stack = await (await page.request.get(`${base}/api/datasets/${stackId}/raw`)).body();
  assert.equal(stack[0], 200, 'slice2 must precede slice10');
  assert.equal(stack[64], 220, 'slice10 must be the second Z plane');
  await page.locator('#run-analysis').click();
  await page.waitForFunction(() => !document.getElementById('export-json').disabled);
  assert.equal((await page.locator('#stat-porosity').textContent()).replace(/\s/g, ''), '6.25%');
  // Native uint16 precision, big-endian input and a non-zero header offset.
  await page.locator('#import-button').click();
  const raw = Buffer.alloc(4 + 8 * 8 * 2 * 2);
  for (let i = 0; i < 128; i++) raw.writeUInt16BE(i < 8 ? 1000 : 1001, 4 + i * 2);
  await page.locator('[name=name]').fill('uint16 BE header fixture');
  await page.locator('[name=files]').setInputFiles({ name: 'fixture.raw', mimeType: 'application/octet-stream', buffer: raw });
  for (const [name, value] of [['w', '8'], ['h', '8'], ['d', '2'], ['offset', '4']]) await page.locator(`[name=${name}]`).fill(value);
  await page.locator('[name=bits]').selectOption('16'); await page.locator('[name=endian]').selectOption('big');
  await page.locator('#modal-submit').click(); await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('#run-analysis').click(); await page.waitForFunction(() => !document.getElementById('export-json').disabled);
  assert.equal((await page.locator('#stat-porosity').textContent()).replace(/\s/g, ''), '6.25%');
  assert.match(await page.locator('#dataset-meta').textContent(), /16-BIT/);
  // A separate browser session can read results while all write/admin controls stay hidden.
  const viewerPage = await browser.newPage();
  try {
    viewerPage.on('pageerror', e => errors.push(e.message));
    await viewerPage.goto(base);
    await viewerPage.locator('#login-email').fill('viewer@example.local');
    await viewerPage.locator('#login-password').fill(password);
    await viewerPage.getByRole('button', { name: '登录工作空间' }).click();
    await viewerPage.waitForFunction(() => !document.getElementById('export-json').disabled);
    assert.equal((await viewerPage.locator('#stat-porosity').textContent()).replace(/\s/g, ''), '6.25%');
    assert.equal(await viewerPage.locator('.writer-only:visible, .admin-only:visible').count(), 0);
    const viewerDownload = viewerPage.waitForEvent('download'); await viewerPage.locator('#export-json').click();
    const viewerReport = JSON.parse(await readFile(await (await viewerDownload).path(), 'utf8'));
    assert.equal(viewerReport.summary.porosity, 1 / 16);
    await viewerPage.locator('[data-view=jobs]').click();
    await viewerPage.locator('[data-review]').first().click();
    assert.equal(await viewerPage.locator('[name=comment]').count(), 0);
    await viewerPage.locator('#modal-submit').click();
    const viewerMe = await (await viewerPage.request.get(`${base}/api/me`)).json();
    const forbidden = await viewerPage.request.post(`${base}/api/projects`, { data: { name: 'Forbidden viewer write' }, headers: { 'X-CSRF-Token': viewerMe.csrf } });
    assert.equal(forbidden.status(), 403);
  } finally { await viewerPage.close(); }
  await page.locator('#logout').click(); await page.locator('#login-screen').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(output, 'login.png'), fullPage: true });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log('Browser workflow passed: login → project → phantom → analysis → JSON/CSV contents + PNG export → review → team → audit → mobile → natural-order PNG import → uint16 BE RAW with header → read-only viewer → logout.');
} catch (error) {
  if (page) {
    console.error('Modal validation:', await page.locator('#modal-error').textContent().catch(() => 'unavailable'));
    await page.screenshot({ path: resolve('ui-failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close(); await app.close(); await rm(directory, { recursive: true, force: true });
}
