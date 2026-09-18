# NimHunt — Manual Fresh-User Production UX Checklist

> Scope: production gameplay / UX cleanup slice. No new mechanics, no reward-economics
> changes, no payout-architecture changes. Run inside Nimiq Pay on a narrow phone
> viewport (portrait, ~360px wide) with safe-area behavior.

## Setup

- [ ] Open the production build inside Nimiq Pay (injected host, not UA sniffing).
- [ ] Confirm landing CTA reads **"Enter today's hunt"** inside Nimiq Pay.
- [ ] Open the same build outside Nimiq Pay and confirm CTA reads **"Hunt in Nimiq Pay"**.
- [ ] Confirm no DEVELOPMENT labels, debug coordinates, blueprint internals, reset
      controls, or "milestone only" copy are visible without an explicit dev query.

## 1. Fresh wallet bootstrap

- [ ] Landing → hunt opens `/play` with no wallet remembered.
- [ ] Wallet strip prompts to open inside Nimiq Pay / connect (no blank strip).
- [ ] Account picker (if several accounts) shortens addresses and connects.

## 2. Start expedition

- [ ] Mission brief shows the short objective:
      Gem Runner "Collect 6 gems and survive." /
      Chest Hunter "Open 4 chests and survive." /
      Vault Breaker "Find the key. Unlock the gate. Reach the vault."
- [ ] Brief shows 100 starting HP, 3 expeditions daily, Angkor Ruins.
- [ ] Authorize → expedition opens; cancelling explains no expedition was used
      and retry is safe.

## 3. Complete Gem Runner

- [ ] HUD shows HP bar, `6 / 6`-style progress, key/sword state, goblin status.
- [ ] No overlapping labels at 320–360px widths.
- [ ] Mission complete → "Verifying expedition…" (no raw enums visible).

## 4. Verification

- [ ] Verified state shows "Expedition verified" + mission summary.
- [ ] Failure states (proof interrupted / not verified) explain what happened
      and that starting a new expedition is safe.

## 5. Claim signing

- [ ] "Claim today's treasure" → Nimiq signing prompt.
- [ ] Cancelling the signature shows "Signature request was cancelled." and
      allows retry (no stuck spinner, no fake success).

## 6. Treasure reserved

- [ ] Success shows **TREASURE RESERVED** + "Your reward is secured."
- [ ] Copy states **"Daily rewards are paid in the next payout batch."**
- [ ] Nothing implies instant NIM transfer (no "sent", "received", "paid out").

## 7. Close / reopen app

- [ ] Reopening `/play` restores wallet + reserved payout card.
- [ ] No duplicate claim CTA for the already-reserved reward.

## 8. Wallet recovery

- [ ] Clear site data / reinstall mini app → wallet re-bootstrap works.
- [ ] Reserved reward still recoverable for the same wallet + day.

## 9. Second expedition

- [ ] Attempts counter decrements (3 → 2 → 1 → 0 expeditions left today).
- [ ] Second mission can start and complete normally.

## 10. Already-rewarded messaging

- [ ] Completing another mission after reserving shows
      "TODAY'S REWARD ALREADY RESERVED" + "You can keep playing your
      remaining expeditions — nothing is broken."
- [ ] Player is never left thinking the game is broken.

## 11. Vault seal

- [ ] Vault Breaker: find key → unlock gate → reach vault reads clearly.
- [ ] Triggering the marked stone shows "The ruins tremble — get clear of
      the marked stone!" with the 3-2-1-! countdown, visible but not intrusive.
- [ ] Standing under the stone when it falls ends the run (crush message).
- [ ] Reaching the vault → "Seal treasure" → Nimiq signing → sealed proof
      → claim flow joins the standard reserved path.

## 12. Failure + retry behavior

- [ ] Death / failed run shows "EXPEDITION FAILED" + summary + back-to-missions.
- [ ] Attempt limit reached: "You've used today's 3 reward-eligible
      expeditions." + practice-run option.
- [ ] Network offline during start/claim: plain-language error, retry is safe,
      no sensitive internals (no Luna units, SQL, worker status, enums).
- [ ] Sold out (all 69 slots): "TODAY'S TREASURE IS FULL" + keep-playing note.

## Sign-off

- [ ] `npm test`, `npm run lint`, `npm run typecheck:server`,
      `npx tsc -b --force`, `npm run build`, `git diff --check` all pass.
