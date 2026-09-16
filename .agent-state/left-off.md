# NimHunt - Left Off

> Updated: 2026-09-16

## Current Objective

Cleanup + checkpoint + documentation after verified live E2E. Do not send NIM. Do not start payout automation. Do not implement anti-bot/Sybil in this slice.

## Completed

- Temporary phone recovery diagnostic banner removed from default `/play` UI.
- Banner kept only behind explicit local-dev query `?recoveryDiag=1` and is impossible in production builds (`PROD` / `MODE=production` / non-DEV).
- Underlying recovery diagnostic helpers/tests retained.
- `docs/architecture.md` records live raw SQL migrations 001–007, verified E2E flow, and security invariants.
- Agent memory/status updated: FULL LIVE E2E / MAINNET PAYOUT / REAL DEVICE PAYOUT RECOVERY = PASS. Production reward amount undecided. Payout automation not enabled.

## Remaining

Production-readiness only:

1. Production reward amount
2. Treasury funding policy
3. Anti-bot / Sybil controls
4. Payout automation strategy
5. Launch / UX / gameplay polish

## Next Session

Do not send NIM. Do not run payout worker or treasury sweep. Do not merge recovery auth with Start auth.
