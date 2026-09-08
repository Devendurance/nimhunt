# Nimiq Treasure Hunt — Architecture

## 1. Architecture goals

The Cycle 2 build should optimize for:
1. mobile reliability inside Nimiq Pay,
2. a very small game surface that feels polished,
3. server-authoritative prize eligibility,
4. safe NIM reward settlement,
5. a reusable adapter boundary for future EVM support,
6. fast iteration before September 18, 2026.

The architecture intentionally avoids a heavyweight game backend.

## 2. Runtime environments

### A. Public marketing web
Runs in a normal mobile/desktop browser.

Purpose:
- explain the game,
- show branding/mascots,
- show today's hunt state,
- provide QR/deeplink into Nimiq Pay,
- document how the game works.

It must not pretend the full game is playable outside Nimiq Pay.

### B. Mini App
Runs inside Nimiq Pay's WebView.

Nimiq Pay injects wallet providers into the Mini App environment.

Nimiq-specific access should use:

```ts
import { init } from '@nimiq/mini-app-sdk'

const nimiq = await init()
```

Nimiq Pay mediates sensitive wallet operations and shows native confirmation dialogs.

### C. Backend
Server-authoritative services for:
- daily expedition accounting,
- prize-slot accounting,
- player run state,
- expedition task issuance and validation,
- gems/points/streak statistics,
- leaderboard aggregation,
- reward eligibility,
- claim reservations,
- signature verification,
- idempotent payouts,
- real-time hunt state,
- audit/receipt storage.

## 3. Recommended stack

### Frontend
- Vite
- React
- TypeScript
- Phaser 3 for the game scene
- lightweight React state/store
- CSS for marketing/UI shell

Why:
- Vite is simple and aligns well with Nimiq's local Mini App workflow.
- React handles shell/HUD/marketing cleanly.
- Phaser handles tile maps, sprite animation, collisions, input, camera and simple enemy logic without us building a game engine from scratch.

If Phaser proves too heavy during P0 performance testing, fallback:
- HTML Canvas + a tiny custom grid engine.

### Backend
Recommended hackathon-friendly option:
- Supabase Postgres
- Supabase Edge Functions or a small serverless API
- Supabase Realtime for daily counter events

Alternative:
- Vercel Functions + Postgres

The product should depend on interfaces, not provider-specific code, so backend services can be swapped later.

### Deployment
- frontend/marketing: Vercel or equivalent static deployment
- backend/database: Supabase or equivalent

## 4. Single-repo layout

Suggested structure:

```text
/
├─ src/
│  ├─ app/
│  │  ├─ marketing/
│  │  ├─ play/
│  │  └─ routes/
│  ├─ game/
│  │  ├─ scenes/
│  │  ├─ map/
│  │  ├─ entities/
│  │  ├─ systems/
│  │  ├─ config/
│  │  └─ assets/
│  ├─ components/
│  │  ├─ hud/
│  │  ├─ claim/
│  │  ├─ dialogs/
│  │  └─ marketing/
│  ├─ adapters/
│  │  ├─ nimiq/
│  │  └─ evm/
│  ├─ api/
│  ├─ i18n/
│  ├─ domain/
│  └─ lib/
├─ server/
│  ├─ claims/
│  ├─ expeditions/
│  ├─ rewards/
│  ├─ missions/
│  ├─ leaderboards/
│  ├─ daily-state/
│  └─ security/
├─ public/
│  └─ assets/
├─ tests/
├─ architecture.md
├─ prd.md
├─ game_idea.md
└─ projectplan.md
```

## 5. Routing model

### `/`
Marketing landing page.

Works in a normal browser.

### `/play`
Actual Mini App game.

When opened outside Nimiq Pay:
- do not crash,
- show “Open in Nimiq Pay to play”,
- render QR/deeplink,
- optionally allow a non-reward visual preview later.

When opened inside Nimiq Pay:
- initialize provider,
- load player state,
- enable game.

The public marketing page can deep-link directly to `/play`.

## 6. Nimiq integration

Nimiq Pay Mini Apps support NIM account/signing/payment flows through the injected Nimiq provider.

### Required MVP flow

1. Initialize provider.
2. Request/share Nimiq account when the player enters the reward flow.
3. Build a canonical treasure-claim message.
4. Request a Nimiq signature.
5. Send signed claim to backend.
6. Backend verifies:
   - message integrity,
   - wallet/address,
   - signature,
   - claim nonce,
   - reservation,
   - assigned task completion,
   - expedition eligibility,
   - daily reward availability,
   - replay/idempotency.
