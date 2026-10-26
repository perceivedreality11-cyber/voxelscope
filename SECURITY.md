# Security policy

VoxelScope 1.0 is an internal-pilot foundation, not a security-certified production product. Only version 1.0 is currently maintained in this repository.

## Reporting

Do not publish credentials, customer volumes, or an exploitable report in a public issue. Use the repository owner's private security advisory channel if it is enabled, or contact the owner privately. No security contact address is invented by this template.

## Controls implemented

Tenant-scoped server authorization, three roles, scrypt password hashes, expiring opaque sessions, cookie flags, CSRF / Origin checks, input and body-size limits, parameterized SQL, static-file allowlist, HTML escaping, CSP, per-peer login throttling, input checksum verification, append-only review APIs, and audit hash chains.

## Scope and limitations

- The operator controls the host, database, volume files, backups, TLS termination, and account provisioning.
- Tenant members can read every project and dataset within their tenant. There are no project-level ACLs, MFA, SSO, or independent-review enforcement.
- Hash chains lack an external trust anchor. Host / DB administrators can edit and recompute them, or truncate the tail.
- Login limiting uses the TCP peer address and is shared behind a proxy. A production gateway should apply its own controls.
- The queue is single-instance. Do not run multiple app processes against one directory.
- Input quotas do not cover result files. Enforce disk monitoring and a retention policy outside the application.
- Docker tags are not digest pinned; image updates require validation. No claim of an independent audit or penetration test is made.

Run the application behind HTTPS for network access. Keep `.env`, `data/`, backups, logs, and real customer datasets out of the repository. The checked-in screenshots contain synthetic data and test-only accounts.
