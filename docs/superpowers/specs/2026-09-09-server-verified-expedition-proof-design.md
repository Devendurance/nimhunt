# Server-Verified Expedition Proof Design

**Date:** 2026-09-09
**Status:** Design approved; replay/validator foundation implemented; broader proof flow pending
**Scope:** Server-verified expedition proof, signed claim, and accounting-only slot reservation

## 1. Goal and Non-Goals

The reward-eligible product flow is:

```text
mission brief
-> deliberate wallet-authorized start
-> durable run and server-issued blueprint
-> Phaser gameplay with server-acknowledged action checkpoints
-> server replay and verified eligibility
-> deliberate signed claim
-> atomic accounting-only reservation
```

The milestone must not:

- send or transfer NIM;
- add treasury keys, seed phrases, payout workers, payout amounts, payout transaction fields, or payout states;
- add rooms, enemies, timed collapsing-boulder gameplay, or other new gameplay mechanics;
- change the existing verified mission rules;
- modify the marketing `/` route;
- weaken the existing Nimiq preview/dev seal verifier;
- trust client-provided completion, HP, gem, chest, objective, enemy, puzzle, or Vault results.

The existing 191 tests must remain green. The implementation is complete independently from real Postgres and device verification. Missing Supabase credentials means `POSTGRES + DEVICE VALIDATION: PENDING`, not production verification.

The signed start authorization proves wallet control for creating a run only. Every post-start mutation or recovery operation requires an authenticated server-issued run session; `runId` plus a public wallet address is never sufficient authorization.

## 2. Existing Boundaries to Preserve

- Pure game rules remain under `src/game/systems/` and the new replay layer has no Phaser or DOM imports.
- Phaser remains the presentation and input adapter. React owns wallet I/O, proof state, dialogs, claims, and reservation messaging.
- The existing Nimiq crypto path uses `@nimiq/core` `Address`, `PublicKey`, `Signature`, and the Nimiq signed-message hash prefix.
- The existing `NIMHUNT_TEST_SEAL` and `NIMHUNT_VAULT_SEAL_PREVIEW` behavior remains unchanged for its current dev/integration surface.
- `DailyLedger` remains the accounting abstraction. Product reservation passes a server-created claim binding to the atomic reservation operation.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. The browser never accesses ledger or proof tables directly.
- `/play?dev=game` is local development gameplay. `/play?dev=nimiq` remains the existing integration/dev surface.

## 3. Versioning and Canonical Serialization

The supported identifiers are:

```ts
export const RULES_VERSION = 'nimhunt-rules-v1'
export const ROOM_VERSION = 'angkor-room-01-v1'
export const BLUEPRINT_VERSION = 'angkor-blueprint-v1'
```

The server supports only these versions in this milestone. Rules, room, or blueprint version mismatches reject before replay with stable unsupported-version errors. The server never silently replays an old transcript under a newer configuration.

Every hash uses UTF-8 input, SHA-256, lowercase hexadecimal output, and no trailing newline. Hash inputs use domain-separated prefixes:

```text
NIMHUNT:BLUEPRINT:v1\n
NIMHUNT:TRANSCRIPT:v1\n
NIMHUNT:REPLAY_STATE:v1\n
NIMHUNT:CHECKPOINT:v1\n
NIMHUNT:ACTION_BATCH:v1\n
NIMHUNT:CLAIM:v1\n
```

Each prefix is followed by the explicit canonical serialization for that structure. This prevents different structure types from sharing an ambiguous hash domain.

Each proof-bearing structure has an explicit canonical serializer. Serializers define field order and array order rather than relying on arbitrary object-key order or database JSON serialization. The canonical transcript includes:

```text
version
runId
wallet
mission
rulesVersion
roomVersion
blueprintVersion
blueprintId
blueprintHash
actions
```

The canonical transcript always includes the normalized wallet. The canonical blueprint content hash does not hash an arbitrary stored JSON string or its own hash. It is computed from an explicit `BlueprintHashPayload` with fixed field and nested-array order:

```text
rulesVersion
roomVersion
blueprintVersion
dayKey
mission
spawn
goblins
gems
chests
sword
potion
hazards
boulders
key
gate
objective
missionParameters
timedHazards
```

`blueprintId` is intentionally excluded from `BlueprintHashPayload`; it is an independent server identity bound everywhere the blueprint is referenced. `blueprintHash` excludes `blueprintHash` itself, `blueprintId`, the stored canonical serialized blueprint string, lifecycle status, and database timestamps. Equivalent logical payloads produce the same content hash independent of object-key ordering or database JSON representation.

The canonical transcript hash is computed from the complete canonical transcript, not only the action array. The initial empty transcript has a stable hash. State and checkpoint hashes use similarly explicit canonical representations.

## 4. Daily Expedition Blueprints

### 4.1 Blueprint contract

The replay engine accepts an immutable server-issued `ExpeditionBlueprint` in addition to stable room geometry and rules. It contains:

