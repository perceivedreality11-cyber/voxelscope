# Changelog

## 1.0.0

CT analysis and collaboration platform: multi-tenant accounts and RBAC, project/dataset organization, native unsigned RAW and browser image stacks, WebGL pore rendering, orthogonal slices, deterministic volumetric analysis, persistent worker queue, append-only reviews, exports, audit chaining, snapshot backup and restore tooling, deployment configuration, and automated regression workflows.

RAW import now supports GB-scale source files through bounded 4 MiB reads, region selection and XYZ strides. Native uint16 precision, normalized little-endian data, adjusted physical spacing, sampling provenance, progress and cancellation are covered by regression checks. The analysis-grid budget is documented in the import guide.

Added a reproducible HTTP workload using distinct viewer accounts while analysis jobs run; the CI matrix runs this workload on Windows and Ubuntu. Repository documentation now presents functionality and measured evidence, with operating parameters and acceptance records in the technical guides.

Delivery verification (2026-10-26): browser regression now parses JSON/CSV exports and checks their values against the persisted report, validates PNG export signatures, checks natural Z ordering using distinct PNG slices, and exercises a separate read-only viewer session. Added a first-push GitHub guide and convenient browser/benchmark commands.

Repository presentation: added reproducible architecture and CT workflow diagrams in SVG and PNG, a diagram-generation command, and real application screenshot galleries in both READMEs.
