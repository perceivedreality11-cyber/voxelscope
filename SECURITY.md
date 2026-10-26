# Security policy

This policy covers VoxelScope 1.0, its server authorization, account lifecycle, data handling, and deployment controls.

## Reporting

Do not publish credentials, customer volumes, or an exploitable report in a public issue. Use the repository owner's private security advisory channel if it is enabled, or contact the owner privately. No security contact address is invented by this template.

## Controls implemented

Tenant-scoped server authorization, three roles, scrypt password hashes, expiring opaque sessions, cookie flags, CSRF / Origin checks, input and body-size limits, parameterized SQL, static-file allowlist, HTML escaping, CSP, per-peer login throttling, input checksum verification, append-only review APIs, and audit hash chains.

## Scope and limitations

- The operator controls the host, database, volume files, backups, TLS termination, and account provisioning.
- Authorization applies at tenant and role level: tenant members can read every project and dataset within their tenant. Review records are append-only workflow records.
- Hash chains lack an external trust anchor. Host / DB administrators can edit and recompute them, or truncate the tail.
- Login limiting uses the TCP peer address and is shared behind a proxy. A production gateway should apply its own controls.
- The queue is single-instance. Do not run multiple app processes against one directory.
- Input quotas do not cover result files. Enforce disk monitoring and a retention policy outside the application.
- Resolve deployment image tags to approved digests and validate image updates as part of release acceptance. Register third-party security assessments with their report identifiers and tested versions.

Run the application behind HTTPS for network access. Keep `.env`, `data/`, backups, logs, and real customer datasets out of the repository. The checked-in screenshots contain synthetic data and test-only accounts.
