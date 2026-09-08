# Nimiq Treasure Hunt — Game Idea

> Working title. Final brand name can change without changing the product.

## 1. One-line idea

A mobile-first, skill-based daily treasure adventure played inside Nimiq Pay: receive a mission for each expedition, explore ancient ruins, collect gems and treasure, survive hazards, complete the task alive, and—if one of the day's 69 real NIM rewards is still available—cryptographically seal the reward with your Nimiq wallet and watch it move into your balance.

## 2. Product fantasy

The user is not “using a crypto app.”

They are an explorer entering a living ruin.

Every day:
- the hunt resets,
- the world has a limited number of real NIM treasures,
- the player gets 3 free reward-eligible expeditions,
- every expedition begins with a clearly stated task,
- the task can ask the player to collect a target number of gems and survive, reach and seal the Temple Vault, open a target number of chests, recover a relic, or complete another deterministic skill objective,
- the first eligible explorers who complete their assigned task and seal an available claim receive the daily NIM reward.

The blockchain moment is presented as part of the fiction:

> You found the vault.  
> A Goblin is coming.  
> Seal the treasure before it is stolen.

The Nimiq Pay signing confirmation becomes the “seal” action.

## 3. Inspiration

The game takes inspiration from the *feeling* of classic Diamond Rush-style exploration:
- grid-based four-direction movement,
- compact puzzle rooms,
- visible-but-not-yet-reachable treasure,
- pushable objects,
- traps,
- keys and gates,
- environmental storytelling,
- short “how do I get there?” navigation puzzles.

The project must **not** copy Diamond Rush assets, exact level layouts, characters, branding, music, or proprietary content.

The visual language and level design will be original.

## 4. Cycle 2 MVP world

### World 01 — Angkor Ruins

The only playable world for the competition release.

Visual ingredients:
- warm sandstone temple ruins,
- jungle growth,
- giant roots crossing ancient structures,
- carved statues,
- moss,
- small water features,
- torches/fire,
- bright NIM-gold treasure accents,
- purple/blue relic crystals for non-monetary collectibles.

World selector may also show:
- Bavaria — **Coming Soon**
- Siberia — **Coming Soon**

These are presentation/roadmap teasers only and must not look playable if they are not.

## 5. Core loop

1. Open the Mini App inside Nimiq Pay.
2. See today's treasure count, leaderboards and remaining expeditions.
3. Start an expedition.
4. Receive an **Expedition Task** before movement begins.
5. Enter Angkor Ruins with 100 HP.
6. Move tile-by-tile through 5–7 compact rooms.
7. Collect visible gems and open optional mystery chests containing gems, relics, supplies or hazards.
8. Avoid hazards and the Goblin.
9. Push a boulder / find a key / open a gate where required.
10. Complete the assigned task alive.
11. If a daily real-NIM reward slot is still available, unlock the run's reward-sealing moment.
12. Sign the treasure claim in Nimiq Pay.
13. Backend verifies the task completion, eligibility and signature.
14. Reward service pays the configured NIM amount.
15. The treasure bursts open and NIM animates into the player's displayed balance after the correct confirmation state.
16. The run updates gems, points, streak and leaderboard stats.
17. Player can replay while daily expeditions remain.

## 6. IMPORTANT — prize design must be skill-based

The official competition rules prohibit games of chance where outcomes are primarily determined by randomness, while permitting skill-based games with clearly defined rules and prizes.

Therefore:

### Allowed randomness
Optional chests may contain:
- empty chest,
- gems,
- treasure/relic points,
- potion,
- temporary sword,
- poison,
- trap.

These outcomes do **not** directly determine whether the player wins real NIM.

### Real NIM must come from task completion

Every reward-eligible run receives a visible **Expedition Task** before play begins. Real NIM eligibility comes from completing that deterministic task alive while reward slots remain.

MVP task archetypes can include:

#### Gem Runner
Collect at least a stated number of gems and reach the completion point alive.