- UTC `dayKey` and mission type;
- `blueprintVersion`, `blueprintId`, canonical JSON, and `blueprintHash`;
- player spawn;
- Goblin count, spawn positions, and patrol routes;
- gem coordinates;
- chest coordinates and deterministic contents;
- sword and potion positions;
- spike and poison positions;
- boulder positions;
- Temple Key, Gate, and Vault/objective positions where relevant;
- mission difficulty parameters;
- a typed `timedHazards` configuration reserved for a future version.

The product client may receive the complete bound blueprint required to render the expedition. Level data is not treated as secret. The server selects and binds the blueprint; the client cannot choose the blueprint identity or submit replacement coordinates/configuration during verification.

### 4.2 Selection and publication

There is one canonical published blueprint per UTC day and supported mission:

```text
(day_key, GEM_RUNNER)
(day_key, CHEST_HUNTER)
(day_key, VAULT_BREAKER)
```

Blueprint lifecycle is:

```text
DRAFT -> VALIDATED -> PUBLISHED -> RETIRED
```

Only `VALIDATED` records can become `PUBLISHED`. Blueprint content and its hash are immutable after publication. Lifecycle status is the controlled exception: a published record may transition to `RETIRED`, but its content, hash, version, and historical snapshot never change. Corrections create a new blueprint ID/version. At most one active published blueprint exists for a `(day_key, mission_type)` pair. Historical published/retired snapshots remain available forever for replay.

Before the first reward-eligible run references a publication, a broken publication may be retired and replaced. Once any reward-eligible run references it, it cannot be silently replaced for other players on that day. If a broken publication must be retired after real runs have used it, new reward-eligible starts for that mission are disabled for the rest of the UTC day; Practice remains available and historical runs remain replayable.

Blueprint data supports mission-specific daily layouts and difficulty profiles. The replay contract does not assume one global object arrangement. This proof milestone adds the selection, hash, persistence, and validation boundary without adding new mechanics or changing the currently verified Room 01 rules. Future authored mission-specific variations use the same contract.

If no active `PUBLISHED` blueprint whose content has passed `VALIDATED` is available for the current UTC day and mission, the server returns `DAILY_BLUEPRINT_UNAVAILABLE` and fails closed. It never falls back to yesterday's blueprint, an arbitrary current Room 01 object arrangement, or client-generated configuration. The bootstrap strategy for this milestone is to provision one validated/published record for each supported mission before reward-mode starts, initially using the currently verified Room 01 configuration without introducing new visible layouts. If provisioning is incomplete, reward mode remains unavailable while Practice can be offered.

### 4.3 Positive solvability validation

`validateExpeditionBlueprint()` must positively establish that at least one winning action sequence exists under the exact deterministic engine. Geometry-only reachability is insufficient.

The validator searches/simulates the real state transitions and requires a winning sequence of at most `MAX_ACCEPTED_ACTIONS = 256` that proves, as applicable:

- a valid spawn and walkable geometry;
- survival with final HP greater than zero;
- Gem Runner can collect at least the required gems;
- Chest Hunter can open at least the required chests;
- Vault Breaker can obtain the key, open the gate, and reach the Vault;
- Goblin patrol/chase behavior leaves at least one winning path;
- required boulder interactions remain solvable and recoverable;
- hazards do not make every winning route lethal;
- required objectives do not overlap invalid geometry.

Invalid blueprints cannot be published or selected for reward-eligible runs.

### 4.4 Future timed hazards

The blueprint type reserves `timedHazards`, but current published content has no supported timed collapsing-boulder behavior. The current action transcript has no client elapsed timestamps. A future real-time trap requires a separately versioned authoritative timing model, such as server-bound monotonic timing; client elapsed time will never be trusted.

### 4.5 Rules v1 compatibility

`nimhunt-rules-v1` accepts only mechanics already implemented and verified. The Rules v1 validator rejects blueprint data that requires multiple Goblins when the current engine supports one, non-empty `timedHazards`, collapsing boulders, or any transition semantics not implemented by the current replay engine. Such content requires a new supported rules version and implementation before publication.

## 5. Pure Deterministic Replay Engine

Add a pure replay layer with concepts equivalent to:

```ts
createInitialRun({ mission, rulesVersion, roomVersion, blueprint }): ReplayState
advanceRun(state, action): { state: ReplayState; accepted: boolean; reason?: string }
```

The initial state is derived only from the server-selected versions and immutable blueprint. `advanceRun()` composes the existing verified rules in the same order as visible gameplay:

1. validate a single four-direction movement;
2. apply locked-gate and boulder-push rules;
3. commit the player tile transition;
4. apply hazards;
5. collect visible gems;
6. resolve sword and potion behavior;
7. open deterministic step-on chests once;
8. evaluate Goblin collision and deterministic Goblin movement;
9. resolve post-Goblin collision;
10. derive mission progress and terminal gameplay state.

