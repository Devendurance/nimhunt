# NimHunt - Left Off

> Updated: 2026-09-18 (Session-recovery bugfix PASS locally: 859 tests / lint / typechecks / build green; NOT pushed/deployed, no gameplay/reward/treasury/risk changes, no migration)

## Current Objective

Production session-recovery bugfix for the STARTED-run handoff failure (Start 200 -> Active 400, Treasure 400). Fix recovery without consuming a second expedition. Do not deploy automatically.

## Completed (this slice)

- **Session normalization**: INVALID_SESSION/SESSION_EXPIRED/SESSION_REVOKED/missing -> 401 RUN_SESSION_INVALID on expedition + treasure + monthly-stats + payout-recovery; unknown service errors -> 503 (never generic 400); statusFor covers session family + RUN_NOT_FOUND 404; plain-Error messages mapped.
- **Recovery endpoint**: POST /api/expeditions/session/recover {runId} (wallet-recovery HttpOnly auth, wallet==run.wallet, STARTED non-terminal unexpired only, reuses bind_run_session, hash-only persist, HttpOnly cookie only, zero attempts/runs/rewards); wired via proofRuntime + productAdapter + explicit vercel.json rewrite.
- **Client**: recoverRunSession API + gate auto-recovery ("Restoring your expedition…", wallet signature if needed, same runId refetch, retryable RECOVERY_FAILED, no second Start); Treasure unauthorized copy -> restoring (recovery-triggered refetch to EMPTY/READY).
- **Tests**: server/expeditions/sessionRecovery.test.ts (12: cookie audit, active handoff, absent/stale/expired 401, treasure/monthly 401, same-run resume, zero attempts/runs, foreign rejection, terminal 409, no capability leak, rewrite coverage); routing lists updated.
- **Verification**: 859 passed / 69 skipped (99 files); lint 0; typecheck:server 0; tsc -b 0; build ok (chunk warning only); diff-check clean; api/internal/payout-cycle.ts untouched; payout http change is status-mapping only (no amounts/treasury/risk/scheduler).

## Changed paths

- Modified: server/expeditions/http.ts, types.ts, memoryProofStore.ts, postgresProofStore.ts, proofRuntime.ts, server/vercel/productAdapter.ts (+tests), server/treasureBank/http.ts, server/monthlyHeroes/http.ts, server/payouts/http.ts (status mapping only), src/domain/expeditionProof.ts, src/api/expeditionProof.ts, src/components/play/ProductExpeditionGate.tsx, productGateState.ts, TreasureBank.tsx, vercel.json, .agent-state/*
- New: server/expeditions/sessionRecovery.test.ts
- Untouched: gameplay/replay/checkpoint/verify/rewardClaim/riskGate/treasuryCap, all SQL migrations, payout worker/scheduler/store, reward amounts, 69-slot rules

## Verification results

- npm test: 99 files passed / 5 skipped; 859 passed / 69 skipped.
- npm run lint: 0 errors. npm run typecheck:server: 0 errors. npx tsc -b --force: 0 errors. npm run build: ok. git diff --check: clean (LF/CRLF warnings only).
- Payout engine: api/internal/payout-cycle.ts untouched; server/payouts/http.ts diff is session-401/503 mapping only.

## Next action

- Owner reviews diff, deploys manually (no auto-deploy), then verifies live without consuming a new attempt: existing STARTED run recovers via wallet signature -> same runId active 200; Treasure Bank + YOUR MONTH refetch to EMPTY/READY after recovery; payout-cycle cron still once-daily.
