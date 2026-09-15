# NimHunt - Left Off

> Updated: 2026-09-15

## Current Objective

Implement signed reward claim + atomic 69-slot reservation.
Do not implement NIM transfer, treasury, payout, or payout worker.

## Completed

- Live Supabase/Postgres proof backend.
- Real-device Postgres Gem Runner, Chest Hunter, and Vault Breaker + `NIMHUNT_VAULT_SEAL_V1`.
- Attempt accounting: 3 expeditions/day, consumed at Start.
- Daily reward pool exists: 69 slots/day.
- One reward reservation max per wallet/day.
- Dev attempt reset does not touch `rewards_reserved` or proof history.
- No payout exists yet.

## Next Session

1. Checkpoint commit for completed Postgres/device work.
2. Signed `NIMHUNT_REWARD_CLAIM_V1` prepare/finalize.
3. Atomic 69-slot reservation RPC + live/device validation.
