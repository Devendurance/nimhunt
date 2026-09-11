# Security Vulnerability Audit

## Executive summary

This follow-up review covers the authenticated product-start implementation, its HTTP/session boundary, the product pre-mount gate, the typed browser parser, and the wallet-status path. No new confirmed vulnerability was established in the reviewed changes. The previously documented credential-shaped `.env.example` exposure remains a historical high-severity finding; the current template is scrubbed and the authorized owner reported revocation/deactivation.

## Scope, methodology, and limitations

- Reviewed repository instructions, the approved authenticated product-start design/plan, changed product-start/API/game boundary files, environment configuration, and relevant tests.
- Applied OWASP Top 10:2025 categories A01-A10 as a static, threat-model-oriented review.
- Ran repository tests, ESLint, TypeScript, production build, redacted secret checks, and local Vite route smoke checks.
- No secret, session capability, private key, or raw credential value was copied into this report.
- Postgres/RLS/RPC behavior, deployment TLS/proxy configuration, rate limiting, dependency vulnerability status, CI/CD controls, and real Nimiq Pay behavior remain unverified.

## Severity summary

| Severity | New confirmed | Assessment gaps |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 1 historical credential exposure |
| Medium | 0 | 4 |
| Low | 0 | 1 |

## Findings

### Existing SEC-001 — Credential-shaped service-role value in environment template

- Severity: High
- Confidence: Confirmed for historical repository exposure; revocation reported by the authorized owner
- OWASP: A07:2025 — Authentication Failures
- CWE: CWE-798 — Use of Hard-coded Credentials
- Location: Historical `.env.example` path, previously recorded in `audit/2026-09-09/security-audit-191145.md`
- Evidence: The current redacted scan finds the expected variable name but no credential value in the current template or changed application source. The historical path remains in Git history.
- Impact: A valid historical service-role value could provide administrative access to the Supabase project.
- Suggested fix: Preserve revocation, audit downstream copies and repository access, and rewrite history only if repository policy requires it.
- Validation: Authorized owner revocation confirmation and repeated redacted scan.

## OWASP coverage matrix

| Category | Result |
|---|---|
| A01 Broken Access Control | Product active/gameplay-start routes bind authorization to the server session cookie and requested run; Postgres enforcement remains unverified. |
| A02 Security Misconfiguration | Memory proof is explicit and development/test-only; preview/production fail closed. Deployment headers/TLS remain unverified. |
| A03 Software Supply Chain Failures | Lockfile and build were used; no dependency vulnerability audit or CI/CD provenance review was run. |
| A04 Cryptographic Failures | Nimiq signatures, canonical payloads, CSPRNG session capabilities, hash-only persistence, and no-store responses were reviewed. Key management and transport configuration remain unverified. |
| A05 Injection | HTTP body/query allowlists, bounded input, JSON content-type checks, and parameterized server boundaries were reviewed; no new injection finding established. |
| A06 Insecure Design | Product start, active recovery, gameplay-start idempotency, fail-closed route gating, and explicit Practice separation match the approved threat model. |
| A07 Authentication Failures | Session capabilities are cookie-bound and not exposed to the browser JSON/URL/state; manual wallet authentication behavior remains unverified. |
| A08 Software or Data Integrity Failures | Server blueprint/state identity is checked at the API and gate boundaries; the product scene consumes trusted active data only after the gate. |
| A09 Security Logging and Alerting Failures | No raw capability/signature logging was found in the reviewed paths; production monitoring and alerting were not assessed. |
| A10 Mishandling of Exceptional Conditions | Network recovery retains the exact signed request, gameplay-start retry is idempotent, malformed responses fail closed, and stale async work is guarded. Stress/concurrency and live transaction rollback remain unverified. |

## Dependency and tooling results

- `npm test`: pass — 37 files, 269 passed, 1 skipped.
- `npm run lint`: pass.
- `npx tsc -b --force --pretty false`: pass.
- `npm run build`: pass; existing large Phaser chunk warning remains.
- `git diff --check`: pass aside from Windows CRLF normalization warnings.
- Redacted secret scan: no current raw credential value reported; `.env` is ignored and untracked.
- Local Vite route smoke: required non-wallet routes and the bare product locator returned HTTP 200; route tests verify the bare locator does not mount Phaser.
- No `npm audit`, live database, production dynamic, device, or real Nimiq Pay test was run.

## Prioritized remediation plan

1. Run the real Nimiq Pay manual start/cancellation/retry gate when the environment is available.
2. Validate the proof migration, RLS/RPC atomicity, session behavior, TLS/proxy policy, and rate limits against a dedicated test deployment before enabling non-memory proof.
3. Add dependency/SBOM and production security monitoring checks to CI/CD.
4. Keep repeating the redacted secret scan after future configuration changes.

## Unassessed areas and assumptions

- The memory adapter is development/test-only by explicit runtime policy; it is not evidence of Postgres correctness or production readiness.
- Browser and local HTTP smoke tests cannot prove wallet approval UX, signature correctness inside Nimiq Pay, or device/WebView cookie behavior.
- Checkpoints, replay finalization, claims, reservation, payout, treasury, device validation, and Postgres proof integration remain outside this slice.