The engine returns derived state containing player position, HP, collected gem IDs/count, opened chest IDs/count, item state, puzzle state, Goblin state, and mission progress. It never consumes client-derived result fields.

The Phaser scene uses the same pure transition semantics while retaining existing animation and visible behavior. Rejected or blocked input does not enter the canonical transcript. Accepted moves are recorded when the existing movement/puzzle validation accepts them; animation is not a network dependency.

## 6. Action Transcript and Checkpoint Chain

### 6.1 Canonical action format

The transcript contains only accepted player inputs:

```json
{
  "version": 1,
  "runId": "server-run-id",
  "wallet": "NQ...",
  "mission": "gem-runner",
  "rulesVersion": "nimhunt-rules-v1",
  "roomVersion": "angkor-room-01-v1",
  "blueprintVersion": "angkor-blueprint-v1",
  "blueprintId": "server-blueprint-id",
  "blueprintHash": "sha256-hex",
  "actions": [
    { "seq": 1, "type": "MOVE", "direction": "UP" }
  ]
}
```

The server rejects malformed objects, unknown action types, invalid directions, non-contiguous sequence numbers, duplicate/future sequence values, wrong run/mission/version bindings, and client outcome/configuration fields. Stable parser errors include:

```text
MALFORMED_TRANSCRIPT
ACTION_LIMIT_EXCEEDED
INVALID_SEQUENCE
INVALID_ACTION
UNSUPPORTED_RULES_VERSION
UNSUPPORTED_ROOM_VERSION
UNSUPPORTED_BLUEPRINT_VERSION
```

The current practical limits are 256 total accepted moves and a 16 KiB transcript/checkpoint request body. Product checkpoint batches contain at most 8 accepted moves. The client may have at most 16 accepted moves unacknowledged. This prevents unbounded local divergence while preserving responsive movement.

### 6.2 Initial checkpoint

At durable run creation, persist a trusted initial checkpoint:

```text
seq = 0
stateHash = hash(canonical initial replay state)
transcriptHash = hash(canonical empty transcript)
checkpointHash = hash(canonical checkpoint binding)
runChallenge
lastCheckpointAt = database time
```

The initial state includes rules, room, and exact immutable blueprint bindings.

### 6.3 Append operation

The proof service exposes an operation equivalent to:

```text
appendRunActions(authenticatedRunSession, runId, previousCheckpointHash, actions)
```

The session supplies the durable wallet/run identity. Any body wallet or run identifiers are cross-checked and are never used as authorization. Under a run row lock or equivalent serialized memory critical section, the server performs retry detection before ordinary stale-checkpoint rejection:

1. Look for an immutable committed batch matching `runId`, `previousCheckpointHash`, and its canonical action-batch fingerprint. If found, return the stored acknowledgement, even if the run has since become terminal.
2. Otherwise require the run to be `STARTED` and the session wallet/run binding to match;
- requires all version and blueprint bindings to match the durable run;
- requires the previous checkpoint hash to equal the trusted persisted checkpoint;
- requires the next sequence to be `persistedSeq + 1` and contiguous;
- enforces MOVE-only actions and all request/action limits;
- canonicalizes and hashes the persisted replay snapshot and requires that hash to equal the trusted persisted `stateHash` before advancing. If it fails, reconstruct from immutable acknowledged action history where safe or fail closed with proof loss;
- replays from the trusted snapshot with `advanceRun()`;
- computes the new cumulative transcript, transcript hash, state hash, and checkpoint hash;
- persists an immutable action-batch/checkpoint record and trusted replay snapshot atomically;
- updates the run's last sequence/hash/timestamp and trusted summary;
- returns the acknowledgement and server-derived progress.

The request cannot provide HP, gems, chests, coordinates, Goblin state, puzzle state, objective flags, mission result, replacement blueprint, or elapsed timestamps. A stale/different previous hash returns `CHECKPOINT_MISMATCH` and never overwrites history.

Immutable acknowledged action history is the source of truth. Each batch stores a canonical batch fingerprint and its previous checkpoint hash. Retrying an already committed identical batch returns its original acknowledgement without appending twice. A different batch cannot advance from the old checkpoint. Concurrent batches for one run serialize; only one may advance from a given checkpoint. A persisted replay-state snapshot is an optimization and can never rewrite acknowledged history.

### 6.4 Finalization

The client does not submit a new final transcript. `verifyExpeditionRun(authenticatedRunSession, runId, checkpointHash)` accepts the authenticated run session and current checkpoint identifier/hash only. It requires all accepted actions to be acknowledged, reconstructs the complete transcript from immutable server batch records, and replays the complete chain from the immutable initial blueprint as an audit invariant.

For Vault Breaker, checkpoint processing may first expose the trusted Vault-reached checkpoint needed to build the product Vault seal. Final replay eligibility is finalized only after that run-bound product seal has been verified. Gem Runner and Chest Hunter can finalize immediately after their successful terminal checkpoint.

