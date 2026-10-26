# VoxelScope · Enterprise CT Intelligence

[中文](README.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md)

[![checks](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml/badge.svg)](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml)

A self-hosted CT porosity analysis platform for materials inspection teams. Organize projects, import volumes, visualize pores, run reproducible measurements, review results, and inspect an audit trail.

![Running workbench with a synthetic phantom](docs/screenshots/workbench.png)

Built around **multi-tenant workspaces, 3D analysis, asynchronous computation, and result traceability**. Bounded RAW reads support extracting regions and downsampled grids from GB-scale source files. Original dimensions, region coordinates, and sampling strides are preserved with each result. See the [large-file import guide](docs/DATA_IMPORT.md).

## Architecture and analysis workflow

![Implemented architecture: browser workbench, HTTPS API, SQLite queue, worker thread, and persistent storage](docs/diagrams/architecture.svg)

![CT workflow: import, ROI, thresholding, connectivity, measurement, result persistence, review, and export](docs/diagrams/workflow.svg)

The diagrams use Chinese labels and describe the current implementation. Regenerate the editable SVG files with `npm run docs:diagrams`. [Architecture details](docs/ARCHITECTURE.md).

| Jobs and review | Audit trail |
|---|---|
| ![Jobs and review UI](docs/screenshots/jobs.png) | ![Audit chain UI](docs/screenshots/audit.png) |

Screenshots come from the running application with test accounts and a deterministic synthetic phantom.

## Run

Requires Node.js **24.x**. No runtime packages, package install, CDN, external API, or model download are needed.

```bash
git clone https://github.com/perceivedreality11-cyber/voxelscope.git
cd voxelscope
npm start
```

Open http://127.0.0.1:8787. First startup prints a random password for `admin@local`. Change it through the account panel and sign in again.

Create a project, click **加载演示数据**, and inspect the completed result. The UI is in Chinese with English technical labels. The deterministic synthetic phantom is explicitly identified in its metadata and UI; it is not a real scan.

## Implemented

- Tenant-scoped projects, datasets, jobs, reviews, and audit records.
- Admin, analyst, and viewer roles, member disabling, password changes, expiring sessions.
- Native uint8/uint16 RAW import with bounded reads, region selection, XYZ sampling strides, endianness/header controls, progress and cancellation; PNG/JPEG/BMP stacks converted to uint8 by the browser.
- WebGL pore-surface point clouds with orbit/zoom, physical-aspect orthogonal slices, PNG capture, Canvas2D fallback.
- Manual and 256-bin Otsu segmentation, 6/26 connectivity, small-component filtering, box/elliptical-cylinder ROI.
- Porosity, equivalent diameter, centroid, anisotropic voxel-face area, ROI-boundary contact, depth profile, threshold sensitivity.
- Durable SQLite queue, independent worker thread, timeout/cancellation, explicit interrupted-job state after restart.
- SHA-256 input integrity checks and versioned reports; append-only reviews; per-tenant audit hash chains.
- JSON/CSV exports, consistent snapshot backup, Docker/HTTPS configuration, CI workflows.

## Validate

```bash
npm run check
npm test
npm run test:load
node scripts/benchmark.mjs
```

Optional browser regression:

```bash
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node scripts/ui-smoke.mjs
```

See [validation evidence](docs/VALIDATION.md) for numerical, HTTP, browser and concurrent-session checks. The live CI badge links to Windows, Ubuntu and Chromium runs.

For source archive extraction, first-push commands, and repository setup, see the [GitHub publishing guide](docs/PUBLISHING.md).

## Data and measurement conventions

Select an ROI inside the specimen and use the reconstruction's physical voxel spacing. ROI-boundary contact describes pores intersecting the measurement region. Areas use voxel faces, point clouds sample exposed voxel centers, and the sensitivity chart compares raw porosity at five thresholds. See the [measurement definitions](docs/USAGE.md).

Image stacks produce uint8 data. Use unsigned 16-bit RAW to preserve native high-bit-depth precision, and export TIFF/DICOM scans to RAW in the reconstruction software. The [import guide](docs/DATA_IMPORT.md) records the analysis-grid budget and the resolution effects of subsampling.

The default deployment uses one application instance, one analysis worker, and SQLite. Tenant members share projects through three server-enforced roles. Capacity settings, backups and acceptance checks are in the [deployment guide](docs/DEPLOYMENT.md); multi-node and identity-integration designs are in the [architecture roadmap](docs/ARCHITECTURE.md).

License: MIT. Commercial use is allowed. Use the deployment acceptance procedure to calibrate scan parameters and compare specimen measurements against reference results.
