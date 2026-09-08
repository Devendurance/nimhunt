# Nimiq Treasure Hunt — Product Requirements Document

## 1. Product summary

Nimiq Treasure Hunt is a mobile daily adventure Mini App inside Nimiq Pay.

Players get a limited number of daily expeditions through an original Angkor-inspired ruin. Each expedition begins with a visible task: collect a target number of gems and survive, reach and seal the Temple Vault, open a target number of chests, recover a relic, or complete another deterministic skill objective.

The first eligible players who complete their assigned task while one of the day's 69 NIM reward slots remains can seal a cryptographic claim through Nimiq Pay and receive the configured NIM reward. Gems and treasure remain non-cash progression items in Cycle 2.

## 2. Problem / opportunity

Wallet apps are usually transactional.

They give people reasons to open them when they need to send, receive, swap or inspect money—but fewer reasons to return for entertainment.

The Mini Apps environment creates an opportunity to make Nimiq Pay itself somewhere users can *do* things.

Treasure Hunt aims to create a tiny daily ritual:
- open Nimiq Pay,
- enter the ruins,
- chase a scarce objective,
- interact with NIM in a way that feels native to the game.

## 3. Target audience

Primary:
- casual mobile players,
- existing Nimiq Pay users,
- crypto users who like short daily experiences,
- Nimiq community members who can onboard friends.

The game should require essentially no blockchain knowledge.

A user should understand the core promise within seconds:

> Three expeditions.  
> 69 NIM treasures today.  
> Reach the vault before they're gone.

## 4. Product principles

### Game first
The user sees an adventure, not a wallet demo.

### Crypto at meaningful moments
Use Nimiq for identity/signing/reward settlement where it strengthens the game fantasy.

### Skill-based prize eligibility
Real NIM cannot be awarded by primarily random chance.

### One polished world beats three unfinished worlds
Cycle 2 ships Angkor only.

### Failure should make sense
Technical failures get clear explanations, with optional game-fiction flavor layered on top.

### Server decides rewards
Prize state never trusts the client.

### Every run has a purpose
The player sees the expedition task before play starts. A run should never feel like aimless wandering.

## 5. Competition alignment

The build should intentionally optimize for the Cycle 2 scoring categories:

- Functionality, reliability and usefulness — 45
- Nimiq Pay and Nimiq integration — 25
- Real usage — 15
- Design and UX — 10
- Builder promotion — 5

The official rules also require:
- a functional Mini App,
- public GitHub repo,
- MIT license,
- NIM or USDT integration,
- no secrets committed,
- original/properly attributed code/content,
- no primarily chance-based gambling/betting prize flow.

## 6. Core user stories

### First-time player
As a first-time player, I want to understand the hunt immediately so I can start without reading documentation.

Acceptance:
- home screen explains 3 daily expeditions,
- shows daily reward count,
- clear Start Expedition CTA,
- controls tutorial takes seconds.

### Explorer
As a player, I want responsive movement and readable obstacles so the game feels fair.

Acceptance:
- touch movement responds quickly,
- invalid moves give immediate feedback,
- hazards are visually distinguishable,
- HP changes are obvious.

### Puzzle solver
As a player, I want to figure out how to reach places I can see.

Acceptance:
- at least one visible-but-blocked goal,
- one boulder interaction,
- one key/gate progression,
- route can be solved without guessing hidden mechanics.

### Mission runner
As a player, I want a clear task at the start of each run so I always know what I am trying to accomplish.

Acceptance:
- task shown before movement,
- task progress visible in HUD,
- success conditions deterministic,
- task never depends on hidden random loot,
- task completion is server-verifiable.

### Gem collector
As a player, I want gems and treasure to matter even when I do not win NIM.

Acceptance:
- gems appear visibly and/or inside chests,
- gem count updates immediately,
- gem missions guarantee enough reachable gems,
- gems contribute to score/progression,
- gems are clearly marked non-redeemable for Cycle 2.

### Vault finder
As a player, I want reaching the vault to feel like an achievement.

Acceptance:
- vault arrival has distinct audiovisual treatment,
- backend confirms eligibility,
- UI accurately reflects remaining reward state.

### Treasure claimant
As an eligible player, I want to seal my treasure through Nimiq Pay.

