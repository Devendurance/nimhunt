# Nimiq Treasure Hunt — Cycle 2 Project Plan

## 1. Deadline

Cycle II runs from **August 24 to September 18, 2026**.

Treat **September 18, 2026** as the internal hard ship day.

The small amount of WAT spillover after the UTC deadline is emergency buffer, not planned development time.

## 2. Planning principle

The build order is intentionally front-loaded with the fun/easy visual work:

**mascots → marketing landing page → Mini App shell → game loop → task/reward backend → Nimiq sealing → polish**

That gives us visible momentum immediately and a brand system the game can reuse.

But the landing page is timeboxed. The Nimiq Pay reality spike must still happen by **September 8** because wallet/signature/reward integration is the biggest unknown.

The core product loop is now:

**receive task → explore → collect gems/treasure → survive → complete task → seal eligible NIM reward → update stats/leaderboards**

## 3. P0 — Freeze the product rules

### Lock now
- Angkor Ruins is World 01.
- Bavaria and Siberia are locked teasers.
- 3 free expeditions/day.
- 69 daily NIM reward slots.
- Recommended: max 1 real NIM reward per wallet/day; later runs still count for progression/leaderboards.
- NIM reward amount configurable.
- Every expedition begins with a visible deterministic task.
- Prefer a shared Daily Expedition Board so players face comparable Run 1/2/3 missions.
- Real NIM is earned by task completion, never random chest luck.
- Gems can appear on-map and inside chests.
- Gems are **not redeemable or transferable in Cycle 2**.
- Gems contribute to task progress, points and stats.
- One Goblin for gameplay.
- Golem can be marketing/future-world art only.
- One boulder mechanic.
- One key + gate.
- 100 HP.
- Touch D-pad.
- Nimiq signature = “seal treasure”.
- Leaderboards are server-authoritative.
- Monthly Heroes are recognition/PR, not an additional NIM prize.

### Initial task set
Keep this small:
1. **Gem Runner** — collect target gems and finish alive.
2. **Vault Breaker** — reach/seal Temple Vault.
3. **Chest Hunter** — open target chests and finish alive.
4. **Relic Keeper** — recover required relic and finish alive.
5. **Survivor** — finish with stated survival constraint.

We do not need all five in the first playable build. Two or three polished task templates are enough for submission.

## 4. P1 — Mascot and visual system first

### Goal
Create the reusable cast before laying out the website or game UI.

### Create
- Explorer hero design,
- Goblin rival design,
- Golem guardian design,
- NIM Treasure Coin design,
- gem/relic visual language,
- Angkor environment mood board,
- basic color palette,
- display/body typography direction,
- icon/HUD style.

### Required mascot poses

**Explorer**
- neutral/hero,
- running,
- treasure-found reaction,
- hurt/failure reaction.

**Goblin**
- sneaking,
- reaching for treasure,
- running away with loot,
- defeated/stunned reaction.

**Golem**
- one strong guardian/teaser pose only.

**NIM Treasure Coin**
- hero object,
- chest burst,
- small HUD/counter form.

### Gate
The cast must feel original and consistent enough that the landing page can be designed around it without inventing a new style per section.

## 5. P2 — Marketing landing page

### Goal
Ship the easiest visible surface first and create the project's marketing funnel.

### Sections
1. Hero — Explorer vs Goblin reaching for glowing NIM treasure.
2. Live Hunt strip — `X / 69` remaining + reset timer placeholder/live adapter.
3. How It Works — **Get a Task → Survive the Ruins → Seal the Treasure**.
4. Expedition Tasks — Gem Runner / Vault Breaker / Chest Hunter previews.
5. Angkor Ruins showcase.
6. Locked Bavaria + Siberia cards.
7. Mascot cast.
8. Leaderboards preview.
9. Hall of Heroes / Monthly Heroes section.
10. Nimiq proof/receipt section.
11. Final **Hunt in Nimiq Pay** CTA + deeplink/QR.

### Important
The public landing page does **not** pretend the prize game runs in a normal browser.

Outside Nimiq Pay:
- explain,
- market,
- show live/public stats,
- deeplink users into Nimiq Pay.

### Gate
Responsive landing page works on desktop and mobile and the visual system is reusable by `/play`.