Important: the generated/map-authored run must guarantee enough reachable gems to satisfy the task. Random chest contents can provide **bonus** gems but must never be the only way to reach the required count.

#### Vault Breaker
Find the Temple Key, reach the Temple Vault and complete the seal flow.

#### Chest Hunter
Open at least a stated number of chests and survive to the completion point. The contents of those chests do not determine NIM eligibility.

#### Relic Keeper
Recover a required relic and finish the expedition alive.

#### Survivor
Complete the required route while meeting a clearly stated survival constraint, such as finishing with at least a configured HP threshold.

The “69 treasures” are therefore **69 daily reward slots for completed skill tasks**, not 69 lucky loot boxes.

### Daily Expedition Board

Recommended Cycle 2 model: every player sees the same Daily Expedition Board rather than receiving a randomly easier or harder mission than somebody else. The board can define the task for Run 1 / Run 2 / Run 3 and rotate parameters by day.

Example:
- Run 1 — Gem Runner: collect 12 gems and escape alive,
- Run 2 — Chest Hunter: open 4 chests and finish alive,
- Run 3 — Vault Breaker: reach and seal the Temple Vault.

For the earliest build, two task templates are enough. The player must always know the exact success condition before moving.

Do not ship a task whose completion depends on an undisclosed random event.

## 7. MVP mechanics

### Movement
- four-direction movement,
- tile/grid based,
- touch D-pad,
- optional swipe controls if stable,
- no free-form physics.

### Player health
- starts each expedition at 100 HP,
- 0 HP ends the expedition.

### Hazards
MVP:
- fire/spike hazard,
- poison hazard.

Example tuning:
- fire/spikes: -25 HP,
- poison: -20 HP or damage-over-time if easy to implement.

### Enemy
MVP enemy: **Goblin**

Behavior:
- simple patrol route,
- detects the player within a small range,
- moves toward player on valid tiles,
- collision damages and knocks the player back.

No complex RPG combat is required.

### Weapon
MVP weapon: **Ancient Blade**

Behavior:
- found during the run,
- can stun/defeat the Goblin on the next collision or for a short duration,
- no skill tree,
- no damage-stat system.

### Healing
MVP item: **Health Potion**
- restores a fixed amount of HP,
- cannot exceed 100 HP.

### Boulder
A pushable grid object.

Rule:
- player can push it only if the tile behind it is free,
- used for one or two compact environmental puzzles.

### Key + gate
Exactly one required key and one main gate in the MVP.

No multi-color key system.

## 8. Gems, treasure and mystery chests

### Gems

Gems are the main non-cash collectible in the game.

They can appear:
- visibly on the map,
- behind small puzzle routes,
- inside mystery chests as bonus bundles,
- as task objectives.

For Cycle 2:
- gems are **not redeemable for NIM**,
- gems are **not transferable**,
- gems contribute to points, progression and leaderboard stats,
- the UI must not promise a fixed monetary value for gems.

A future version may explore gem redemption for NIM, but that economic system is intentionally disabled for the competition build and should be reviewed separately before launch.

### Mystery chests

Mystery chests make exploration interesting without controlling cash-prize eligibility.

Possible outcomes:
- Empty
- Gems
- Treasure/relic points
- +HP potion
- Ancient Blade
- Poison
- Explosion/trap

A chest can still feel like “treasure” even when it is not a NIM reward. The important separation is:

**Chest loot = exploration/progression.**  
**NIM = earned by completing the run's stated skill task.**

If a task requires gems, the map/run must guarantee enough reachable gems independently of random chest contents.

## 9. Temple Vault

The Temple Vault is one of the strongest reward objectives, but not every expedition task has to be a vault run. A completed task unlocks the run's reward-sealing moment at its defined completion point.

For **Vault Breaker** tasks, requirements before the vault can be reached can include:
- find Temple Key,
- push boulder into correct position,
- cross hazard room,
- avoid or neutralize Goblin.

When opened:

### If daily reward slots remain
The game shows:

**TREASURE FOUND — [configured NIM amount] NIM**

Then:
- a Goblin/guardian threatens the claim,
- a short reservation timer starts,
- user chooses **Seal Treasure**,
- Nimiq Pay asks for a wallet signature,
- successful verification finalizes claim,
- reward transaction is initiated,
- reward animation plays.

### If rewards are exhausted
The vault becomes a relic vault:
- player still gets score/relic progress,
- no monetary reward,
- app clearly says today's NIM treasures have been claimed,
- no misleading claim UI.

## 10. Daily economy

Initial configuration:

```text
FREE_EXPEDITIONS_PER_DAY=3
DAILY_NIM_REWARD_SLOTS=69
NIM_REWARD_PER_CLAIM=configurable
MAX_NIM_REWARDS_PER_WALLET_PER_DAY=1 // recommended for Cycle 2
CLAIM_RESERVATION_SECONDS=configurable
```

Do not hardcode prize economics into the game client.

The payout amount should stay configurable until treasury budget is finalized. For Cycle 2, the recommended reward cap is **1 real NIM reward per wallet per day**; later expeditions still earn gems, points, streak and leaderboard progress.

## 11. Extra expeditions

After the 3 free reward-eligible expeditions are used:

### Guardian Challenge
A short skill/knowledge quiz can award one extra expedition.

Important:
- this is an access mechanic,
- it is not the direct NIM-winning action,
- prize eligibility still comes from completing the game objective.

Cycle 2 MVP may ship without this if it threatens core stability.

## 12. Real-time daily state

Home screen should show:
- reward slots claimed today,
- reward slots remaining,
- reset countdown,
- player's expeditions remaining,
- latest personal reward status.

Optional lightweight social feed:
- “A treasure was just sealed.”
- no full wallet address by default.

## 13. Points, streaks and leaderboards

Every legitimate expedition should update a lightweight player record.

### Points

Points are a non-cash score used for competition and progression.

Possible point sources:
- gems collected,
- treasure/relics recovered,
- chests opened,
- task completion,
- remaining HP at successful completion,
- Goblin avoidance/defeat events if they are reliably tracked.

Keep the formula simple and server-verifiable.

### Streak

A streak counts consecutive days on which the player completes at least one legitimate expedition task.

A failed expedition should not automatically destroy the streak if the player later completes a qualifying run that day. The exact rule should be displayed clearly.

### Leaderboards

Initial boards:
- **Most Active Expedition Time** — active gameplay time only; pause/background/idle time does not count,
- **Most Points**,
- **Highest Streak**,
- **Most NIM Collected**,
- **Most Chests Opened**,
- **Most Expeditions Failed** — comedic board, but only meaningful failed expeditions count.

A “meaningful failed expedition” must pass a minimum-progress rule so players cannot farm the board by instantly dying at spawn.

### Monthly Heroes

At the end of each month, the #1 player in each leaderboard category becomes a **Monthly Hero** for that category.

Examples:
- The Pathfinder — Most Active Expedition Time
- The Relic King/Queen — Most Points
- The Unbroken — Highest Streak
- The Golden Hand — Most NIM Collected
- The Chestbreaker — Most Chests Opened
- The Fallen Legend — Most Expeditions Failed

Each winner receives a free public spotlight/PR package:
- featured on the marketing site's **Hall of Heroes**,
- shareable hero card,
- social shoutout using their chosen Hero Name,
- optional link/handle if they opt in.

The recognition itself is the reward; Monthly Hero status does not need an additional NIM payout for Cycle 2.

Players should choose a public **Hero Name** separately from their wallet address. Public leaderboard identity must be opt-in and privacy-safe.

## 14. Mascot / character system

### The Explorer — hero mascot
Role:
- player's avatar,
- face of the product,
- appears in landing page hero, loading state, tutorial, error states and social media.

Personality:
- curious,
- brave,
- slightly cheeky,
- expressive enough for reaction animations.