Acceptance:
- clear claim amount before signing,
- signing request is intentional,
- cancellation is handled,
- signature is server verified,
- duplicate claim cannot succeed.

### Reward recipient
As a winner, I want to know whether my NIM reward actually arrived.

Acceptance:
- payout states are explicit,
- no fake success before confirmation,
- transaction/proof can be inspected,
- UI updates once authoritative confirmation is available.

### Leaderboard competitor
As a player, I want my legitimate play to contribute to public rankings and monthly recognition.

Acceptance:
- server-authoritative stats,
- idle time excluded from active-time leaderboard,
- failed-run leaderboard rejects trivial spawn deaths,
- public Hero Name is opt-in,
- monthly category winners can be surfaced in Hall of Heroes.

### Returning player
As a returning player, I want a reason to come back each day.

Acceptance:
- daily hunt resets,
- expedition allowance refreshes,
- treasure availability refreshes,
- current day state is visible immediately.

## 7. Information architecture

### Public web
- Landing
- How It Works
- Worlds
- Characters
- Live Hunt State
- Leaderboards / Hall of Heroes
- Open in Nimiq Pay

### Mini App
- Hunt Home
- World Select
- Expedition Task Brief
- Angkor Expedition
- Leaderboards
- Pause
- Vault Claim
- Reward Receipt
- Expedition Result
- Optional Guardian Challenge

## 8. Hunt Home requirements

Must show:
- game logo/working title,
- player/wallet state when connected,
- `X / 69` claimed or `Y remaining`,
- daily reset countdown,
- expeditions remaining,
- current gems/points/streak summary,
- leaderboard entry point,
- Play / Start Expedition,
- World selector.

Nice-to-have:
- last reward receipt,
- short recent activity pulse.

## 9. World Select

Cards:
- Angkor Ruins — playable
- Bavaria — locked / coming soon
- Siberia — locked / coming soon

Locked worlds must not create dead navigation.

## 10. Angkor Expedition requirements

### Map
- 5–7 compact rooms,
- original level design,
- tile-based,
- one clear visual theme,
- no huge scrolling open world.

### Player
- 100 starting HP,
- 4-direction movement,
- one visible character sprite.

### Controls
Primary:
- touch D-pad.

Optional after testing:
- swipe.

Do not prioritize keyboard controls over mobile.

### Game objects
Required:
- wall,
- floor,
- boulder,
- key,
- gate,
- one hazard type minimum,
- Goblin,
- potion,
- blade,
- visible gems,
- relic/treasure collectible,
- mystery chest,
- Temple Vault / task completion point.

### Run objective
Complete the assigned Expedition Task alive.

Initial task templates:
- Gem Runner — collect target gems and reach completion point alive,
- Vault Breaker — reach/seal the Temple Vault,
- Chest Hunter — open target number of chests and survive,
- Relic Keeper — recover required relic and finish alive,
- Survivor — complete route with stated HP/survival constraint.

The exact objective and progress must remain visible during the run.

## 11. Enemy requirements

### Goblin
MVP only.

Must:
- be visually readable,
- patrol or move predictably,
- damage player on collision,
- not soft-lock the map,
- interact with blade/stun mechanic.

No complex combat UI.

## 12. Gems and chest requirements

### Gems
- visible collectible and/or chest bonus,
- update run counter immediately,
- contribute to points and task progress,
- not redeemable for NIM in Cycle 2,
- not transferable,
- no fixed cash/NIM conversion shown.

If a Gem Runner task requires `N` gems, the authored/generated run must guarantee at least `N` reachable gems without relying on random chest contents.

### Mystery chests

Mystery chests may produce non-cash outcomes:
- empty,
- gems,
- relic/treasure points,
- potion,
- blade,
- poison,
- trap.

The UI must not present these as paid loot boxes.

Real NIM does not come from a random chest roll. Chest contents can help progression, but the stated deterministic expedition task controls reward eligibility.

## 13. Expedition task and NIM reward logic

### Task issuance
Before movement begins, the backend/app assigns a task template and concrete parameters for the run.

Recommended Cycle 2 model: use a shared **Daily Expedition Board** so players are not randomly assigned easier/harder reward paths. Run slots can rotate mission types/parameters by day while remaining comparable across players.

Example:
`Collect 12 gems and reach the Eastern Shrine alive.`