The final cumulative transcript hash and trusted state hash must match the persisted checkpoint values. The server derives and persists:

```text
final_hp
gems_collected
chests_opened
objective_reached
has_temple_key
mission_satisfied
final_seq
transcript_hash
verified_at
```

The client cannot replace any of these values.

### 6.5 Terminal classification

Finalization is an explicit run-ending operation:

- mission satisfied and HP greater than zero -> `COMPLETED`, `reward_status = ELIGIBLE`, API status `VERIFIED_ELIGIBLE`;
- server-derived HP zero -> `FAILED`, `reward_status = NONE`;
- deliberate alive incomplete leave through proof-aware abandon -> `ABANDONED`, `reward_status = NONE`;
- alive incomplete finalization is rejected and is not classified as `FAILED`.

For Vault Breaker, reaching the Vault is the server-verified gameplay stage. A product reward still requires the run-bound Vault seal described below.

This proof shows that the wallet-bound run committed a valid action sequence under the authoritative rules and blueprint. It does not prove that a human rather than automation generated the actions.

## 7. Atomic Start Authorization

### 7.1 Deliberate account selection

Product `/play` does not request a wallet on load. On Start, React initializes Nimiq Pay if needed, calls `listAccounts()`, and requires explicit selection when multiple accounts are returned. The selected normalized address is captured for challenge creation and signing. The client never silently changes accounts between those steps.

### 7.2 Start challenge

`POST /api/expeditions/start-challenge` accepts the selected wallet and mission. The server validates them, selects the active published UTC-day blueprint, and persists a five-minute one-use challenge containing at least:

```text
challenge and challenge hash
wallet
mission
day_key
blueprint_id
blueprint_hash
created_at
expires_at
consumed_at nullable
run_id nullable
```

The challenge expiry is `min(created_at + 5 minutes, next UTC midnight)`. All timestamps and the current day come from server/database time. The response contains `challenge`, `blueprintId`, `blueprintHash`, `dayKey`, and `expiresAt`. This operation consumes no attempt.

### 7.3 Signed authorization

The client displays and signs exactly:

```json
{
  "version": 1,
  "type": "NIMHUNT_START_EXPEDITION",
  "wallet": "NQ...",
  "mission": "gem-runner",
  "dayKey": "2026-09-09",
  "challenge": "server-issued-value",
  "blueprintId": "server-issued-id",
  "blueprintHash": "server-issued-hash"
}
```

`POST /api/expeditions/start` receives that exact payload, public key, and signature. The server strictly parses/re-serializes it, verifies Nimiq address/signature binding, challenge expiry/usage, wallet/mission binding, and blueprint identity equality:

```text
signed payload blueprint
== challenge-bound blueprint
== published blueprint selected for this start
```

### 7.4 One atomic start transaction

Signature verification may occur before the database transaction, but challenge consumption, daily-limit enforcement, attempt increment, durable run creation, run-challenge generation, challenge-to-run binding, and successful start proof persistence commit atomically.

The transaction locks the challenge, requires an unused challenge to have `database_current_day == challenge.day_key`, requires the challenge blueprint to belong to that day and remain the active `PUBLISHED` blueprint, locks the wallet/day state, enforces the three-expedition limit, increments exactly once, creates the run and initial checkpoint, stores the generated unique `runChallenge`, stores `run_id` on the challenge, and marks the challenge consumed. Challenge expiry is checked against database time. Any failure rolls back the run and attempt.

Concurrent submissions of one challenge create exactly one run. An unused challenge crossing the UTC boundary returns `START_CHALLENGE_DAY_EXPIRED`; it cannot create a new-day run. The consumed challenge stores the authorization fingerprint/proof and the complete canonical response. An exact retry, including after midnight, returns `START_ALREADY_CREATED` with the same response values and consumes nothing. Altered wallet, mission, day, blueprint, payload, or signature bindings return `START_CHALLENGE_INVALID`. Expired challenges return `START_CHALLENGE_EXPIRED`. Limit exhaustion returns `DAILY_EXPEDITION_LIMIT_REACHED` without creating a run.

The successful response contains:

```text
runId
runChallenge
attemptsRemaining
rulesVersion
roomVersion
blueprintVersion
blueprintId
blueprintHash
full blueprint
dayKey
nextResetAt
```

### 7.5 Authenticated run session

On successful atomic start, the server creates a cryptographically random run-session capability of at least 256 bits. The same-origin deployment uses a `Secure`, `HttpOnly`, `SameSite=Strict` cookie. The raw capability is never included in transcript hashes, claim payloads, screenshots, or UI; only its server-side hash and binding are persisted. The session record contains `run_session_hash`, `run_id`, normalized `wallet`, `created_at`, `expires_at`, and optional revocation metadata. The session is bound to `runId`, the durable wallet, and an expiry no later than the run's claim window.

