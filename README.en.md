# VoxelScope · Enterprise CT Intelligence

[中文](README.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md)

[![checks](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml/badge.svg)](https://github.com/perceivedreality11-cyber/voxelscope/actions/workflows/ci.yml)

A self-hosted CT porosity analysis platform for materials inspection teams. Organize projects, import volumes, visualize pores, run reproducible measurements, review results, and inspect an audit trail.

![Running workbench with a synthetic phantom](docs/screenshots/workbench.png)

**Status: an enterprise-workflow MVP for small ROI validation and internal pilots.** Multi-tenant authorization and persistence are implemented. The current engine caps a volume at 4,194,304 voxels; it does not process full industrial CT volumes of tens of GB. It has not undergone enterprise load qualification, independent penetration testing, or metrology certification.

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
- Native uint8/uint16 RAW import with endianness/header controls; PNG/JPEG/BMP stacks converted to uint8 by the browser.
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
node scripts/benchmark.mjs
```

Optional browser regression:

```bash
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node scripts/ui-smoke.mjs
```

See [validation evidence](docs/VALIDATION.md). GitHub workflows are provided; remote CI status is not claimed before a push.

For source archive extraction, first-push commands, and repository setup, see the [GitHub publishing guide](docs/PUBLISHING.md).

## Measurement boundaries

The ROI must lie within the specimen. There is no automatic specimen mask; surrounding air is counted as pore space if included. ROI-boundary contact is **not** a measurement of open porosity. Voxel-face area is a grid approximation, and point clouds are visualization samples. Threshold sensitivity is not a confidence interval.

Image-stack decoding does not preserve source 16-bit PNG precision. TIFF, DICOM, signed/float RAW, and volumetric meshing are not supported. Use unsigned 16-bit RAW for native high-bit-depth analysis.

The deployment is single-instance, single-compute-worker, and SQLite-backed. Tenant members share all projects in their tenant. SSO/MFA, per-project ACLs, enforced independent approval, distributed processing, automatic retention, and regulatory e-signatures are future work. Audit hashes detect edits relative to the stored chain; a database administrator can recompute the entire chain.

License: MIT. Commercial use is allowed. Validate the measurement method against real scans and reference measurements before using it for production quality decisions.
