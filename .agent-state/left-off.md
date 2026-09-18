# NimHunt - Left Off

> Updated: 2026-09-18 (production gameplay/UX cleanup slice completed; no mechanics/economics/architecture changes)

## Current Objective

Production gameplay/UX cleanup only: hide dev surfaces, tighten mission copy,
polish HUD, clarify treasure-reserved + daily-batch messaging, soften error
states, fix mobile overlap risks, verify landing CTA logic, add a manual
fresh-user checklist. No new gameplay systems, no reward/payout/risk changes.

## Completed (this slice)

- **Mission copy** (`game/domain/mission.ts`, `data/play.ts`, `data/marketing.ts`):
  Gem "Collect 6 gems and survive.", Chest "Open 4 chests and survive.",
  Vault "Find the key. Unlock the gate. Reach the vault." Fixed landing
  preview stale "12 gems" → "6 gems".
- **Dev surfaces**: MissionBrief dead "Vault coming next" block + "— daily
  status" removed; MissionCard stale disabled title neutralized; Heroes tab
  "SAMPLE RANKING · NOT LIVE" → "HALL OF HEROES · PREVIEW"; footer "shell
  preview" dropped; ProgressStrip "not redeemable in current build" replaced;
  HuntStatus badges "LOADING"/"TREASURE COUNT UNAVAILABLE"/"LIVE · SERVER" →
  "CHECKING"/"UNAVAILABLE"/"LIVE". Dev views stay behind `?dev=` query paths.
- **HUD** (`ExpeditionView.tsx`, `hudStatusView.ts` new, CSS): added Goblin
  status badge (Patrol/Close!/Stunned/Defeated, `data-testid="goblin"`);
  boulder warning/crush notices render emphasized via `isWarningNotice`;
  ≤380px wrap fix so HP/objective/key/sword/goblin/notice never overlap.
- **Boulder warning copy** (`AngkorDevScene.ts`, presentation only, no
  mechanics): trigger sets "The ruins tremble — get clear of the marked
  stone!" surfacing in the HUD notice + existing 3-2-1-! canvas countdown.
- **Reward messaging** (`productPayoutStatus.ts`, `productCheckpoint.ts`,
  `ProductRewardClaimOutcome.tsx`): every reserved state now reads "Your
  reward is secured." + "Daily rewards are paid in the next payout batch."
  ALREADY_REWARDED renders explanatory detail (was empty lines); SOLD_OUT
  adds keep-playing note; PROOF_LOST/VERIFY_REJECTED add "Starting a new
  expedition is safe."; verify-rejected no longer cites "server record".
- **Error states**: PlayShell wallet strip now covers UNAVAILABLE/IDLE ("Open
  this hunt inside Nimiq Pay…") and CANCELLED ("Retry is safe.");
  ProductStartPanel adds retry-safe notes (blueprint/proof unavailable) and
  limit-reached practice hint; raw `errorCode` reference line removed;
  gate MALFORMED copy softened to "could not be loaded."
- **Landing**: verified unchanged logic — `detectNimiqPayHost()` (injected
  `nimiqPay`/`nimiq`, no UA sniffing) → "Enter today's hunt" in-app,
  "Hunt in Nimiq Pay" outside. Explore/Survive/Seal + 3-expeditions copy
  already correct.
- **Checklist**: `docs/manual-production-ux-checklist.md` (12 steps, manual
  only, no product system added).
- **Tests**: new `productionUxCopy.test.ts` (objectives, batch language,
  no-Luna/SQL/enums, already-rewarded, goblin/warning helpers); updated
  `productPayoutStatus`, `huntStatusView`, `productCheckpoint`,
  `useProductStart.integration` expectations.

## Changed paths (this slice only; prior-slice uncommitted work preserved)

- `src/game/domain/mission.ts`, `src/data/play.ts`, `src/data/marketing.ts`
- `src/components/play/productPayoutStatus.ts`, `productCheckpoint.ts`
- `src/components/play/ProductRewardClaimOutcome.tsx`, `ProductExpeditionGate.tsx`
- `src/components/play/ProductStartPanel.tsx`, `PlayShell.tsx`, `ProgressStrip.tsx`
- `src/components/play/MissionBrief.tsx`, `MissionCard.tsx`
- `src/components/play/ExpeditionView.tsx`, `ExpeditionView.module.css`
- `src/components/play/PlayShell.module.css`, `huntStatusView.ts`
- `src/components/play/hudStatusView.ts` (new), `productionUxCopy.test.ts` (new)
- `src/game/scenes/AngkorDevScene.ts` (1-line warning notice only)
- `docs/manual-production-ux-checklist.md` (new)
- Test expectation updates: `huntStatusView`, `productPayoutStatus`,
  `productCheckpoint`, `useProductStart.integration`

## Verification results

- `npm test`: 87 files (82 passed, 5 integration skipped), 661 passed, 0 failed.
- `npm run lint`: 0 errors.
- `npm run typecheck:server`: 0 errors.
- `npx tsc -b --force`: 0 errors.
- `npm run build`: ✓ built in 2.09s (pre-existing chunk-size warning only).
- `git diff --check`: 0 whitespace errors.

## Next action

- Owner runs `docs/manual-production-ux-checklist.md` on a real phone inside
  Nimiq Pay (fresh wallet → expedition → verify → claim → reserved → reopen
  → second expedition → already-rewarded → vault seal → failure/retry).
