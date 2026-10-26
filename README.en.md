<div align="center">

# VoxelScope

### CT Porosity Analysis and Inspection Collaboration

**Inspect pores in 3D, measure their properties, and review results with your team—all in your browser.**

[![checks](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml/badge.svg)](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Get started](#get-started) · [Import scan data](#import-scan-data) · [Team deployment](#team-deployment) · [User guide](docs/USAGE.md) · [中文](README.md)

</div>

![VoxelScope 3D porosity analysis workbench](docs/screenshots/workbench.png)

*Workbench example using the built-in synthetic volume.*

VoxelScope brings reconstructed CT volumes, pore measurements, and result reviews into one workspace for materials laboratories and inspection teams. Organize specimens or batches into projects, inspect pore distributions, repeat analyses with different parameters, and export your measurements.

Run it on your own computer or deploy it on your own server. Analysis data and results stay in your deployment environment.

## What you can do

| Task | Features |
|---|---|
| Inspect pore structure | Rotate and zoom a 3D pore point cloud alongside XY / XZ / YZ slices |
| Measure pore properties | Calculate porosity, connected-component count, volume, equivalent diameter, centroid, and depth profiles |
| Refine segmentation | Adjust manual or Otsu thresholds, connectivity, minimum component size, and measurement region; inspect slice overlays |
| Import large RAW sources | Extract regions or downsample grids from GB-scale files, preserving the crop and sampling parameters |
| Manage inspection work | Keep datasets, analysis jobs, historical results, and calculation parameters within projects |
| Review and deliver results | Assign team roles, append review decisions, and export JSON reports, pore CSV files, and 3D PNG images |

## Get started

Install **Node.js 24.x** and Git, then run:

```bash
git clone https://github.com/perceivedreality11-cyber/voxelscope.git
cd voxelscope
npm start
```

Alternatively, [download the source ZIP](https://github.com/perceivedreality11-cyber/voxelscope/archive/refs/heads/main.zip), extract it, and run `npm start` in the project directory. The application needs no additional npm packages. Windows users can launch `start.cmd`.

Open **http://127.0.0.1:8787**. Sign in as `admin@local` using the initial password printed in the terminal on first startup. Change it through the account settings and sign in again.

### Run your first analysis

The interface uses Chinese labels:

1. Select **创建检测项目** to create a project for a specimen or batch.
2. Select **加载演示数据** to load the example volume and inspect its completed analysis.
3. Adjust the threshold, region, or minimum voxel count, then select **提交分析任务** to create another result.
4. Open **任务与复核** to revisit results and add review comments, or download JSON / CSV from the workbench.

The built-in example lets you try the complete workflow before importing your own scans.

## Import scan data

Select **导入体数据**, name the dataset, and enter the voxel spacing from your CT reconstruction.

| Source | How to import |
|---|---|
| Unsigned 8 / 16-bit RAW | Enter the original XYZ dimensions, bit depth, byte order, and header offset |
| GB-scale RAW file | Under **RAW 区域与降采样**, choose a region origin, extent, and XYZ sampling strides |
| PNG / JPEG / BMP stack | Select at least two equal-sized slices; files are naturally sorted by name and imported as 8-bit grayscale |
| TIFF / DICOM reconstruction | Export RAW or a supported slice format from your reconstruction software first |

Use an original-resolution region for fine-pore measurements, or a downsampled grid to inspect a wider distribution. Sampling adjusts the voxel spacing, and the report retains the original dimensions and sampling settings.

[Region examples, grid parameters, and sampling details →](docs/DATA_IMPORT.md)

## Analysis and review

![CT import, pore analysis, review, and export workflow](docs/diagrams/workflow.svg)

After submitting an analysis, you can keep browsing projects or switch pages. Each calculation is saved as a separate job so its result and parameters can be revisited. Review comments are appended to the job with the reviewer, timestamp, and decision.

| Jobs and review | Activity records |
|---|---|
| ![Jobs and review page](docs/screenshots/jobs.png) | ![Audit page](docs/screenshots/audit.png) |

## Work with a team

Administrators add members through **团队与权限** and assign roles based on their responsibilities.

| Role | Available actions |
|---|---|
| Administrator | Manage members, inspect activity records, and perform project, analysis, and review operations |
| Analyst | Create projects, import data, submit or cancel analyses, and append review comments |
| Viewer | Browse projects and results, read reviews, and download analysis outputs |

Members share projects within their company workspace, with roles controlling available operations. Separate company workspaces manage their data independently. See the [deployment guide](docs/DEPLOYMENT.md) for workspace provisioning, account recovery, and backups.

## Team deployment

Docker Compose configures the application, HTTPS gateway, and data volumes:

```bash
cp .env.example .env
# Edit .env: set the administrator password, domain, and PUBLIC_ORIGIN.
docker compose up --build -d
```

Configure certificates, storage, and backups for your server. Follow the [deployment and operations guide](docs/DEPLOYMENT.md) for configuration and acceptance checks.

![VoxelScope system architecture](docs/diagrams/architecture.svg)

## Documentation and support

| Topic | Guide |
|---|---|
| Workflow, measurement definitions, and exports | [User guide](docs/USAGE.md) |
| RAW regions, sampling, and grid parameters | [Data import](docs/DATA_IMPORT.md) |
| HTTPS, accounts, capacity settings, and backup recovery | [Deployment](docs/DEPLOYMENT.md) |
| Test methods and validation records | [Validation](docs/VALIDATION.md) |
| System design and API integrations | [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) |
| Questions and feature requests | [GitHub Issues](https://github.com/perceivedreality11-cyber/voxelscope/issues) |
| Development and contributions | [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) |

The detailed guides and diagram labels are in Chinese.

VoxelScope is available under the [MIT license](LICENSE), permitting commercial use, modification, and distribution.
