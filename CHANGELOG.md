# Changelog

## 1.0.0

Initial enterprise-workflow MVP: multi-tenant accounts and RBAC, project/dataset organization, native unsigned RAW and browser image stacks, WebGL pore rendering, orthogonal slices, deterministic volumetric analysis, persistent worker queue, append-only reviews, exports, audit chaining, snapshot backup and restore tooling, deployment configuration, and automated regression workflows.

Current scope is small-volume ROI inspection and internal pilots. Large-volume streaming, distributed execution, project ACLs, SSO, compliance signatures, and metrology qualification are not included.

Delivery verification (2026-10-26): browser regression now parses JSON/CSV exports and checks their values against the persisted report, validates PNG export signatures, checks natural Z ordering using distinct PNG slices, and exercises a separate read-only viewer session. Added a first-push GitHub guide and convenient browser/benchmark commands.

Repository presentation: added reproducible architecture and CT workflow diagrams in SVG and PNG, a diagram-generation command, and real application screenshot galleries in both READMEs.