The authenticated run session is required for checkpoint append, final verification, abandon, active-run recovery, product Vault-seal preparation/submission, reward-claim preparation, and claim submission. The server derives the wallet/run identity from the session and cross-checks any supplied identifiers rather than trusting wallet strings in mutation bodies. If a deployment cannot use the same-origin cookie, it must explicitly use a bearer capability with the same minimum entropy, hash-only persistence, run/wallet/expiry binding, and no inclusion in proof payloads; this implementation uses the cookie design.

An exact successful-start retry may issue a fresh session cookie after re-validating the same signed start authorization; it must return the original run values and never create or increment another run. If a run session is lost and cannot be safely re-established through an authenticated flow, recovery and all post-start mutations fail closed rather than accepting `runId` plus wallet alone. Public daily status remains unauthenticated.

## 8. Server Mission Verification

`verifyExpeditionRun(authenticatedRunSession, runId, checkpointHash)` loads and locks the durable run, derives the wallet/run identity from the authenticated session, requires the acknowledged checkpoint, validates the immutable blueprint/version bindings, replays the full server action history, and derives mission truth. For Vault Breaker, the operation is called for final eligibility only after the product Vault seal has been verified against the trusted Vault checkpoint:

- Gem Runner: `gemsCollected >= 6 && hp > 0`;
- Chest Hunter: `chestsOpened >= 4 && hp > 0`;
- Vault Breaker gameplay stage: `objectiveReached == true && hp > 0`.

Malformed or mismatched requests do not mutate the run. A valid replay that proves death or a failed terminal result becomes `FAILED`. An alive incomplete run is only `ABANDONED` through explicit proof-aware leave. Exact finalization retries return the stored result; a different checkpoint/transcript history returns a stable terminal or mismatch error.

The server response, not the local HUD, controls reward eligibility. A client-local `MISSION_COMPLETE`, HP value, gem count, chest count, or Vault flag cannot create eligibility.

## 9. Run-Bound Product Vault Seal

The existing `NIMHUNT_VAULT_SEAL_PREVIEW` remains accepted only for its current development/integration behavior and is not sufficient for product reward authorization.

Add a strict product type `NIMHUNT_VAULT_SEAL_V1` with canonical payload:

```json
{
  "version": 1,
  "type": "NIMHUNT_VAULT_SEAL_V1",
  "wallet": "NQ...",
  "runId": "server-run-id",
  "mission": "vault-breaker",
  "world": "ANGKOR_RUINS",
  "room": "ROOM_01",
  "objective": "TEMPLE_VAULT",
  "runChallenge": "server-run-value",
  "rulesVersion": "nimhunt-rules-v1",
  "roomVersion": "angkor-room-01-v1",
  "blueprintVersion": "angkor-blueprint-v1",
  "blueprintId": "server-blueprint-id",
  "blueprintHash": "sha256-hex",
  "vaultCheckpointHash": "server-checkpoint-hash"
}
```

The server builds/returns authoritative fields. The client may display/sign them but cannot replace them. `vaultCheckpointHash` must identify an immutable acknowledged checkpoint on that run whose trusted replay state first proves `objectiveReached == true` and `hp > 0`.

The product Vault-seal preparation/submission requires the authenticated run session. The server derives the wallet/run identity from that session, verifies Nimiq signature/address binding, run/mission/challenge/version/blueprint binding, and that the checkpoint belongs to the exact run and proves the live Vault state. It persists the canonical Vault payload/hash and verified signature proof against that run. The later reward claim binds `vaultSealHash`, so a Vault proof from another run cannot satisfy this run.

The product ordering is:

```text
Vault reached
-> Vault checkpoint acknowledged
-> server confirms trusted Vault state
-> sign NIMHUNT_VAULT_SEAL_V1
-> server verifies run-bound Vault proof
-> finalize replay eligibility
-> prepare reward claim
-> sign reward claim
-> reserve accounting slot
```

## 10. Canonical Claim and Reservation

### 10.1 Claim preparation

`prepareRewardClaim(authenticatedRunSession, runId)` succeeds only when the session is bound to the run and wallet and:

- the run belongs to the wallet;
- replay finalization is `VERIFIED_ELIGIBLE` with a trusted transcript hash;
- the run is inside its original UTC-day claim window;
- no terminal claim outcome exists;
- Vault Breaker has a verified run-bound `NIMHUNT_VAULT_SEAL_V1`.

The server creates exactly one durable claim per run and generates a unique server `claimId`. Preparation retries return the same claim ID and byte-identical canonical string. The persisted string is immutable.

### 10.2 Canonical claim payload

Gem/Chest claims use this exact field set and omit `vaultSealHash` entirely:

```json
{
  "version": 1,
  "type": "NIMHUNT_REWARD_CLAIM",
  "claimId": "server-claim-id",
  "wallet": "NQ...",
  "runId": "server-run-id",
  "mission": "gem-runner",
  "dayKey": "2026-09-09",
  "runChallenge": "server-run-value",
  "transcriptHash": "sha256-hex",
  "rulesVersion": "nimhunt-rules-v1",
  "roomVersion": "angkor-room-01-v1",
  "blueprintVersion": "angkor-blueprint-v1",
  "blueprintId": "server-blueprint-id",
  "blueprintHash": "sha256-hex"
}
```

Vault claims append `vaultSealHash` in the fixed Vault claim schema. The server never accepts arbitrary nulls or client-selected optional fields. The claim binds the exact wallet, run, mission, UTC day, run challenge, transcript, rules, room, blueprint, and Vault proof where required.

### 10.3 Claim lifecycle and submission

Durable claim states are:

```text
PREPARED
RESERVED
SOLD_OUT
ALREADY_REWARDED
EXPIRED
```

Invalid signature submissions leave the claim `PREPARED` and retryable. After cryptographic verification succeeds, persist durable signature evidence including `signatureVerifiedAt`, `publicKey`, the signature or a protected proof reference, and a signature fingerprint bound to the exact claim hash. If the process fails after this evidence is persisted but before reservation finalization, an authenticated exact retry/recovery may continue the atomic reservation without forcing the wallet to sign the identical claim again. This recovery path never accepts a changed claim string or hash. `RESERVED`, `SOLD_OUT`, `ALREADY_REWARDED`, and `EXPIRED` are terminal; exact retries return the stored terminal result without slot allocation.

The client submits only the persisted canonical claim string, wallet, public key, and signature, with the authenticated run session also present. The server derives the wallet/run identity from the session, parses `claimId`, loads the stored claim, requires byte-for-byte canonical equality, verifies the Nimiq signature/address, checks the original UTC claim window, and invokes the atomic finalization operation. It does not accept client reservation numbers, remaining slots, eligibility, day overrides, transcript overrides, blueprint overrides, or Vault proof overrides. If valid persisted signature evidence already exists for the exact immutable claim, the authenticated recovery request may omit a new signature proof and continue finalization.

### 10.4 One transaction for claim and slot

The product ledger operation `reserveDailyReward(runId, wallet, claimId)` receives the durable wallet derived from the authenticated session and is backed by one Postgres `SECURITY DEFINER` RPC equivalent to `finalize_reward_claim(claim_id, wallet, expected_claim_hash)`. Separate remotely committed claim/update/reserve calls are not used.

Inside one database transaction, the RPC:

1. locks the claim, run, wallet/day state, and reward pool as required;
2. returns the stored result for an existing terminal claim before applying ordinary expiry checks;
3. requires `COMPLETED` plus `ELIGIBLE`, verified signature evidence for the exact claim hash, and all claim/run/wallet/day/hash bindings;
4. requires the verified run-bound Vault proof for Vault Breaker;
5. requires the run’s claim window to be open and the wallet not already rewarded;
6. increments `reserved_slots` only while it is below 69;
7. assigns `reservation_number`;
8. updates wallet and run reward state;
9. marks the claim `RESERVED` and persists the result;
10. commits all changes together.

If the pool is exhausted, it atomically marks the claim `SOLD_OUT` without incrementing. If the wallet already has a daily reservation, it atomically marks `ALREADY_REWARDED` without incrementing. The memory implementation mirrors the complete critical section under one mutex.

### 10.5 Claim window

A run belongs to the UTC day on which it was created. Its claim must complete before that run’s `nextResetAt`. After the boundary, proofs remain historical, but an unreserved claim becomes `EXPIRED` and returns `CLAIM_WINDOW_EXPIRED`; it cannot consume a later day’s pool. Server/database time controls this rule.

### 10.6 External results

The product exposes only:

```text
RESERVED
  reservationNumber
  remainingSlots
  totalSlots = 69

SOLD_OUT
ALREADY_REWARDED
CLAIM_WINDOW_EXPIRED
```

`RESERVED` means one daily accounting slot is reserved. It does not mean NIM was received, paid, transferred, confirmed, or reflected in a wallet balance.

## 11. Product Flow and Recovery

### 11.1 Separate state dimensions

Gameplay state is independent from proof/reward state.

Gameplay states:

```text
READY, PLAYING, MISSION_LOCAL_COMPLETE, VAULT_REACHED,
FAILED, ABANDONED, ENDED
```

Proof/reward states:

```text
NOT_APPLICABLE, PROOF_ACTIVE, CHECKPOINT_PENDING,
CHECKPOINT_SYNCED, PROOF_LOST, VERIFYING, VERIFIED_ELIGIBLE,
CLAIM_PREPARED, AWAITING_CLAIM_SIGNATURE, CLAIM_VERIFYING,
RESERVED, SOLD_OUT, ALREADY_REWARDED, CLAIM_WINDOW_EXPIRED,
REJECTED
```