7. Backend records finalized claim.
8. Reward service initiates NIM payout.
9. Client shows transaction/claim state and then reward animation.

### Canonical claim payload

Conceptual shape:

```json
{
  "version": 1,
  "type": "TREASURE_CLAIM",
  "wallet": "NQ...",
  "expeditionId": "...",
  "taskId": "...",
  "taskVersion": "...",
  "taskCompletionHash": "...",
  "claimNonce": "...",
  "dailyEpoch": "2026-09-07",
  "rewardAmountLuna": "...",
  "expiresAt": "..."
}
```

Serialize deterministically before signing.

Do not sign an ambiguous sentence if a structured canonical payload can be used.

### Signature verification

The exact server-side Nimiq cryptographic verification library/API should be validated in the first integration spike before reward logic is built around it.

No reward should depend on client-only signature assumptions.

## 7. Reward payout service

The prize treasury is not the user's wallet.

A backend-controlled reward mechanism is required for automatic payouts.

### Principles
- never expose a treasury private key to the client,
- never commit it to GitHub,
- store secrets in deployment secret storage,
- isolate payout logic from normal game APIs,
- enforce per-claim and daily caps,
- use idempotency keys,
- never let the browser choose arbitrary payout amount/address,
- keep a transaction audit record.

### Reward request

Backend creates reward instructions from verified server state, not request body values supplied by the client.

Conceptual server call:

```text
payVerifiedClaim(claimId)
```

not:

```text
sendNim(userProvidedAddress, userProvidedAmount)
```

### Payout states
- pending
- signing
- broadcast
- confirmed
- failed
- manual_review

A failed payout must not create a second prize claim automatically.

## 8. Prize eligibility model

Prize eligibility is server authoritative.

The client must never decide:
- whether a reward slot remains,
- whether an expedition is eligible,
- whether a player has already claimed,
- payout amount,
- whether an expedition task completion qualifies.

### Daily reward slots

Store a daily hunt row:

```text
daily_hunt
- date/epoch
- total_reward_slots
- claimed_reward_slots
- reward_amount
- status
- resets_at
```

Use a database transaction / atomic operation when consuming a slot.

Never:
1. read `remaining = 1`,
2. tell two users they both won,
3. decrement afterward.

Instead atomically reserve/finalize.

## 9. Claim reservation

When an eligible player completes the assigned Expedition Task and reaches its defined reward checkpoint:

1. backend verifies expedition and task completion,
2. backend creates a short-lived reservation,
3. reservation includes nonce + expiry,
4. client signs that exact claim,
5. successful verification finalizes it.

If the player:
- closes the app,
- rejects the signature,
- loses connectivity,
- waits too long,

the reservation expires.

In fiction:
**the Goblin stole the unsecured treasure.**

Technically:
**the slot is released or the reservation expires according to server policy.**

## 10. Expedition model

An expedition is a server-issued run token.

Conceptual data:

```text
expedition
- id
- wallet/device scope
- day
- task_id
- task_version
- task_type
- task_target
- started_at
- completed_at
- status
- hp_terminal_state
- gems_collected
- points_earned
- chests_opened
- active_ms
- meaningful_failure
- task_completed
- map/version
- eligibility
```

The game can run locally for responsiveness, but the backend should receive enough checkpoint/proof state to make obvious manipulation harder.

For the hackathon, anti-cheat should be proportional:
- server-issued expedition ID,
- server-issued map/version,
- required checkpoint/task event sequence,
- server-issued task parameters,
- monotonic event ordering,
- impossible-time rejection,
- final vault-completion validation,
- rate limits.

Do not attempt enterprise anti-cheat in Cycle 2.

## 11. Expedition task system

Each expedition receives a server-recognized task definition before gameplay starts. For Cycle 2, prefer a shared **Daily Expedition Board** so Run 1/2/3 task slots are comparable across players instead of randomly assigning materially different difficulty.

Conceptual task shape:

```text
task_definition
- id
- version
- type
- target_value
- completion_checkpoint
- minimum_progress
- scoring_rules
```

Initial task types:
- `GEM_RUNNER`
- `VAULT_BREAKER`
- `CHEST_HUNTER`
- `RELIC_KEEPER`
- `SURVIVOR`

### Deterministic eligibility rule

The task definition may vary between expeditions, but its success condition must be visible before movement and verifiable from the run state/events.

For `GEM_RUNNER`, the run/map must guarantee enough reachable gems to satisfy the target without depending on random chest loot.

### Gems