Visual:
- compact adventure silhouette,
- backpack/satchel,
- boots,
- simple scarf/bandana or hat,
- original design, not a direct copy of Diamond Rush's character.

### The Goblin — chaos mascot
Role:
- first enemy,
- “claim thief” during the Nimiq sealing moment,
- excellent for empty/error/rejected-signature states.

Personality:
- greedy,
- mischievous,
- more funny than scary.

Marketing uses:
- peeking from behind the CTA,
- trying to steal the NIM coin,
- holding “Only 12 left” signage,
- running away after a successful seal.

### The Golem — guardian mascot
Role:
- future heavier enemy / world guardian,
- visual symbol of deeper levels and future content.

Cycle 2:
- can appear in marketing artwork and locked-world teaser,
- does not need full gameplay AI.

Personality:
- ancient,
- massive,
- slow,
- intimidating but stylized.

### The NIM Treasure Coin — reward mascot/object
Role:
- the literal object everybody wants,
- oversized golden treasure token inspired by NIM,
- can have a subtle glow, carved NIM mark, or tiny expressive treatment.

It should read as:
**ancient treasure first, crypto token second.**

Uses:
- hero composition,
- loading spinner,
- reward burst,
- live treasure counter,
- favicon/icon motifs,
- social graphics.

## 15. Marketing landing page

Even though the actual game is designed to run inside Nimiq Pay on mobile, the marketing site is worth building.

Its job is not to recreate the game.

Its job is to make someone think:

> I need to try today's hunt.

### Suggested structure

#### Hero
- Explorer running toward a glowing NIM treasure.
- Goblin reaching for it from the other side.
- Giant Angkor ruin silhouette/root system behind them.
- headline explaining the daily scarcity.
- CTA: **Hunt in Nimiq Pay**
- mobile deeplink + QR code.

#### Live Hunt Strip
- “43 / 69 treasures remain”
- reset timer,
- real-time or periodically refreshed.

#### Today's Expedition Tasks
Preview the kinds of missions players can receive: collect gems, hunt chests, survive, or break into the vault.

#### How it works
A tiny 3-step visual:
- Explore
- Survive
- Seal

#### The World
Show Angkor Ruins as playable.

Show:
- Bavaria — Coming Soon
- Siberia — Coming Soon

#### Meet the Ruins
Character cards:
- Explorer
- Goblin
- Golem
- NIM Treasure

#### Nimiq Proof
Show that rewards are sealed/claimed through Nimiq Pay, with a real receipt-style visual.

#### Hall of Heroes
Show current leaderboard leaders and the latest Monthly Heroes using opt-in Hero Names. This becomes a recurring social proof/PR section rather than a static testimonial block.

#### Final CTA
QR/deeplink back into Nimiq Pay.

## 16. Design direction

The visual identity should feel like:
- premium pixel adventure,
- ancient treasure,
- playful danger,
- modern mobile game polish.

Avoid:
- generic crypto neon,
- exchange/dashboard aesthetics,
- casino visuals,
- slot-machine presentation,
- excessive blockchain terminology.

The player should remember:
**the ruin, the goblin, the treasure.**

Not:
**the RPC provider.**

## 17. Why this can compete

The concept maps well to the Cycle 2 rubric because it aims for:
- a complete end-to-end core promise,
- clear failure states,
- mobile responsiveness,
- repeat daily value,
- strong use of Nimiq Pay signing and NIM,
- real user activity,
- a memorable visual identity.

The biggest competitive advantage is the loop:

**daily scarcity + skill + a real wallet-native “seal the treasure” moment.**

## 18. Non-goals for Cycle 2

Do not build before submission unless core MVP is already stable:
- Bavaria gameplay,
- Siberia gameplay,
- multiplayer,
- PvP,
- complex RPG combat,
- weapon stats,
- skill trees,
- NFT marketplace,
- paid randomized prize attempts,
- elaborate crafting,
- dozens of enemies,
- procedurally generated giant worlds,
- player-to-player trading.

Ship one excellent expedition first.