Checkpoint requests run in the background. Movement is not frozen for every batch. When 16 accepted moves are unacknowledged, movement briefly pauses with `Syncing expedition...` until the queue advances.

`PROOF_LOST` is distinct from gameplay failure. It covers unrecoverable mismatch, lost history reconciliation, run state invalidation, or persistent backend failure. The UI says:

```text
Reward proof was interrupted.
You can keep exploring, but this run can no longer reserve today's treasure.
```

The run is not called `FAILED` unless server replay derives actual gameplay failure. No claim is prepared after proof loss. Where possible, the run is abandoned; if replay already proves death, it is failed.

### 11.2 Start and attempt UX

Before wallet authorization, public hunt status can show total/remaining slots and reset time without permission. Wallet-specific attempts show unknown/unavailable, for example:

```text
Connect when you start to check today's expeditions.
```

The fixture value `3 expeditions left` is never presented as live wallet state. After successful start, the app refreshes wallet daily status from the server.

### 11.3 Practice mode

Practice is a separate explicit route/session:

```text
PRACTICE RUN
No daily expedition used.
No NIM reward can be reserved.
```

Practice creates no durable reward run, consumes no attempt, sends no checkpoint, prepares no claim, and reserves no slot. An eligible run with lost proof is labeled `Continue without reward eligibility`, not silently converted to practice.

### 11.4 Leave, death, and completion

- Deliberate Leave flushes pending actions where practical, invokes proof-aware abandon, records `ABANDONED`, and destroys Phaser.
- Death flushes/finalizes acknowledged actions; server replay determines `FAILED`.
- Local mission completion stops mission gameplay, flushes pending actions, and requires server finalization before `VERIFIED_ELIGIBLE`.
- After verified replay, the UI says `Expedition verified` and waits for a deliberate `Reserve today's treasure` action before requesting the claim signature.
- A successful reservation says `Treasure slot reserved` and shows the number/count only.

### 11.5 Mobile recovery

Do not persist authoritative game outcome in local storage. If recovery identifiers are retained, they are limited to safe identifiers such as run ID and selected mission.

An explicit recovery operation such as `getActiveExpedition(authenticatedRunSession, runId)` derives the wallet/run identity from the session and returns server-trusted run status, mission, full bound blueprint, acknowledged sequence, checkpoint hash, replay snapshot, attempts state, and durable claim state. A resumed Phaser instance is rebuilt only from this trusted state. If safe recovery cannot be completed, the run is explicitly proof-lost/abandoned rather than resumed from a local HUD.

Reload during `CLAIM_PREPARED`, `RESERVED`, `SOLD_OUT`, or `ALREADY_REWARDED` reloads the same durable claim/result. It never creates a replacement claim or reservation.

## 12. HTTP Surface

Product proof endpoints are server-backed and validate body sizes before parsing. Concepts include:

```text
POST /api/expeditions/start-challenge
POST /api/expeditions/start
POST /api/expeditions/checkpoint
POST /api/expeditions/verify
POST /api/expeditions/abandon
POST /api/expeditions/vault-seal
GET  /api/expeditions/active
POST /api/rewards/prepare
POST /api/rewards/claim
GET  /api/daily-hunt-status
POST /api/wallet-daily-status
```

Every post-start endpoint in this list requires the authenticated run session, including checkpoint, verify/finalize, abandon, active recovery, Vault-seal preparation/submission, reward-claim preparation, and claim submission. The server derives the durable wallet/run identity from the session and only cross-checks supplied identifiers. The public daily-status read remains unauthenticated; wallet daily status is a read and never authorizes a run mutation.

The old low-level accounting primitives remain available to direct accounting tests and internal adapters, but no unauthenticated product HTTP path can mark completion or reserve a reward. Any compatibility dispatcher mode for existing accounting tests must be explicitly internal and is not registered as an external Vite route.

Every Postgres `SECURITY DEFINER` function uses an explicit safe `search_path`, schema-qualified protected table and function references, no unsafe dynamic SQL, and an explicit privilege policy. `EXECUTE` is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to the intended server/service role. The SQL/security test gate actively verifies these privileges rather than relying only on static inspection.

## 13. Testing and Verification Gates

### 13.1 Automated tests

Tests cover:

- canonical blueprint hash stability regardless of object-key order, with excluded identity/status/timestamp fields and domain-separated inputs;
- blueprint lifecycle, immutable published content, one active daily mission blueprint, replacement/retirement rules, fail-closed availability, Rules v1 mechanic rejection, and positive solvability search;
- valid Gem, Chest, and Vault replay;
- forged outcomes ignored/rejected, altered actions rejected by proof mismatch, invalid sequence/action cap, mission/run/wallet mismatch, and unsupported versions;
- checkpoint initial hashes, cumulative hash binding, stale mismatch, immutable history, exact batch retry before stale rejection, snapshot integrity/reconstruction, concurrent same-run serialization, bounded pending actions, authenticated sessions, and trusted final summaries;
- atomic start challenge binding including day and active-blueprint checks, midnight expiry, account selection, cancellation before attempt consumption, concurrent duplicate start, idempotent post-midnight start retry, daily limit, session issuance, and no partial run;
- run-bound product Vault seal, trusted Vault checkpoint binding, and rejection of a seal from another run;
- claim preparation idempotency, claim ID/string/hash/blueprint/transcript/wallet binding, authenticated sessions, retryable invalid signatures, durable signature crash recovery, claim expiry, one claim per run, and terminal-state retries;
- same-claim concurrency, two independent claims racing slot 69, one wallet racing two runs, sold-out behavior, and the 69-slot invariant;
- explicit practice/dev separation and route/UX state helpers.

All existing tests remain green. The required local commands are:

```text
npm test
npm run lint
npx tsc -b
npm run build
```

### 13.2 Postgres hard gate

When Supabase credentials are configured, apply `001_daily_ledger.sql` and the proof migration, then test the real database implementation. Required coverage includes:

- migrations apply successfully;
- published blueprint immutability and one-active-blueprint constraints are enforced by the database;
- blueprint content hash/identity separation, publication lifecycle, replacement/retirement policy, and unavailable-blueprint fail-closed behavior;
- atomic signed start and duplicate/concurrent challenge behavior, including day-boundary rejection and exact post-midnight retry;
- attempt count never exceeds three;
- authenticated run-session binding for checkpoint, verify, abandon, recovery, Vault proof, claim preparation, and claim submission;
- checkpoint concurrency, stale rejection, exact retry-before-stale behavior, immutable action history, and snapshot integrity;
- claim finalization and slot reservation occur in one transaction, including persisted signature evidence recovery;
- two independent database connections racing from `reserved_slots = 68` produce exactly one `RESERVED #69` and one `SOLD_OUT`;
- one wallet racing two eligible runs produces at most one reservation;
- pool never exceeds 69;
- expired claims cannot reserve;
- every `SECURITY DEFINER` function has an explicit safe search path, schema-qualified references, no unsafe dynamic SQL, and the required execute grants/revokes.

JavaScript mutex tests do not substitute for these Postgres tests.

### 13.3 Active RLS and privilege checks

Against configured Supabase, actively demonstrate that:

- anon cannot insert/update/delete protected tables;
- authenticated clients cannot insert/update/delete protected tables unless explicitly intended;
- protected `SECURITY DEFINER` functions are not callable by public/anon/authenticated roles;
- the service-role server path performs required operations;
- public status exposes only intended non-wallet-sensitive fields;
- no service-role key exists in browser output or `VITE_*` configuration;
- a denied unauthorized write is observed against the configured database.

An unauthorized write failure must be observed, not only inferred from SQL text.

### 13.4 Device and route gates

On a configured Nimiq Pay device, complete:

```text
mission brief
-> account selection
-> signed start authorization
-> exactly one durable attempt
-> server blueprint
-> background checkpoints
-> final flush and server verification
-> deliberate exact claim display/signature
-> server verification
-> accounting-only reservation
```

Confirm the reservation number and remaining count match the database and that no NIM transaction appears. For Vault, also complete the run-bound product Vault seal sequence.

Exercise account/signature cancellation, duplicate start retry including after midnight, tampered start, checkpoint interruption/mismatch, altered history, claim-signature cancellation, altered claim, exact reserved retry, cross-run Vault proof, expired claim, and mobile background/reload recovery. Recovery must restore trusted checkpoint/claim state or explicitly invalidate/abandon eligibility; it must never resume from a local HUD or local-storage outcome.

Verify:

- `/` is unchanged;
- `/play` does not prompt for a wallet and does not show fake wallet attempts;
- `/play?dev=nimiq` remains unchanged;
- `/play?dev=game` uses no durable attempts/checkpoints/claims;
- Practice consumes no attempt, sends no proof, and reserves no slot.

### 13.5 Final status report

The implementation report must include two explicit verdicts:

```text
IMPLEMENTATION: PASS | FAIL
POSTGRES + DEVICE VALIDATION: PASS | PENDING | FAIL
```

If Supabase credentials are absent, the second verdict is `PENDING`. No real NIM payout milestone may begin while it is pending.

### 13.6 Real-NIM readiness residual risk

`POSTGRES + DEVICE VALIDATION: PASS` proves the implemented accounting and device flow, but does not by itself mean NimHunt is economically safe to fund with real NIM. Before enabling payouts, separately define and verify:

- automation and bot-abuse policy;
- multi-wallet and Sybil-abuse policy;
- request authentication, rate limiting, and abuse protections;
- an isolated treasury/payout service;
- payout idempotency and reconciliation.

The public deterministic daily blueprint can be solved or automated. Wallet-per-day limits are not human or Sybil protection. This residual risk does not block the current accounting-only milestone.
