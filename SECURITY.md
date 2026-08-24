# Security Policy

WebZjs handles wallet keys and transaction data. Treat this project as security-sensitive software.

## Reporting a vulnerability

Please do not disclose exploitable wallet, key-management, seed-handling, transaction-signing, or dependency vulnerabilities in a public issue.

Report security issues privately to the repository maintainers through GitHub's private security reporting mechanism when available.

Include:

- affected component and version/commit
- reproducible steps or a minimal proof of concept
- security impact
- any suggested mitigation

Do not include real seed phrases, private keys, recovery phrases, or production wallet credentials.

## Scope

Particular attention should be given to:

- seed/private-key handling and memory lifetime
- WASM/JavaScript boundaries
- IndexedDB persistence and encryption boundaries
- transaction construction and signing
- lightwalletd/gRPC-web transport validation
- dependency and build-chain integrity

WebZjs is not considered audited software unless a published audit explicitly states otherwise. Production deployments should independently review the complete application stack and wallet threat model.