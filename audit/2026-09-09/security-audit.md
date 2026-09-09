# Security Vulnerability Audit

## Executive summary

This focused review covers the Server-Verified Expedition Proof slice: canonical start authorization, Nimiq signature reuse, memory run/session binding, the new proof migration, and the start HTTP dispatcher. No confirmed vulnerability was found in the reviewed changes. Database privilege/RLS behavior and deployed transport configuration remain unverified without an enabled Supabase integration.

## Scope, methodology, and limitations

- Reviewed the repository instructions and the changed proof/authentication/SQL paths.
- Applied the OWASP Top 10:2025 categories most relevant to access control, authentication, cryptography, integrity, configuration, and exceptional conditions.
- Ran the focused unit tests, full unit suite, lint, typecheck, and production build.
- No live database, device, TLS, rate-limit, or production dynamic testing was performed.
- Secret values were not copied into this report.

## Severity summary

| Severity | Confirmed | Assessment gaps |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 2 |
| Low | 0 | 1 |

## Findings

No confirmed findings in the reviewed implementation slice.

## OWASP coverage matrix

| Category | Result |
|---|---|
| A01 Broken Access Control | Reviewed; session identity is server-derived in the memory primitive and protected SQL writes are deny-by-default. Live RLS remains unverified. |
| A02 Security Misconfiguration | Reviewed; start responses set `Secure`, `HttpOnly`, `SameSite=Strict`, `no-store`, and `nosniff`. Deployment headers/TLS remain unverified. |
| A03 Software Supply Chain Failures | Not assessed beyond the existing lockfile and build. |
| A04 Cryptographic Failures | Reviewed; Nimiq signed-message verification is reused, SHA-256 is domain separated, and run sessions use CSPRNG entropy. |
| A05 Injection | Reviewed; the new SQL contains no dynamic SQL and uses fixed RPC statements. |
| A06 Insecure Design | Reviewed; start authorization, challenge binding, day binding, limit enforcement, and idempotency are modeled as one critical section. |
| A07 Authentication Failures | Reviewed; sessions are random, hash-only at rest, expiring, and cookie-bound. Rate limiting remains a later hardening task. |
| A08 Software or Data Integrity Failures | Reviewed; blueprint hashes, immutable publication content, canonical payloads, and signature/address binding are checked. |
| A09 Security Logging and Alerting Failures | Not assessed; no production observability configuration was part of this slice. |
| A10 Mishandling of Exceptional Conditions | Reviewed; missing/expired/invalid challenges fail closed and do not increment attempts in memory tests. Live transaction rollback remains unverified. |

## Dependency and tooling results

- `npm test`: pass, 229 passed, 1 skipped.
- `npm run lint`: pass.
- `npx tsc -b`: pass.
- `npm run build`: pass; existing large game-chunk warning remains.
- No dependency audit or live database scan was run.

## Prioritized remediation plan

1. Run the proof migration and RLS/privilege/concurrency integration suite against a dedicated Supabase test project.
2. Add production request rate limiting and monitoring for repeated invalid signatures/challenges before enabling reward-mode traffic.
3. Complete authenticated checkpoint and recovery endpoints using the same session primitive.

## Unassessed areas and assumptions

- Supabase integration is pending because the integration gate is not enabled in this environment.
- The secure cookie assumes HTTPS same-origin deployment.
- The current slice intentionally does not include checkpoints, claims, settlement, or payout behavior.