## 6. P3 — Mini App shell + Nimiq reality spike

### Goal
Prove the environment before heavy gameplay work.

### Tasks
- create/confirm public GitHub repo,
- MIT license,
- Vite + React + TypeScript,
- add `/` marketing and `/play` Mini App routes,
- install `@nimiq/mini-app-sdk`,
- detect Nimiq Pay environment,
- load local Mini App on the testing phone,
- request Nimiq account on deliberate action,
- sign a canonical test claim,
- handle cancellation/error states,
- prove server-side signature verification,
- prove testnet reward transaction path,
- build Hunt Home shell,
- build World Select,
- build Expedition Task briefing card,
- build HUD placeholders for HP, gems, task progress and runs.

### Gate
**GO only if a real account + sign flow works inside Nimiq Pay and the app shell is stable on mobile.**

## 7. P4 — Core Angkor game + tasks

### Goal
A complete game without real rewards.

### Tasks
- grid/tile model,
- D-pad movement,
- collisions,
- HP/death,
- visible gems,
- chest open interaction,
- gem/treasure contents,
- one hazard,
- boulder push,
- key/gate,
- Goblin patrol/collision,
- potion,
- blade,
- task progress HUD,
- task completion state,
- Temple Vault/reward checkpoint.

### First task templates to implement
Prioritize:
1. Gem Runner.
2. Vault Breaker.
3. Chest Hunter if time remains.

### Critical fairness rule
Gem Runner maps/runs must guarantee enough reachable gems to hit the target without needing lucky chest contents.

### Gate
A tester can complete the supported task types on a phone with no dead ends or ambiguous win condition.

## 8. P5 — Server-authoritative expeditions, stats and leaderboards

### Goal
Move all prize/competition-sensitive state out of the browser.

### Tasks
- daily hunt state,
- expedition issuance,
- task definition/version issuance,
- 3-run daily enforcement,
- task checkpoint validation,
- gems/points/chests stats,
- active gameplay time,
- daily streak calculation,
- meaningful-failure qualification,
- leaderboard aggregation,
- opt-in Hero Name profile,
- claim reservation,
- atomic reward-slot reservation/finalization,
- duplicate/replay protection.

### Leaderboards
- Most Active Expedition Time,
- Most Points,
- Highest Streak,
- Most NIM Collected,
- Most Chests Opened,
- Most Expeditions Failed.

### Anti-gaming
- pause/background/idle time does not count as active play,
- instant spawn deaths do not count as meaningful failures,
- all public scores derive from valid server-recognized runs.

### Gate
Refreshing/devtools/client edits cannot trivially create stats, extra runs or reward eligibility.

## 9. P6 — Real treasure sealing + reward payout

### Goal
Make Nimiq the signature product moment.

### Tasks
- task completion → reward availability check,
- short claim reservation,
- Goblin steal/countdown state,
- canonical claim payload includes task completion,
- Nimiq Pay signing prompt,
- backend signature verification,
- replay protection,
- isolated reward service,
- secure secret storage,
- fixed server-controlled reward amount,
- transaction states,
- receipt,
- balance/reward animation only after the correct state transition.

### Failure paths
Test:
- user cancels,
- claim expires,
- network disappears,
- last reward slot race,
- duplicate signature,
- payout pending,
- payout failure.

### Gate
Repeated testnet runs behave correctly across success and failure before mainnet funds are used.

## 10. P7 — Game feel + leaderboard/hero polish

### Game polish
- Explorer walk/hit/death,
- Goblin motion,
- Angkor tile pass,
- chest open animation,
- gem collection animation,
- relic/treasure pickup,
- NIM chest/reward burst,
- sound effects,
- mute,
- loading/transitions,
- subtle haptics if reliable.

### Social polish
- leaderboard screen,
- rank movement treatment,
- Hero Name setup,
- Hall of Heroes on landing page,
- Monthly Hero share-card template.

## 11. P8 — Localization + beta + submission hardening

### Localization
Centralize strings first.

Add as stability permits:
- English,
- German,
- Spanish,
- French,
- Portuguese.

