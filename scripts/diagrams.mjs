/** Reproducible documentation diagrams. No external libraries or image assets. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../docs/diagrams/', import.meta.url);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const text = (x, y, value, cls = 'body') => `<text x="${x}" y="${y}" class="${cls}">${escape(value)}</text>`;
const path = (d, label = '', x = 0, y = 0) => `<path d="${d}" class="edge" marker-end="url(#arrow)"/>${label ? text(x, y, label, 'edge-label') : ''}`;
function card(x, y, w, h, eyebrow, title, lines, accent = 'teal') {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" class="card"/>
    <rect x="${x}" y="${y + 18}" width="3" height="28" rx="1.5" fill="var(--${accent})"/>
    ${text(x + 22, y + 30, eyebrow, accent)}${text(x + 22, y + 63, title, 'card-title')}
    ${lines.map((line, i) => text(x + 22, y + 94 + i * 25, line)).join('')}</g>`;
}
function svg(title, subtitle, height, content, footer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escape(title)}</title><desc id="description">${escape(subtitle)}</desc>
  <defs><linearGradient id="background" x2="1" y2="1"><stop stop-color="#101c2e"/><stop offset="1" stop-color="#080e19"/></linearGradient>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#738fac"/></marker></defs>
  <style>
    svg { --teal:#64dfc3; --purple:#b4a2ff; font-family:'Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif; }
    .title { fill:#eff5ff; font-size:42px; font-weight:700; } .subtitle { fill:#a1b5cd; font-size:19px; }
    .lane { fill:#101a2a; stroke:#25364e; } .lane-title { fill:#a3b7d1; font-size:15px; letter-spacing:1px; }
    .card { fill:#152338; stroke:#30435e; } .card-title { fill:#edf4ff; font-size:23px; font-weight:700; }
    .body { fill:#b4c6dd; font-size:17px; } .teal { fill:#64dfc3; font-size:13px; font-weight:700; letter-spacing:1px; }
    .purple { fill:#b4a2ff; font-size:13px; font-weight:700; letter-spacing:1px; }
    .edge { fill:none; stroke:#738fac; stroke-width:2; stroke-linejoin:round; } .edge-label { fill:#8da4be; font-size:12px; }
    .footer { fill:#91a7c1; font-size:16px; } .tag { fill:#64dfc3; font-size:14px; letter-spacing:1px; }
  </style>
  <rect width="1440" height="${height}" rx="24" fill="url(#background)"/>
  <rect x="60" y="54" width="5" height="82" rx="2" fill="#64dfc3"/>
  ${text(84, 91, title, 'title')}${text(84, 128, subtitle, 'subtitle')}
  ${content}
  <path d="M60 ${height - 84} H1380" stroke="#27384f"/>
  ${text(60, height - 47, footer, 'footer')}${text(1225, height - 47, 'VOXELSCOPE 1.0', 'tag')}
</svg>\n`;
}

const architecture = [
  ...[[60, '01 / 浏览器'], [528, '02 / 应用服务器'], [996, '03 / 持久化数据']].map(([x, label]) => `<rect x="${x}" y="186" width="384" height="700" rx="22" class="lane"/>${text(x + 20, 222, label, 'lane-title')}`),
  card(80, 252, 344, 174, 'WEB WORKBENCH', '三维分析工作台', ['WebGL 点云 / 正交切片', '项目导航 / RAW 与切片导入', '本地浏览器，无运行时 CDN']),
  card(80, 480, 344, 148, 'ROLE-BASED ACCESS', '团队与企业空间', ['管理员 / 分析员 / 查看者', '服务端校验企业与角色'], 'purple'),
  card(80, 690, 344, 166, 'REVIEW & DELIVERY', '复核与结果交付', ['追加复核 / 历史结果', 'JSON 报告 / CSV / PNG', '浏览器通过 API 读取结果']),
  card(548, 252, 344, 104, 'DEPLOYMENT', 'Caddy · HTTPS 代理', []),
  card(548, 412, 344, 142, 'NODE.JS 24', 'HTTP API 与授权', ['会话 / CSRF / RBAC', '企业隔离 / 请求与配额校验']),
  card(548, 610, 344, 104, 'PERSISTENT FIFO', 'SQLite 任务队列', []),
  card(548, 770, 344, 104, 'WORKER THREAD', '独立分析线程', []),
  card(1016, 412, 344, 142, 'SQLITE / WAL', '业务记录与审计', ['企业 / 用户 / 项目 / 任务', '复核记录 / 审计哈希链'], 'purple'),
  card(1016, 610, 344, 104, 'IMMUTABLE INPUT', '体数据 · SHA-256', []),
  card(1016, 770, 344, 104, 'VERSIONED OUTPUT', '报告 / 标签 / ROI / 点云', []),
  path('M424 304 H548', 'HTTPS', 458, 291),
  path('M720 356 V412'),
  path('M892 480 H1016', '事务 / 查询', 916, 466),
  path('M548 526 H488 V550 H424'),
  path('M720 554 V610', '提交任务', 735, 586),
  path('M720 714 V770', '取消 / 超时', 735, 746),
  path('M1016 662 H954 V800 H892', '校验输入', 906, 648),
  path('M892 838 H1016', '写入结果', 923, 824),
].join('');

const steps = [
  [60, 256, '01 / IMPORT', '导入体数据', ['uint8 / uint16 RAW', '或 PNG / JPEG / BMP 切片', '设置真实 XYZ 体素间距']],
  [400, 256, '02 / ROI', '定义测量区域', ['矩形体 / 椭圆柱 ROI', '设置边缘裁剪比例', '确保 ROI 位于材料内部']],
  [740, 256, '03 / SEGMENT', '灰度阈值分割', ['手动 / Otsu 阈值', '选择暗孔隙或亮区域', '保留原始分割体素统计']],
  [1080, 256, '04 / LABEL', '标记连通孔隙', ['6 / 26 邻域', '最小体素数筛选', '记录边界接触情况']],
  [1080, 584, '05 / MEASURE', '定量计算', ['孔隙率 / 体积 / 等效直径', '质心 / 体素面面积', 'Z 剖面 / 阈值敏感性']],
  [740, 584, '06 / PRESERVE', '留存可追溯结果', ['输入 SHA-256 指纹', '任务 ID / 参数 / 引擎版本', '独立线程写入结果文件']],
  [400, 584, '07 / REVIEW', '复核与审计', ['查看历史分析结果', '追加接受 / 退回复核记录', '企业内操作审计']],
  [60, 584, '08 / EXPORT', '导出交付', ['JSON 完整报告', 'CSV 全量连通域', 'PNG 三维视图']],
];
const workflow = [
  `<rect x="60" y="178" width="1320" height="44" rx="10" fill="#132a2b"/>${text(80, 206, '执行保障：持久化队列  /  独立计算线程  /  任务取消与超时  /  输入完整性校验', 'tag')}`,
  ...steps.map(([x, y, eyebrow, title, lines], i) => card(x, y, 300, 194, eyebrow, title, lines, i > 3 ? 'purple' : 'teal')),
  path('M360 352 H400'), path('M700 352 H740'), path('M1040 352 H1080'),
  path('M1230 450 V584', '计算结果', 1247, 520),
  path('M1080 680 H1040'), path('M740 680 H700'), path('M400 680 H360'),
].join('');

await mkdir(output, { recursive: true });
await writeFile(new URL('architecture.svg', output), svg('VoxelScope · 系统架构', '当前实现：单实例自托管 CT 孔隙分析与团队协作平台', 1000, architecture, '单分析线程 · 每体数据 ≤ 4,194,304 体素 · Docker / HTTPS 配置供目标环境验证'));
await writeFile(new URL('workflow.svg', output), svg('VoxelScope · CT 分析流程', '从体数据导入到定量分析、复核和结果交付', 900, workflow, '合成 phantom 用于程序验证；真实工件的分割与测量需单独验证。'));
console.log(`Documentation diagrams written to ${fileURLToPath(output)}`);
