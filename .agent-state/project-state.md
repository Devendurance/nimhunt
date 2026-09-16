# NimHunt — Project State

> **Last updated**: 2026-09-16
> **Phase**: Live end-to-end NIM reward flow verified. Cleanup + checkpoint.
> **Latest milestone**: Full live E2E on real Nimiq Pay + live Supabase/Postgres + Nimiq mainnet. Temporary recovery diagnostic banner is now DEV-only behind `?recoveryDiag=1`. No new NIM sent.

## Verified Product Proof

| Capability | Status |
|------------|--------|
| Live Supabase/Postgres proof backend | ✅ PASS |
| Real-device Postgres Gem/Chest/Vault + seal | ✅ PASS |
| Signed `NIMHUNT_REWARD_CLAIM_V1` | ✅ PASS |
| Real Postgres 69-slot races | ✅ PASS |
| Live `001`–`007` raw SQL migrations | ✅ applied |
| Live Supabase claim flow | ✅ PASS |
| Real-device `TREASURE RESERVED` | ✅ PASS |
| Payout accounting / isolation / double-pay protection | ✅ PASS |
| Mainnet NIM payout broadcast | ✅ CONFIRMED |
| Payout status read model | ✅ PASS |
| `/play` wallet bootstrap (no attempt consume) | ✅ PASS |
| Signed `NIMHUNT_RECOVER_SESSION_V1` recovery session | ✅ PASS |
| Real-device payout recovery | ✅ PASS |
| TREASURE DELIVERED after full Nimiq Pay restart | ✅ PASS |
| Full live E2E flow | ✅ PASS |
| Treasury sweep utility | ✅ preview-only implemented |
| Treasury sweep broadcast | ❌ NOT AUTHORIZED |
| Production reward amount | ⏳ UNDECIDED |
| Payout automation | ❌ NOT ENABLED |
| Anti-bot / Sybil | ⏳ PENDING PRODUCTION GATE |

## Next Milestone

Cleanup/checkpoint complete. Remaining production-readiness work only: production reward amount, treasury funding policy, anti-bot/Sybil, payout automation strategy, launch/UX/gameplay polish. Do not send NIM. Do not start bulk or automatic payouts. Do not change the production reward amount.

## Canonical References

- [`docs/prd.md`](../docs/prd.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/projectplan.md`](../docs/projectplan.md)
- [`DESIGN.md`](../DESIGN.md)