The player sees:
- task name,
- target,
- progress,
- completion point if relevant.

### Eligibility
A user can attempt to claim only if:
- expedition is valid,
- assigned task is completed,
- task completion can be verified from valid run events/checkpoints,
- daily player rules allow it,
- reward slots remain,
- no conflicting finalized claim exists.

For Vault Breaker, task completion and the seal flow can happen at the Temple Vault. For other tasks, completion unlocks a consistent reward-sealing overlay at the defined finish/checkpoint.

### Reservation
- server issues a short-lived claim reservation,
- contains nonce and expiry,
- client displays timer.

### Signature
CTA:
**Seal Treasure**

The app requests a Nimiq signature.

Game fiction:
- Goblin is trying to steal unsecured treasure.

Literal UX:
- user is clearly told they are signing a treasure claim,
- amount and expiry are visible.

### Verification
Backend validates:
- signature,
- signed message,
- wallet,
- reservation,
- expiry,
- expedition,
- task completion,
- reward slot,
- replay protection.

### Finalization
Only after valid verification is the reward slot consumed/finalized.

## 14. Reward animation

On successful claim finalization:
- vault chest opens,
- NIM treasure bursts out,
- coin particles move toward wallet/balance HUD,
- reward amount appears,
- displayed balance transitions when real balance/confirmation state is available.

Do not animate an already-in-wallet state before the transaction is actually confirmed.

Recommended sequence:
1. **Treasure sealed**
2. **Reward sending**
3. **Reward confirmed**
4. final balance animation

## 15. Failure states

### User cancels signature
Story:
**The Goblin escaped with the unsecured treasure.**

Literal:
**You cancelled the signing request. No reward was claimed.**

### Reservation expired
**The seal expired before it was signed.**

### Reward pool exhausted
**Today's 69 NIM treasures have already been claimed.**

Continue:
- relic/score run,
- come back after reset.

### Payout pending
**Your treasure is sealed. The NIM transaction is still confirming.**

### Payout failed
Do not silently retry multiple payouts.
Show:
**Your claim is recorded, but the payout needs retry/review.**

### Provider unavailable
**Open this Mini App inside Nimiq Pay to play.**

### Network failure
Avoid consuming a new expedition if the run cannot be initialized reliably.

## 16. Daily rules

Initial:
- 3 free reward-eligible expeditions per day.
- 69 real NIM reward slots per day.

Configurable:
- NIM amount per successful reward,
- maximum reward claims per wallet/day — **recommended: 1 for Cycle 2**,
- reset time,
- reservation duration.

Final economics must be locked only after treasury budget is known. After a wallet wins its daily NIM reward, remaining expeditions can still count toward gems, points, streaks and leaderboards.

## 17. Guardian Challenge — optional P2

After free expeditions are exhausted:
- complete a short quiz/challenge,
- earn +1 expedition.

Do not delay the main game for this feature.

## 18. Leaderboards and Monthly Heroes

### Leaderboards
Cycle 2-ready boards:
- Most Active Expedition Time,
- Most Points,
- Highest Streak,
- Most NIM Collected,
- Most Chests Opened,
- Most Expeditions Failed.

### Anti-gaming rules

**Active Expedition Time**
- count only foreground, non-paused gameplay,
- stop/cap accrual during inactivity,
- never use raw page-open duration.

**Most Expeditions Failed**
- count only meaningful failed runs,
- require minimum progression such as valid moves/rooms/checkpoints,
- reject immediate repeated spawn deaths.

All boards are calculated from server-authoritative events/stats.

### Monthly Heroes
At monthly close, #1 in each category receives a public recognition package:
- category Hero title,
- Hall of Heroes placement,
- shareable graphic/card,
- social PR shoutout.

Requirements:
- public Hero Name is opt-in,
- wallet address is not exposed by default,
- optional social handle/link requires explicit opt-in,
- no extra NIM prize is required for Cycle 2.

A single player may hold more than one category if they legitimately rank #1 in multiple boards.

## 19. Identity / anti-abuse

Use a combination of:
- Nimiq wallet,
- backend-issued session,
- optionally Nimiq Pay pseudonymous device identifier.

Requirements:
- disclose why device identifier is requested,
- do not treat it as unique-human proof,
- enforce server-side rate limits.

