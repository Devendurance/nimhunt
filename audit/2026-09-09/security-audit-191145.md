# Security Vulnerability Audit

## Executive summary

This focused review covers the repository security gate for the authenticated product-start work and the existing expedition proof boundary. A credential-shaped Supabase service-role value was confirmed in the tracked `.env.example` at the checkpoint commit; the working-tree template is scrubbed, and the authorized owner has confirmed that the historical credential was revoked/deactivated. Any repository-history remediation remains policy-dependent. No other confirmed finding was established in this limited static review.

## Scope, methodology, and limitations

- Reviewed `AGENTS.md`, the authenticated product-start plan, environment configuration, expedition HTTP/session code, ledger middleware, and package manifest.
- Applied the OWASP Top 10:2025 categories relevant to credentials, access control, authentication, configuration, integrity, injection, and exceptional conditions.
- Ran a redacted tracked-file scan, ignore-rule check, relevant history-path check, and `npm test`.
- No credential value was copied into this report or retained in new files.
- No direct Supabase dashboard, database/RLS, TLS, rate-limit, deployment, or production dynamic testing was performed; revocation is recorded from the authorized owner confirmation.

## Severity summary

| Severity | Confirmed | Assessment gaps |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 1 | 0 |
| Medium | 0 | 3 |
| Low | 0 | 1 |

## Findings

### SEC-001 — Credential-shaped service-role value committed in environment template

- Severity: High
- Confidence: Confirmed for repository exposure; revocation reported by the authorized owner
- OWASP: A07:2025 — Authentication Failures
- CWE: CWE-798 — Use of Hard-coded Credentials
- Location: `.env.example:5-6` at checkpoint commit `7f2ac1105670f170b79752ad9e092a4f6cfbc426`
- Evidence: The tracked template contained a project-specific Supabase URL and a JWT-shaped value assigned to `SUPABASE_SERVICE_ROLE_KEY`. The redacted history scan confirmed the `.env.example` path is present in repository history. The current working-tree template contains placeholders only, and the authorized owner confirmed the historical value was revoked/deactivated.
- Impact: Anyone with access to the repository or its history may obtain administrative Supabase access if the exposed value is valid, potentially bypassing application authorization and altering ledger data.
- Suggested fix: Preserve the revocation, audit deployment and repository access, and rewrite history only if repository policy requires it. Keep only non-secret placeholders in `.env.example`; store replacements in ignored local or deployment secret storage.
- Validation: The authorized owner confirmed revocation/deactivation; run the redacted tracked/diff/history scan and verify `.env` is ignored and untracked.

## OWASP coverage matrix

| Category | Result |
|---|---|
| A01 Broken Access Control | Existing memory proof/session binding reviewed; live authorization and RLS remain unverified. |
| A02 Security Misconfiguration | Historical environment-template exposure is remediated in the current tree; deployment headers and TLS remain unverified. |
| A03 Software Supply Chain Failures | Lockfile presence checked; dependency provenance and vulnerability audit not run. |
| A04 Cryptographic Failures | Existing Nimiq signature verification, SHA-256 hashes, and random session capabilities reviewed. |
| A05 Injection | Reviewed fixed route parsing and static SQL boundary; no new injection finding established. |
| A06 Insecure Design | Authenticated product-start design reviewed; implementation is not yet complete. |
| A07 Authentication Failures | Credential exposure and reported revocation are recorded above; rate limiting remains unverified. |
| A08 Software or Data Integrity Failures | Existing canonical payload, blueprint hash, and proof-start design reviewed. |
| A09 Security Logging and Alerting Failures | Production monitoring and alerting were not assessed. |
| A10 Mishandling of Exceptional Conditions | Existing bounded-body and fail-closed proof paths reviewed; live transaction rollback remains unverified. |

## Dependency and tooling results

- Redacted secret scan: current tree and added diff lines contain no raw credential; historical environment-template exposure remains recorded without reproducing its value.
- `.env` ignore check: pass; `.env` is ignored and untracked.
- Authorized owner confirmation: historical Supabase service-role credential revoked/deactivated; direct dashboard verification was not available.
- `npm test`: pass, 229 passed, 1 skipped.
- `npm run lint`, `npx tsc -b`, and `npm run build`: prior baseline pass; final post-change verification is still required.
- No dependency audit or live database scan was run.

## Prioritized remediation plan

1. Audit deployments, repository access, and any downstream copies that may have used the historical credential.
2. Keep `.env.example` placeholder-only and repeat the redacted scan after future changes.
3. Run proof migration/RLS/concurrency integration tests against a dedicated Supabase test project before enabling production proof traffic.
4. Add production rate limiting, monitoring, and alerting for invalid starts before reward-mode launch.

## Unassessed areas and assumptions

- External Supabase dashboard state is unavailable to this workspace; revocation is based on the authorized owner confirmation.
- Repository history was inspected by path and redacted matching; no history rewrite was performed.
- The implementation still intentionally lacks Postgres proof integration, device validation, checkpoints, claims, settlement, and payout behavior.