Cycle 2 gems are a progression/stat asset only:
- no NIM redemption endpoint,
- no transfer endpoint,
- no displayed exchange rate,
- stored as gameplay totals and per-run counts.

If gem redemption is introduced later, treat it as a separate economic subsystem with its own treasury, abuse, policy and legal review rather than silently converting the Cycle 2 stat counter into money.

## 12. Daily run limits

Baseline:
- 3 free expeditions/day,
- recommended maximum 1 finalized real-NIM reward per wallet/day; later runs remain valid for gems/points/streak/leaderboards.

Possible identity signals:
- Nimiq wallet,
- Nimiq Pay pseudonymous device identifier,
- server session.

The device identifier is useful for anti-spam/save-slot support, but it identifies a device rather than a person and should not be treated as proof of unique human identity.

Use privacy disclosure when requesting it.

## 13. Game engine model

### Grid
Represent each room as a tile matrix.

Example tile types:

```text
FLOOR
WALL
ROOT
BOULDER
FIRE
POISON
GATE
KEY
GEM
RELIC
CHEST
TASK_CHECKPOINT
VAULT
PLAYER_START
GOBLIN_PATROL
```

### Movement
One atomic move:
1. read target tile,
2. reject wall/gate,
3. push boulder if legal,
4. apply hazard,
5. update player position,
6. move enemy,
7. resolve collision,
8. emit UI/game event.

### Game simulation
Keep deterministic where practical.

Use a state machine rather than scattered booleans.

Example expedition states:

```text
LOADING
READY
PLAYING
PLAYER_DEAD
TASK_COMPLETE
REWARD_ELIGIBLE
CLAIM_RESERVED
AWAITING_SIGNATURE
CLAIM_VERIFYING
PAYOUT_PENDING
PAYOUT_CONFIRMED
PAYOUT_FAILED
COMPLETE
```

## 14. Game/React boundary

Phaser owns:
- tile map,
- player movement,
- enemy movement,
- collision,
- in-map animation.

React owns:
- top HUD,
- HP display,
- daily treasure counter,
- run count,
- modal/dialog overlays,
- Nimiq wallet prompts/status,
- claim flow,
- receipts,
- marketing pages.

Communicate through a small typed event bus.

Example events:

```text
HP_CHANGED
ITEM_FOUND
GEM_COLLECTED
CHEST_OPENED
TASK_PROGRESS
TASK_COMPLETE
PLAYER_DIED
EXPEDITION_COMPLETE
```

Do not let Phaser directly call wallet APIs.

Wallet calls belong in the app/domain layer.

## 15. Realtime

Realtime is useful for:
- claimed/remaining treasure counter,
- “a treasure was just sealed” event,
- leaderboard refreshes / Monthly Hero display.

It is not required for:
- player movement,
- enemy movement,
- puzzle state.

If realtime transport fails:
- poll periodically,
- do not block gameplay.

## 16. Localization

Nimiq Pay exposes its selected language through:

```js
window.nimiqPay?.language
```

Use:
1. Nimiq Pay language,
2. device language,
3. English fallback.

Initial translation targets if time permits:
- English
- German
- Spanish
- French
- Portuguese

All core claim/error strings should be centralized.

## 17. EVM adapter strategy

The Mini Apps framework also exposes an EIP-1193 Ethereum provider through:

```js
window.ethereum
```

Supported ecosystem coverage includes major EVM networks such as:
- Arbitrum,
- Optimism,
- Base,
- BNB Smart Chain,
- Ethereum,
- supported ERC-20s such as USDT where available.

### Cycle 2 position

Do **not** make multichain payments a dependency of the core game.

Create an adapter boundary now:

```ts
interface PaymentAdapter {
  getAccount(): Promise<string>
  getBalance(asset: Asset): Promise<Balance>
  requestPayment(request: PaymentRequest): Promise<PaymentResult>
}
```

Implement:
- `NimiqAdapter` first.

Prepare:
- `EvmAdapter` interface/config.

Only ship paid EVM cosmetics or utility after:
- core NIM hunt works,
- prize logic is stable,
- no gambling/chance issue is introduced.

## 18. Marketing deeplinks

Published Mini Apps can be opened in Nimiq Pay through deeplinks.

The marketing site's main CTA should:
- detect mobile where practical,
- open Nimiq Pay Mini App deeplink,
- provide QR for desktop users,
- provide “Get/Open Nimiq Pay” guidance if deep link fails.

## 19. Offline and error behavior

### Nimiq provider unavailable
Show:
**Open this hunt inside Nimiq Pay.**

