<div align="center">

# VoxelScope

### CT 孔隙分析与检测协作平台

**在浏览器中查看三维孔隙、完成定量分析，并与团队共同复核检测结果。**

[![checks](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml/badge.svg)](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[快速开始](#快速开始) · [导入扫描数据](#导入扫描数据) · [团队部署](#团队部署) · [使用手册](docs/USAGE.md) · [English](README.en.md)

</div>

![VoxelScope 三维孔隙分析工作台](docs/screenshots/workbench.png)

*工作台示例：内置合成体数据。*

VoxelScope 面向材料实验室、无损检测工程师和检测团队，将 CT 重建后的体数据、孔隙测量和结果复核组织在同一个工作空间。你可以按工件或批次建立项目，查看孔隙的空间分布，对同一数据采用不同参数重复分析，并导出测量结果。

平台支持本机运行和自有服务器部署，分析数据与结果保存在自己的部署环境中。

## 可以用它做什么

| 工作任务 | VoxelScope 提供的功能 |
|---|---|
| 观察孔隙结构 | 旋转、缩放三维孔隙点云，结合 XY / XZ / YZ 切片查看位置与分布 |
| 测量孔隙特征 | 统计孔隙率、连通域数量、体积、等效直径和质心，查看沿深度的孔隙率变化 |
| 调整分割结果 | 使用手动或 Otsu 阈值，设置邻域、最小体素数及测量区域，结合切片检查分割效果 |
| 导入大型 RAW 文件 | 从 GB 级原文件按区域提取体数据，或降采样后查看整体分布；记录裁剪与采样参数 |
| 管理检测过程 | 按项目保存数据集、分析任务和历史结果，查阅每次计算采用的参数 |
| 协作与交付 | 分配成员角色、追加复核意见，导出 JSON 报告、孔隙 CSV 和三维 PNG 图片 |

## 快速开始

准备 **Node.js 24.x** 和 Git，在终端运行：

```bash
git clone https://github.com/perceivedreality11-cyber/voxelscope.git
cd voxelscope
npm start
```

也可以[下载源码 ZIP](https://github.com/perceivedreality11-cyber/voxelscope/archive/refs/heads/main.zip)，解压后在项目目录运行 `npm start`。运行应用无需安装额外 npm 包；Windows 用户可双击 `start.cmd`。

打开 **http://127.0.0.1:8787**，使用 `admin@local` 和首次启动时终端显示的初始密码登录。在侧栏账户设置中修改密码后，重新登录。

### 完成第一次分析

1. 点击「创建检测项目」，填写工件或检测批次名称。
2. 点击「加载演示数据」，查看自动完成的三维孔隙分析。
3. 调整阈值、测量区域或最小体素数，点击「提交分析任务」生成新结果。
4. 在「任务与复核」打开历史结果、填写复核意见，或从工作台下载 JSON / CSV。

内置示例可直接体验完整流程；导入自己的扫描数据后，使用相同的工作台进行分析。

## 导入扫描数据

点击「导入体数据」，填写数据集名称和 CT 重建得到的体素间距。

| 数据来源 | 导入方式 |
|---|---|
| 8 / 16 位无符号 RAW | 填写原始 XYZ 尺寸、位深、字节序和文件头偏移 |
| GB 级 RAW 原文件 | 在「RAW 区域与降采样」设置区域起点、尺寸及 XYZ 采样步长，按需读取目标网格 |
| PNG / JPEG / BMP 切片 | 选择至少两张同尺寸切片；文件名按自然顺序排列，导入为 8 位灰度 |
| TIFF / DICOM 重建结果 | 先在重建软件中导出 RAW 或上述切片格式，再导入 |

对精细孔隙进行定量时，可选取原分辨率区域；查看大范围结构时，可使用降采样。采样步长会同步更新体素间距，原始尺寸与采样参数随报告保存。

[查看区域读取示例、网格参数和采样说明 →](docs/DATA_IMPORT.md)

## 分析与复核流程

![CT 数据导入、孔隙分析、结果复核与导出流程](docs/diagrams/workflow.svg)

提交分析后，可以继续浏览项目或切换页面。每次计算作为独立任务保存，便于回看结果和核对参数。复核意见追加在对应任务下，保留复核人、时间和结论。

| 任务与结果复核 | 操作记录 |
|---|---|
| ![任务与复核页面](docs/screenshots/jobs.png) | ![操作审计页面](docs/screenshots/audit.png) |

## 团队使用

管理员可以在「团队与权限」添加成员，并按工作职责分配角色。

| 角色 | 可执行的操作 |
|---|---|
| 管理员 | 管理成员、查看操作记录，并执行项目、分析与复核操作 |
| 分析员 | 创建项目、导入数据、提交或取消分析、追加复核意见 |
| 查看者 | 查阅项目与结果、查看复核记录、下载分析结果 |

同一企业工作空间中的成员共享项目，角色决定可执行的操作；不同企业工作空间的数据分别管理。多企业配置、账号恢复和备份方法见[部署手册](docs/DEPLOYMENT.md)。

## 团队部署

通过 Docker Compose 配置应用、HTTPS 入口和数据卷：

```bash
cp .env.example .env
# 编辑 .env：设置管理员密码，并配置域名与 PUBLIC_ORIGIN
docker compose up --build -d
```

部署时按服务器环境配置证书、存储与备份。完整配置项和验收步骤见[部署与运维](docs/DEPLOYMENT.md)。

![VoxelScope 系统架构](docs/diagrams/architecture.svg)

## 文档与支持

| 需要了解的内容 | 文档 |
|---|---|
| 操作流程、测量定义与导出字段 | [使用手册](docs/USAGE.md) |
| RAW 区域读取、采样与网格参数 | [数据导入](docs/DATA_IMPORT.md) |
| HTTPS、账号、容量设置与备份恢复 | [部署与运维](docs/DEPLOYMENT.md) |
| 测试方法与验证记录 | [验证记录](docs/VALIDATION.md) |
| 系统设计与 API 集成 | [架构](docs/ARCHITECTURE.md) · [API](docs/API.md) |
| 问题反馈与功能建议 | [GitHub Issues](https://github.com/perceivedreality11-cyber/voxelscope/issues) |
| 开发与贡献 | [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) |

VoxelScope 采用 [MIT 许可证](LICENSE)，允许商业使用、修改和分发。
