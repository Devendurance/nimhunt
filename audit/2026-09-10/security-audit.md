# Security Vulnerability Audit

## Executive summary

This was a narrow review of the authenticated product-start client slice. No new confirmed security vulnerability was found in the changed coordinator, gate, Practice isolation, wallet-status lifecycle, or client integration tests.

The prior credential remediation remains recorded in commit `57a902577747f7bca316c92ebc11758b7dbe116f`. The current `.env.example` contains placeholders, `.env` is ignored and untracked, and the reviewed client diff contains no raw session capability or credential material.

## Scope, methodology, and limitations

- Reviewed `useProductStart`, product-start state, `ProductExpeditionGate`, `useAngkorRun`, product wallet memory, browser proof API helpers, Practice routing, and related client/server tests.
- Reviewed the changed client trust boundaries against OWASP Top 10:2025 A06, A07, A08, and A10.
- Ran the focused product-start/session tests, full Vitest suite, ESLint, TypeScript build, production build, `git diff --check`, and redacted secret/session-capability scans.
- This was not a full repository penetration test, dependency audit, Postgres audit, device validation, or real Nimiq Pay review.

## Severity summary

No Critical, High, Medium, or Low findings were confirmed in this slice.

## Findings

No findings.

The empty-account path was covered as a workflow correctness defect, not a security vulnerability: `ACCOUNT_EMPTY` now returns the safe cancelled/no-attempt state and cannot request a challenge or submit `/start`.

## OWASP coverage matrix

| Category | Result |
|---|---|
| A06:2025 Insecure Design | Reviewed deliberate authorization, cancellation, recovery, Practice isolation, and pre-mount gating; no new finding. |
| A07:2025 Authentication Failures | Reviewed account selection freeze, no wallet-as-session behavior, and server-bound route gating; no new finding. |
| A08:2025 Software or Data Integrity Failures | Reviewed exact signed-start retry and strict active/gameplay response boundaries; no new finding. |
| A10:2025 Mishandling of Exceptional Conditions | Reviewed empty account, signature cancellation, network-loss recovery, invalid/expired challenge, and post-marker reload paths; no new finding. |
| A01/A02/A03/A04/A05/A09 | Not assessed in this narrow slice. |

## Dependency and tooling results

- `npm test`: 292 passed, 1 skipped across 40 files.
- `npm run lint`: passed.
- `npx tsc -b --force`: passed.
- `npm run build`: passed; existing large Phaser chunk warning remains.
- No dependency audit was run; dependency provenance and supply-chain risks are outside this focused slice.

## Prioritized remediation plan

1. Keep real Nimiq Pay manual validation as the next gate.
2. Implement and validate the separate Postgres proof backend and device-validation milestone before enabling non-memory proof.
3. Keep checkpoints, replay finalization, claims, reservation, payout, treasury, and new gameplay mechanics out of this slice.

## Unassessed areas and assumptions

- Browser/provider behavior was mocked; real account approval, multi-account selection, signature cancellation, and induced response loss remain unrun.
- Postgres/RLS/RPC behavior and deployment configuration remain pending.
- Existing security remediation history was trusted from the recorded owner confirmation and current redacted scans; secret values were not printed.
