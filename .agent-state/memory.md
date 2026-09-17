# NimHunt - Durable Memory

> Last reviewed: 2026-09-17

This file stores decisions and lessons that should survive future sessions. It is not a replacement for the canonical product or architecture documents.

## Verified live status

FULL LIVE E2E:
PASS

MAINNET PAYOUT:
PASS (historical 10,000 Luna + authorized beta 10,000,000 Luna)

PAYOUT AUTOMATION:
IMPLEMENTED, DISABLED

BETA REWARD AMOUNT:
100 NIM = 10,000,000 Luna

LIVE 010:
PASS

## Automatic payout pipeline

- Automatic execution requires ALL of: `NIMHUNT_PAYOUT_NETWORK=mainnet`, `NIMHUNT_ENABLE_MAINNET_PAYOUT=true`, `NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=true`, and DB `payout_automation_control.automatic_payouts_enabled` (default OFF).
- `reward_payouts.day_key` is reservation UTC day (69-slot economics). Do not treat it as treasury spend day.
- `reward_payouts.execution_day_key` is the UTC day a payout is committed for execution (set on acquire). Daily treasury cap uses this field.
- Committed execution spend: PROCESSING + SUBMITTED + CONFIRMED + FAILED_FINAL with tx_hash. PENDING is not spent.
- `010_payout_execution_day.sql` is applied live. This environment has no DDL path (`DATABASE_URL` / `SUPABASE_ACCESS_TOKEN` absent); live objects were already present and were not replayed.
- Historical 0.1 NIM `d19bf406-2b81-4c5a-b271-da8eb7587cbd`: reservation 2026-09-16 / execution 2026-09-16 / CONFIRMED 10,000 Luna / tx `c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6`.
- Authorized beta 100 NIM `14d204b5-5ced-477b-b626-05cfdbe29e1c`: reservation 2026-09-16 / execution 2026-09-17 / CONFIRMED 10,000,000 Luna / tx `f93d6a1e169182f0b3400daa70e3f9557d11dda1bdfb975541c5747f0d05f4fd`.
- Live 2026-09-17 execution committed = 10,000,000 Luna. Remaining under 690,000,000 = 680,000,000 Luna.
- Two live disabled scheduler cycles ran 2026-09-17 (same runPayoutWorker path, both switches OFF): DISABLED, signed 0, broadcast 0, rows stayed 2, last_cycle_result=DISABLED recorded. No NIM sent.
- CORRECTION 2026-09-17: Vercel Cron DOES send `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set. Previous "cannot attach Bearer" conclusion was wrong. Canonical production secret is now CRON_SECRET; NIMHUNT_PAYOUT_CRON_SECRET is a local/dev alias only (CRON_SECRET wins). VITE_CRON_SECRET / VITE_NIMHUNT_PAYOUT_CRON_SECRET fail closed. No production deployment exists yet; vercel.json deliberately NOT created (creation+deploy would immediately start the 10-min schedule).

## Scheduled payout orchestration

- Scheduler architecture is a protected HTTP trigger at `/api/internal/payout-cycle`; it invokes the existing `runPayoutWorker` and does not create a second payout engine or resident worker.
- The route accepts Vercel-compatible GET and operator/test POST, requires `Authorization: Bearer` with server-only `CRON_SECRET` (canonical) or local alias `NIMHUNT_PAYOUT_CRON_SECRET`, ignores request bodies, and rejects query overrides. Constant-time sha256+timingSafeEqual preserved; cookies irrelevant.
- `NIMHUNT_PAYOUT_MAX_PER_CYCLE` is server-only, defaults to 5, and is bounded to 1-69. Both existing automation kill switches remain authoritative.
- `011_payout_scheduler_operations.sql` is LIVE (verified 2026-09-17 read-only: last_cycle_* columns present, get_payout_operations_status + record_payout_cycle_result reachable via service role, malformed record rejected, acquire returns AUTOMATION_DISABLED). Never replayed 001-010.
- DEPLOY READINESS 2026-09-17: api/internal/payout-cycle.ts present (existing route only), vercel.json absent (correct, creation gated on deployed-route auth PASS), local env NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=false, scheduler source=CRON_SECRET maxPerCycle=5, no VITE_* secret in client bundle (dist scan 0 hits), npm test 605 pass / lint 0 / tsc 0 / build ok / git diff --check 0. Sandbox has no Vercel CLI, no .vercel linkage, no Vercel token — production deploy + native cron observation require owner action. payout:status live re-query timed out in sandbox (network); last live verified state 2026-09-17 stands (env OFF, DB OFF, PENDING/PROCESSING/SUBMITTED 0, execution-day committed 10,000,000 Luna, remaining 680,000,000, lastCycle DISABLED).
- Overlap tests use a mocked treasury only. Docker scheduled-cycle overlap preserves the claim uniqueness, one send, reserve, and execution-day cap.

## Canonical Sources

- [`docs/prd.md`](../docs/prd.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/projectplan.md`](../docs/projectplan.md)
- [`DESIGN.md`](../DESIGN.md)
