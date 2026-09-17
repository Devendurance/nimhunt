# NimHunt — Project State

> **Last updated**: 2026-09-17 (scheduler Vercel-compat slice: local green, push pending)
> **Phase**: Scheduler route Vercel serverless-compatible (.js imports, typecheck:server, validated cycle-result). Automation and production cron disabled.
> **Latest milestone**: Canonical CRON_SECRET refactor + local disabled-cycle proof. No new NIM sent. Production deploy + native cron invocation pending owner/Vercel action.

## Verified Product Proof

| Capability | Status |
|------------|--------|
| Live Supabase/Postgres proof backend | ✅ PASS |
| Real-device Postgres Gem/Chest/Vault + seal | ✅ PASS |
| Signed `NIMHUNT_REWARD_CLAIM_V1` | ✅ PASS |
| Real Postgres 69-slot races | ✅ PASS |
| Live `001`–`010` raw SQL migrations | ✅ applied |
| `010_payout_execution_day.sql` | ✅ live (column + spend RPC + backfill) |
| Mainnet NIM payout broadcast | ✅ CONFIRMED (authorized 100 NIM beta + historical 0.1 NIM, untouched this slice) |
| Beta reward amount | ✅ 100 NIM = 10,000,000 Luna |
| Reservation slots | ✅ 69 / reservation `day_key` |
| Treasury execution cap | ✅ 690,000,000 Luna / execution `execution_day_key` |
| Payout automation | ❌ DISABLED (env + DB kill switch OFF, verified live 2026-09-17) |
| Scheduled payout route | ✅ CRON_SECRET-canonical, unit/auth/overlap re-validated locally 2026-09-17 (616 tests); production deploy PENDING (no Vercel CLI/credentials in sandbox) |
| Scheduler operations migration `011` | ✅ live (verified read-only; not replayed) |
| Vercel Cron auth | ✅ compatible via native `CRON_SECRET` Bearer (previous Bearer-impossible conclusion corrected) |
| Production cron (`vercel.json`) | ❌ NOT CREATED (deliberate; creation+deploy would immediately activate schedule) |

## Next Milestone

Owner deploys `/api/internal/payout-cycle` via Vercel with `NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=false`, DB OFF, `CRON_SECRET` set (sandbox has no Vercel CLI/token/linkage); test deployed auth matrix; then (only on approval) create `vercel.json` cron and observe one native DISABLED invocation. Do not send NIM, fund treasury, or change reward/cap. vercel.json still NOT created (correct — gated on deployed-route auth PASS).

## Canonical References

- [`docs/prd.md`](../docs/prd.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/projectplan.md`](../docs/projectplan.md)
- [`DESIGN.md`](../DESIGN.md)
