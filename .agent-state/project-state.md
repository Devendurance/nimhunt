# NimHunt — Project State

> **Last updated**: 2026-09-18 (production UX cleanup slice verified locally: 661 tests / lint / typechecks / build green; manual phone checklist pending)
> **Phase**: Disabled daily Vercel cron configured (once/day 14:00 UTC). Automation stays OFF. No NIM sent.
> **Latest milestone**: `vercel.json` daily cron committed (6934c0b) + pushed to main; production live (root 200, route 401 no-auth). Cron dashboard registration + first native DISABLED invocation pending (next window 14:00 UTC today).

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
| Production cron (`vercel.json`) | ✅ CREATED+HOBBY-DAILY (single entry `/api/internal/payout-cycle` @ `0 14 * * *`, no secret; commit 6934c0b pushed; dashboard registration + native invocation PENDING) |
| Daily Mission Difficulty (Angkor v2) | ✅ PASS (9 canonical variants, FNV-1a selector, multi-goblin patrol/combat, BFS verified solvable ≤256 actions, v1 backward compatible) |
| Timed Collapsing Boulder (Angkor v2) | ✅ PASS (ARMED/WARNING/FALLEN, authoritative TICK action stream @ 750ms / 3.0s warning, stand-still collapse, instant crush death, path blocking, goblin avoidance, push boulder preserved, 100% deterministic replay) |
| Collapsing Boulder Server Timing Authority | ✅ PASS (server-owned warningStartedAt/collapseDeadlineAt anchor, instant crush death at deadline, movement into impact cell blocked at/after deadline, tick withholding fails closed, immediate client flush on trigger, v1 backward compatible) |

## Next Milestone

Owner confirms in Vercel dashboard: production deployment of 6934c0b is READY, Cron Job `/api/internal/payout-cycle` registered once-daily; then observe first native DISABLED invocation (~14:00 UTC 2026-09-17, expect 200 DISABLED signed 0 broadcast 0). Do not enable switches, send NIM, fund treasury, or change reward/cap. (Sandbox has no Vercel CLI/token/linkage — dashboard + logs verification is owner-side.)

## Canonical References

- [`docs/prd.md`](../docs/prd.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/projectplan.md`](../docs/projectplan.md)
- [`DESIGN.md`](../DESIGN.md)
