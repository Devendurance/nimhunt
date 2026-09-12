# NimHunt - Left Off

> Updated: 2026-09-12

## Current Objective

STOP before Vault product seal. Request one final real-phone Gem Runner verification of the post-verify result screen.

## Completed

- Identified post-verify UX bug: `/verify` persists `COMPLETED` / `VERIFIED_ELIGIBLE`; ProductExpeditionGate then re-resolved `/active` for the same URL. `/active` correctly rejects COMPLETED/already-started runs, so the verified screen was replaced with "This expedition is no longer ready to enter."
- `/active` semantics unchanged.
- Successful verify is a terminal client session. Same-tab remount keeps the trusted `/verify` result without `/active` or Phaser remount. Deliberate Back to missions / Return to Hunt navigates to `/play` and clears the remembered terminal. Fresh reload/direct visit of the completed URL still fail-closes.

## Changed Paths

- `src/components/play/productRunSession.ts`
- `src/components/play/productRunSession.test.ts`
- `src/components/play/ExpeditionVerifiedPanel.tsx`
- `src/components/play/productCheckpoint.ts`
- `src/components/play/productCheckpoint.test.ts`
- `src/components/play/ProductExpeditionGate.tsx`
- `src/components/play/ExpeditionView.tsx`
- `src/components/play/useProductStart.integration.test.ts`
- `src/routes/PlayPage.tsx`

## Verification

- Targeted product verify/navigation tests: PASS
- `npm test`: 379 passed, 1 skipped
- `npm run lint`: PASS
- `npx tsc -b --force`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS (CRLF warnings only)

## Blockers / Gates

- Vault still needs future run-bound `NIMHUNT_VAULT_SEAL_V1`. Do not reuse the preview seal.
- Postgres proof adapter still pending.

## Next Session

1. Real-phone Gem Runner: signed Start → checkpoints → 6 gems alive → `/verify` → `Expedition verified` MUST STAY until Back to missions / Return to Hunt.
2. Confirm Back to missions lands on `/play` with correct remaining attempts.
3. Do not implement claims, reservation, NIM transfer, payout, or product Vault seal until explicitly requested.