### Signature rejected
Game fiction:
**The Goblin got away with the unsecured treasure.**

Also show literal recovery:
**You cancelled the signature. Your reward was not claimed.**

Do not hide real error meaning behind story text.

### Claim expired
**Too slow — the seal expired. Re-enter the vault to try again if your expedition is still eligible.**

### Payout delayed
Never say funds are received before confirmation.

Show:
**Treasure sealed. Reward transaction pending.**

### Backend unavailable
Do not consume a run if the server cannot create a valid expedition.

## 20. Security invariants

1. Client cannot mint/create reward slots.
2. Client cannot choose reward amount.
3. Client cannot finalize its own claim.
4. Claim nonce is single-use.
5. Reservations expire.
6. Payout is idempotent.
7. Private keys never ship to frontend.
8. GitHub repo contains no secrets.
9. Daily limits are enforced server-side.
10. UI never claims a payout succeeded before authoritative confirmation.

## 21. Data model — minimal

Suggested tables:

### `players`
- id
- wallet_address
- device_hash_nullable
- created_at

### `daily_hunts`
- id
- hunt_date
- total_slots
- claimed_slots
- reward_amount
- resets_at
- status

### `expeditions`
- id
- player_id
- hunt_id
- map_version
- task_definition_id
- task_target
- gems_collected
- points_earned
- chests_opened
- active_ms
- meaningful_failure
- started_at
- ended_at
- status
- task_completed
- eligible

### `task_definitions`
- id
- version
- type
- target_value
- completion_checkpoint
- config_json
- active

### `player_stats`
- player_id
- gems_total
- points_total
- active_ms_total
- streak_current
- streak_best
- nim_collected_total
- chests_opened_total
- meaningful_failures_total
- updated_at

### `hero_profiles`
- player_id
- hero_name
- public_opt_in
- social_handle_nullable
- updated_at

### `leaderboard_snapshots`
- period
- category
- player_id
- value
- rank
- finalized_at_nullable

### `claim_reservations`
- id
- expedition_id
- player_id
- nonce_hash
- expires_at
- status

### `claims`
- id
- reservation_id
- wallet_address
- signature
- canonical_message_hash
- reward_amount
- status
- created_at

### `payouts`
- id
- claim_id
- idempotency_key
- tx_hash
- status
- created_at
- confirmed_at

### `game_events`
Optional, bounded telemetry:
- expedition_id
- event_type
- sequence
- created_at

Avoid collecting unnecessary personal data.

## 22. Observability

Track:
- app load failures,
- provider initialization failures,
- expedition start failures,
- player-death rate,
- task completion rate by task type,
- gem collection distribution,
- active-time sanity checks,
- leaderboard write/aggregation failures,
- signature rejection/failure,
- claim verification failure,
- payout failure,
- average run duration.

For judging, stability matters more than sophisticated analytics.

## 23. Testing strategy

### Unit
- grid movement,
- boulder push legality,
- hazard damage,
- gate/key rules,
- gem counting and guaranteed Gem Runner target,
- task progress/completion rules,
- active-time calculation,
- meaningful-failure qualification,
- leaderboard aggregation,
- Goblin movement,
- daily run counter,
- claim state machine,
- canonical claim serialization.

### Integration
- start expedition,
- complete each supported task fixture,
- persist points/gems/stats,
- update leaderboard,
- create reservation,
- sign/verify fixture,
- finalize claim,
- idempotent payout.

### Mobile WebView
Must test on real Nimiq Pay:
- touch controls,
- pause/resume,
- provider dialogs,
- app backgrounding,
- signature cancellation,
- weak network,
- claim timeout,
- payout pending state.

### Abuse cases
- replay same signature,
- reuse nonce,
- claim after expiry,
- claim twice,
- fake amount,
- fake wallet,
- two simultaneous claims for last slot.

## 24. Architecture decisions locked for MVP

- Mobile Mini App is the actual game.
- Public web is marketing + discovery, not an alternate prize client.
- Angkor is the only playable world.
- Grid movement.
- One Goblin.
- One key/gate.
- One boulder puzzle mechanic.
- Every run has a visible deterministic Expedition Task.
- Gems/treasure are progression items and non-redeemable in Cycle 2.
- Leaderboards use server-authoritative stats and anti-idle/anti-farm rules.
- Cash reward is skill-gated, never random loot.
- Server-authoritative daily slots and claims.
- Nimiq is the core wallet integration.
- EVM is an adapter/extension, not MVP critical path.