### Real-user beta
Test:
- different screen sizes,
- first-run understanding,
- task comprehension,
- controls,
- app background/foreground,
- wallet cancellation,
- weak internet,
- expired reservation,
- final reward slot race,
- daily reset,
- leaderboard updates,
- device/account switching.

### Repo/submission
- public repo,
- MIT license,
- README,
- setup instructions,
- env example without secrets,
- architecture docs,
- screenshots,
- Nimiq integration explanation,
- demo video,
- submission copy,
- promotion assets.

## 12. Suggested calendar

### September 7
- lock updated docs,
- design Explorer, Goblin, Golem and NIM Treasure Coin,
- define core palette/visual system,
- start landing hero + structure.

### September 8
- finish responsive landing page shell,
- add task/leaderboard/Hall of Heroes sections,
- create `/play` shell,
- load locally in Nimiq Pay,
- account + signing reality spike.

### September 9
- server-side signature verification spike,
- testnet reward path spike,
- Hunt Home + World Select + Task Brief,
- grid movement + D-pad.

### September 10
- gems,
- chests,
- HP/hazards,
- task progress,
- Gem Runner.

### September 11
- boulder,
- key/gate,
- Goblin,
- Vault Breaker,
- complete Angkor 5–7 room run.

### September 12
- expedition backend,
- task issuance/validation,
- points/gems/chest stats,
- active-time logic,
- daily runs.

### September 13
- streaks,
- leaderboards,
- meaningful failures,
- Hero Name profile,
- claim reservation/replay protection.

### September 14
- Nimiq claim signing,
- backend verification,
- testnet payout,
- receipt/failure states.

### September 15
- reward animations,
- leaderboard UI,
- landing live state/Hall of Heroes,
- sound/art polish.

### September 16
- community feedback / real-user beta,
- mobile/WebView bug fixes,
- localization only if stable.

### September 17
- production/mainnet hardening,
- README,
- demo capture,
- submission copy,
- no new big features.

### September 18
- final regression,
- submit,
- promote,
- bug fixes only.

## 13. Ruthless cut order

If behind schedule, cut in this order:

1. Guardian quiz.
2. Monthly Hero automation — keep static/manual Hall of Heroes placeholder.
3. Realtime leaderboard updates — refresh/poll instead.
4. Chest Hunter/Relic Keeper/Survivor tasks — keep Gem Runner + Vault Breaker.
5. EVM implementation beyond adapter skeleton.
6. Non-English localization beyond the strongest finished translations.
7. Golem animation/gameplay.
8. Fancy leaderboard rank-change animations.
9. Extra chest loot types.
10. Sound/music complexity.

Never cut:
- Nimiq Pay integration,
- one clear deterministic task,
- gems/task progress,
- one complete Angkor run,
- server-side reward eligibility,
- correct claim verification,
- safe payout logic,
- mobile controls,
- honest error handling.

## 14. What you need right now

### First creative deliverables
Before coding the game:
- Explorer design,
- Goblin design,
- Golem teaser design,
- NIM Treasure Coin,
- gem/relic visual,
- Angkor key art/background direction,
- logo/working wordmark direction if desired.

### First build deliverable
A responsive marketing landing page using those assets.

### Then immediately
The `/play` Mini App shell and Nimiq Pay account/sign reality spike.

### Accounts / access
- Nimiq Pay installed on testing phone,
- Nimiq testnet access enabled,
- GitHub repo,
- deployment account,
- backend/database project,
- secure environment-secret storage.

### Product decisions still needed soon
- final NIM amount per successful reward,
- daily treasury budget,
- confirm max NIM reward claims per wallet/day (current recommendation: 1),
- exact daily reset timezone,
- whether 69 reward slots are continuous or released in windows,
- monthly leaderboard reset boundary,
- whether one player can appear as Monthly Hero in several categories (current recommendation: yes).

## 15. Definition of done

Done means a real user can:
- discover the project from the landing page,
- open it inside Nimiq Pay,
- receive a clear expedition task,
- explore Angkor,
- collect gems/treasure,
- survive hazards,
- complete the task,
- seal an eligible NIM reward,
- see correct payout state,
- accumulate points/stats,
- appear correctly on leaderboards,
- understand why they should return tomorrow.

The landing page makes them curious.  
The game makes them care.  
The daily task, scarcity and leaderboard make them come back.