## 20. Nimiq integration requirements

MVP must demonstrate meaningful Nimiq use:
- Nimiq account access through Nimiq Pay,
- Nimiq signing for treasure sealing,
- real NIM reward settlement,
- receipt/proof.

This integration is core to the experience, not decorative.

## 21. EVM / token support strategy

Architecture must leave room for:
- USDT,
- Polygon,
- Arbitrum,
- Optimism,
- Base,
- BNB Smart Chain.

Cycle 2 MVP does not require all networks to be actively used in gameplay.

Potential post-core uses:
- cosmetics,
- non-prize practice expeditions,
- cosmetic bundles,
- supporter items.

Rule:
**Do not sell random chances at real NIM rewards.**

## 22. Localization

Read Nimiq Pay language where available.

Initial strings should be structured for:
- English,
- German,
- Spanish,
- French,
- Portuguese.

If translation work threatens stability, ship English with correct fallback architecture and add translations immediately after core stabilization.

## 23. Performance requirements

Target:
- responsive touch input,
- small initial bundle where practical,
- no blocking wallet initialization on marketing route,
- game asset loading screen,
- no unbounded particle effects,
- stable in mobile WebView.

## 24. Accessibility / usability

- large touch targets,
- controls away from system gesture edges,
- color is not the only hazard signal,
- important dialog text readable on small screens,
- reduced motion option if practical,
- sound can be muted,
- no forced landscape unless absolutely necessary.

Preferred:
portrait-first or comfortable mobile orientation chosen after early prototype test.

## 25. Visual / brand requirements

Recurring cast:
- Explorer,
- Goblin,
- Golem,
- NIM Treasure Coin.

The Golem may remain marketing-only in Cycle 2.

Core mood:
- ancient mystery,
- playful danger,
- premium pixel adventure,
- NIM-gold reward.

Avoid casino symbolism.

## 26. Marketing landing page requirements

Must:
- work outside Nimiq Pay,
- clearly state game is played in Nimiq Pay,
- show mobile CTA,
- provide deeplink,
- provide QR on desktop,
- show Angkor visuals,
- introduce mascots,
- preview expedition task types,
- show leaderboard/Hall of Heroes social proof,
- explain daily hunt in under 10 seconds.

Nice-to-have:
- live remaining count,
- reset timer,
- winner/claim pulse,
- current leaderboard leaders,
- latest Monthly Heroes.

## 27. Analytics / judging proof

Capture non-sensitive product metrics:
- unique participating wallets,
- expedition starts,
- expedition completions,
- vault reaches,
- claim attempts,
- successful claims,
- return usage,
- gems collected,
- points earned,
- chests opened,
- active expedition time,
- streaks,
- meaningful failed expeditions,
- failures by category.

Do not collect personal data without need/disclosure.

## 28. MVP acceptance test

The project is submission-ready when a new tester can:

1. Open the Mini App inside Nimiq Pay.
2. Understand the game.
3. Start an expedition and understand the assigned task.
4. Move reliably.
5. Collect gems/open treasure and see counters update.
6. Take damage and see HP update.
7. Push a boulder.
8. Find the key.
9. Open the gate.
10. Survive/avoid Goblin.
11. Complete the assigned deterministic task.
12. Receive correct live reward availability.
13. Sign a valid claim when eligible.
14. Have backend verify the task and claim.
15. See a reward payout move through correct states.
16. See a receipt on success.
17. See gems/points/streak/stat updates.
18. Open the leaderboard and see server-derived rankings.
19. Replay or see accurate daily-run limits.
20. Experience graceful errors for cancellation/offline/expired claim.

## 29. Out of scope for Cycle 2

- full Bavaria level,
- full Siberia level,
- multiplayer,
- PvP,
- trading,
- NFT system,
- character marketplace,
- deep combat,
- procedural campaign,
- multiple currencies as core prize rails,
- random real-money loot boxes,
- gem-to-NIM redemption in Cycle 2,
- paid reward attempts,
- complex leaderboard economy.

## 30. Success definition

The product is successful for Cycle 2 if:
- the end-to-end hunt works reliably,
- Nimiq is unmistakably part of the game mechanic,
- the game feels finished despite its small scope,
- real users return,
- judges can complete the main promise on first try,
- the brand is memorable enough to market beyond the submission page.
