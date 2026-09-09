# Server-Verified Expedition Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authenticated, checkpointed, deterministically replayed expedition proof flow that accepts a signed claim and reserves an accounting-only daily slot without sending NIM.

**Architecture:** Keep Phaser and React separated from pure game rules. A pure replay engine consumes a server-bound daily blueprint and accepted `MOVE` actions. A proof service authenticates a run session, persists an immutable checkpoint chain, finalizes server-derived mission truth, verifies a run-bound Vault seal when required, and calls one atomic claim/slot transaction. Memory and Postgres adapters implement the same interfaces; the Vite network handler exposes only authenticated product operations.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Phaser 4, Vitest 5, Supabase Postgres, `@nimiq/mini-app-sdk` 0.1, `@nimiq/core` 2.21.

## Global Constraints

- Preserve all existing 191 tests and existing dev/integration behavior.
- `RULES_VERSION = "nimhunt-rules-v1"`.
- `ROOM_VERSION = "angkor-room-01-v1"`.
- `BLUEPRINT_VERSION = "angkor-blueprint-v1"`.
- `MAX_ACCEPTED_ACTIONS = 256`.
- `MAX_CHECKPOINT_BATCH_ACTIONS = 8`.
- `MAX_UNACKNOWLEDGED_ACTIONS = 16`.
- `MAX_TRANSCRIPT_BODY_BYTES = 16 * 1024`.
- Start challenge TTL is 5 minutes, capped at the next UTC midnight.
- Current Rules v1 accepts one Goblin and empty `timedHazards`; future mechanics require a new supported rules version.
- Blueprint content is immutable after publication; only lifecycle status may transition from `PUBLISHED` to `RETIRED`.
- No published blueprint is silently replaced after a reward-eligible run references it.
- Missing daily blueprints return `DAILY_BLUEPRINT_UNAVAILABLE`; there is no yesterday/current-client fallback.
- Post-start mutation and recovery operations require the authenticated run-session cookie; `runId` plus wallet is never authorization.
- The raw run-session capability is never persisted, hashed into proof payloads, or shown in UI.
- The existing `NIMHUNT_VAULT_SEAL_PREVIEW` verifier and dev flow remain unchanged.
- Product Vault reward proof uses strict `NIMHUNT_VAULT_SEAL_V1` bound to `runId` and `vaultCheckpointHash`.
- Canonical hashes use UTF-8, SHA-256, lowercase hex, explicit field ordering, and domain prefixes with no trailing newline.
- Reservation is accounting only. Do not add NIM transfer, treasury, payout amount, payout status, transaction hash, or seed/private-key code.
- Product `/` is untouched. `/play?dev=game` remains local-only and `/play?dev=nimiq` remains the existing integration surface.
- Required final commands are `npm test`, `npm run lint`, `npx tsc -b`, and `npm run build`.

## File Map

### Create

- `src/game/replay/versions.ts` - supported rules, room, blueprint, transcript, claim, and Vault proof versions.
- `src/game/replay/types.ts` - blueprint, action, replay state, transcript, checkpoint, and trusted summary types.
- `src/game/replay/canonical.ts` - explicit canonical serializers, domain-separated hashes, and deterministic field ordering.
- `src/game/replay/engine.ts` - pure `createInitialRun()` and `advanceRun()` state transitions.
- `src/game/replay/validator.ts` - positive state-space solvability validation and Rules v1 blueprint constraints.
- `src/game/replay/canonical.test.ts` - canonical serialization and hash tests.
- `src/game/replay/engine.test.ts` - deterministic gameplay and transcript fixtures.
- `src/game/replay/validator.test.ts` - positive solvability and invalid blueprint tests.
- `src/domain/expeditionProof.ts` - shared API paths, error codes, proof states, and product result types.
- `src/domain/productVaultSeal.ts` - strict run-bound product Vault payload and serializer.
- `src/domain/productVaultSeal.test.ts` - product Vault payload shape and canonicality tests.
- `server/expeditions/types.ts` - proof service/store interfaces and durable record types.
- `server/expeditions/errors.ts` - stable proof/session/claim errors.
- `server/expeditions/session.ts` - run-session capability generation, hashing, cookie parsing, and validation.
- `server/expeditions/crypto.ts` - shared strict Nimiq signed-message verification primitives.
- `server/expeditions/canonical.ts` - server-facing claim/start/Vault canonical parsing.
- `server/expeditions/memoryProofStore.ts` - mutex-protected proof, blueprint, session, checkpoint, and claim storage.
- `server/expeditions/proofService.ts` - start, checkpoint, finalization, Vault proof, claim preparation, and claim submission orchestration.
- `server/expeditions/http.ts` - authenticated product proof HTTP dispatcher and cookie responses.
- `server/expeditions/vitePlugin.ts` - Vite dev/preview middleware for proof routes.
- `server/expeditions/postgresProofStore.ts` - Supabase adapter for immutable proof records and atomic RPCs.
- `server/expeditions/blueprintBootstrap.ts` - validated current Room 01 bootstrap records for each supported mission.
- `server/expeditions/proofService.test.ts` - memory end-to-end proof flow and negative cases.
- `server/expeditions/checkpoint.test.ts` - checkpoint chain, snapshot, concurrency, and retry tests.
- `server/expeditions/start.test.ts` - start challenge and atomic retry tests.
- `server/expeditions/claim.test.ts` - Vault, claim, expiry, and reservation tests.
- `server/expeditions/http.test.ts` - cookie/session and product HTTP behavior.
- `server/ledger/sql/002_expedition_proof.sql` - blueprint, session, challenge, checkpoint, Vault proof, and claim schema/RPC migration.
- `server/ledger/proof.integration.test.ts` - real Supabase transaction, RLS, privilege, and concurrency tests.
- `src/api/expeditionProof.ts` - typed browser API client for product proof endpoints.
- `src/components/play/productFlow.ts` - product gameplay/proof state reducer and UI copy.
- `src/components/play/productFlow.test.ts` - product state transitions and practice separation.
- `src/components/play/useProductExpedition.ts` - authenticated start/checkpoint/finalization/claim orchestration.
- `src/components/play/useProductExpedition.test.ts` - cancellation, retry, proof loss, and recovery tests.
- `src/components/play/useProductVaultSeal.ts` - deliberate run-bound product Vault signing flow.

### Modify

- `src/game/world/room01.ts` - expose the current verified configuration as a baseline blueprint source without changing its gameplay values.
- `src/game/events/gameEvents.ts` - add accepted-action subscription and product blueprint initialization data while preserving dev bridge behavior.
- `src/game/createNimHuntGame.ts` - require a server blueprint for product mode and preserve fixed local dev mode.
- `src/game/scenes/AngkorDevScene.ts` - consume blueprint data through the pure engine while retaining existing rendering and animation.
- `src/components/play/useAngkorRun.ts` - expose accepted actions/checkpoint callbacks and server-trusted recovery state.
- `src/components/play/ExpeditionView.tsx` - render product proof states, verified outcome, signed claim, reservation, Vault flow, and proof-loss messaging.
- `src/components/play/ExpeditionView.module.css` - style exact payload, sync, proof-loss, and reservation states using the existing design system.
- `src/components/play/PlayShell.tsx` - start only through authenticated product flow, show real wallet status, and add explicit Practice Run.
- `src/components/play/MissionBrief.tsx` - remove fake attempt data and expose deliberate eligible start/practice actions.
- `src/components/play/PlayPage.tsx` - distinguish authorized product sessions, Practice, and dev routes.
- `src/components/play/expeditionFlow.ts` - add practice/proof route state and server-derived result helpers.
- `src/components/play/vaultSeal.ts` - retain preview reducer behavior and add product Vault proof state bindings.
- `src/types/play.ts` - add server run session and product result types.
- `src/domain/dailyLedger.ts` - add product proof paths/results without removing accounting constants.
- `src/integrations/nimiq/nimiqTypes.ts` - add generic signed-proof typing while preserving test seal types.
- `src/integrations/nimiq/verifySealTypes.ts` - retain dev verifier types and add product request types in a non-breaking way.
- `src/integrations/nimiq/verifySealClient.ts` - add product Vault verification client without changing dev verification.
- `src/integrations/nimiq/nimiqClient.ts` - expose explicit account selection support while preserving existing SDK calls.
- `server/verifyTreasureSeal.ts` - extract shared crypto verification only; preserve accepted dev/preview payload behavior and all existing results.
- `server/ledger/types.ts` - add claim-bound atomic reservation and durable run lookup interfaces.
- `server/ledger/memoryLedger.ts` - retain accounting tests and add proof-aware internal reservation binding.
- `server/ledger/postgresLedger.ts` - call the single claim finalization RPC for product reservations.
- `server/ledger/http.ts` - keep legacy accounting dispatcher internal and prevent it from being registered as an external product route.
- `server/ledger/vitePlugin.ts` - leave public status behavior intact and register only the intended accounting read/internal paths.
- `vite.config.ts` - register the product proof middleware.
- `server/ledger/postgres.integration.test.ts` - retain old accounting coverage and point real product races to the new proof fixture where required.
- `.env.example` - document server-only Supabase/proof integration variables without secrets.

## Task 1: Canonical Proof Primitives

**Files:**
- Create: `src/game/replay/versions.ts`
- Create: `src/game/replay/types.ts`
- Create: `src/game/replay/canonical.ts`
- Create: `src/game/replay/canonical.test.ts`
- Create: `src/domain/expeditionProof.ts`
- Modify: `src/domain/dailyLedger.ts`

**Interfaces:**
- Produces `RULES_VERSION`, `ROOM_VERSION`, `BLUEPRINT_VERSION`, `MAX_ACCEPTED_ACTIONS`, `MAX_CHECKPOINT_BATCH_ACTIONS`, `MAX_UNACKNOWLEDGED_ACTIONS`, and `MAX_TRANSCRIPT_BODY_BYTES`.
- Produces `serializeBlueprintHashPayload(payload)`, `hashBlueprint(payload)`, `serializeTranscript(transcript)`, `hashTranscript(transcript)`, `hashReplayState(state)`, `hashCheckpoint(checkpoint)`, `hashActionBatch(batch)`, and `hashClaim(payload)`.
- Produces `type MoveAction = { readonly seq: number; readonly type: 'MOVE'; readonly direction: Direction }`.
- Produces `type ExpeditionTranscript` with normalized `wallet`, `runId`, mission, all version/blueprint bindings, and ordered `actions`.
- Produces stable proof errors including `MALFORMED_TRANSCRIPT`, `ACTION_LIMIT_EXCEEDED`, `INVALID_SEQUENCE`, `INVALID_ACTION`, `UNSUPPORTED_RULES_VERSION`, `UNSUPPORTED_ROOM_VERSION`, `UNSUPPORTED_BLUEPRINT_VERSION`, `CHECKPOINT_MISMATCH`, `PROOF_LOST`, `DAILY_BLUEPRINT_UNAVAILABLE`, `START_CHALLENGE_DAY_EXPIRED`, `CLAIM_WINDOW_EXPIRED`, and claim/session errors.

- [ ] **Step 1: Write failing canonical/hash tests**

```ts
it('hashes equivalent blueprint payloads independent of object key order', () => {
  expect(hashBlueprint(payloadWithKeysInOrderA)).toBe(hashBlueprint(payloadWithKeysInOrderB))
})

it('excludes blueprint identity, lifecycle, timestamps, stored JSON, and self-hash', () => {
  expect(hashBlueprint(payloadWithId('blueprint-a'))).toBe(hashBlueprint(payloadWithId('blueprint-b')))
  expect(hashBlueprint(payloadWithStatus('PUBLISHED'))).toBe(hashBlueprint(payloadWithStatus('DRAFT')))
})

it('includes normalized wallet and complete bindings in transcript hash', () => {
  expect(hashTranscript({ ...transcript, wallet: compactWallet })).toBe(hashTranscript({ ...transcript, wallet: spacedWallet }))
  expect(hashTranscript({ ...transcript, actions: [{ seq: 1, type: 'MOVE', direction: 'UP' }] })).not.toBe(hashTranscript({ ...transcript, actions: [{ seq: 1, type: 'MOVE', direction: 'DOWN' }] }))
})

it('uses distinct hash domains and no trailing newline', () => {
  expect(hashReplayState(state)).not.toBe(hashTranscript(emptyTranscript))
  expect(serializeTranscript(emptyTranscript).endsWith('\n')).toBe(false)
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/game/replay/canonical.test.ts`

Expected: FAIL because the canonical types and serializers do not exist.

- [ ] **Step 3: Implement explicit serializers and hashes**

Use fixed object construction for every hash payload. `BlueprintHashPayload` must include rules/room/blueprint versions, day, mission, spawn, Goblins, gems, chests, items, hazards, puzzle coordinates, mission parameters, and `timedHazards`, while excluding `blueprintId`, `blueprintHash`, stored canonical JSON, lifecycle status, and database timestamps. Prefix each serialized payload with its exact `NIMHUNT:<DOMAIN>:v1\n` domain string before UTF-8 SHA-256 hashing.

- [ ] **Step 4: Run focused tests and the existing domain tests**

Run: `npx vitest run src/game/replay/canonical.test.ts src/game/domain/runState.test.ts`

Expected: PASS.

## Task 2: Pure Replay Engine

**Files:**
- Create: `src/game/replay/engine.ts`
- Create: `src/game/replay/engine.test.ts`
- Modify: `src/game/world/room01.ts`
- Modify: `src/game/domain/runState.ts`
- Modify: `src/game/systems/puzzle.ts`
- Modify: `src/game/systems/tileEntry.ts`
- Modify: `src/game/systems/chests.ts`
- Modify: `src/game/systems/goblin.ts`

**Interfaces:**
- Consumes `ExpeditionBlueprint`, `MissionType`, and existing pure systems from `src/game/systems/`.
- Produces `createInitialRun(input: InitialRunInput): ReplayState`.
- Produces `advanceRun(state: ReplayState, action: MoveAction): ReplayAdvanceResult`.
- Produces `replayActions(input: InitialRunInput, actions: readonly MoveAction[]): ReplayState` for server audit and blueprint validation.
- `ReplayAdvanceResult` includes `accepted`, immutable next state, and a blocked reason without client outcome fields.

- [ ] **Step 1: Add fixtures for valid Gem, Chest, Vault, hazard, puzzle, item, and Goblin sequences**

Cover the current verified values: 100 HP, spike -25, poison -20, Goblin collision -20, potion +25 clamped/not consumed at full HP, sword defeat, deterministic chests, boulder push, key/gate, and shrine reach. Assert that blocked moves do not mutate state and accepted actions advance one sequence.

- [ ] **Step 2: Run the replay tests to verify they fail**

Run: `npx vitest run src/game/replay/engine.test.ts`

Expected: FAIL because `ReplayState` and `advanceRun()` do not exist.

- [ ] **Step 3: Implement the engine as a pure composition of existing rules**

Adapt the current Room 01 constants into a baseline `ExpeditionBlueprint`. Use the same order as visible gameplay: validate movement/puzzle, commit tile entry, resolve sword/potion, open the destination chest, resolve pre-move Goblin collision, step Goblin, resolve post-move collision, and derive mission progress. Keep all visual animation outside the engine. Make a replay action accepted only when the existing movement/puzzle rules accept it.

- [ ] **Step 4: Run replay and all existing game-system tests**

Run: `npx vitest run src/game/replay/engine.test.ts src/game/systems src/game/domain`

Expected: PASS with existing gameplay assertions unchanged.

## Task 3: Blueprint Validation and Bootstrap

**Files:**
- Create: `src/game/replay/validator.ts`
- Create: `src/game/replay/validator.test.ts`
- Create: `server/expeditions/blueprintBootstrap.ts`
- Modify: `src/game/replay/types.ts`
- Modify: `src/game/world/room01.ts`

**Interfaces:**
- Produces `validateExpeditionBlueprint(blueprint): BlueprintValidationResult`.
- Produces `createBootstrapBlueprint(dayKey, mission): ExpeditionBlueprint` using current verified Room 01 values and a distinct server identity for each mission record.
- Produces `isSupportedRulesV1Blueprint(blueprint): boolean`.

- [ ] **Step 1: Write failing blueprint validation tests**

```ts
it('proves a winning sequence rather than only geometric reachability', () => {
  expect(validateExpeditionBlueprint(validGemBlueprint).valid).toBe(true)
})

it('rejects a blueprint with no surviving mission solution', () => {
  expect(validateExpeditionBlueprint(lethalBlueprint)).toMatchObject({ valid: false })
})

it('rejects Rules v1 multiple Goblins and timed hazards', () => {
  expect(validateExpeditionBlueprint({ ...validGemBlueprint, goblins: [goblin, goblin] }).reason).toBe('UNSUPPORTED_RULES_VERSION')
  expect(validateExpeditionBlueprint({ ...validGemBlueprint, timedHazards: [futureTrap] }).reason).toBe('UNSUPPORTED_RULES_VERSION')
})

it('requires a winning path within 256 accepted actions', () => {
  expect(validateExpeditionBlueprint(pathLongerThan256).reason).toBe('ACTION_LIMIT_EXCEEDED')
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/game/replay/validator.test.ts`

Expected: FAIL because validator and blueprint types are incomplete.

- [ ] **Step 3: Implement bounded state-space validation**

Search deterministic `advanceRun()` states with memoized canonical replay-state keys and a queue of action prefixes. Treat a mission as valid only when a state satisfies the exact server mission condition while alive. Reject invalid spawn/geometry, required objective overlap, impossible boulder/key/gate routes, lethal-only hazards/enemy paths, unsupported Rules v1 mechanics, and solutions beyond 256 accepted actions. Keep `timedHazards` empty for all current bootstrap records.

- [ ] **Step 4: Add bootstrap records without changing visible gameplay**

Create one validated/published-ready record per supported mission for a configured UTC day using current verified Room 01 configuration. The records carry mission-specific IDs and parameters so the registry never assumes one global object arrangement. Do not change current Room 01 gameplay values or add new mechanics.

- [ ] **Step 5: Run replay, validator, and existing world tests**

Run: `npx vitest run src/game/replay src/game/world`

Expected: PASS.

## Task 4: Durable Blueprint, Session, Challenge, Checkpoint, Vault, and Claim Schema

**Files:**
- Create: `server/ledger/sql/002_expedition_proof.sql`
- Modify: `server/ledger/sql/001_daily_ledger.sql` only if a non-breaking function grant/revoke dependency requires it
- Test: `server/ledger/dailyLedger.test.ts`

**Interfaces:**
- Produces tables for immutable blueprints, start challenges, run sessions, action batches/checkpoints, product Vault seals, and claims.
- Produces the atomic RPCs consumed by the adapters: `create_start_challenge`, `start_expedition_authorized`, `append_expedition_actions`, `finalize_expedition_run`, `store_product_vault_seal`, `prepare_reward_claim`, `finalize_reward_claim`, and `get_active_expedition`.

- [ ] **Step 1: Add SQL static security and shape assertions**

Assert migration text contains blueprint status transitions, partial uniqueness for one active published blueprint per day/mission, `day_key` challenge fields, run-session hash fields, immutable action-batch constraints, claim ID uniqueness, `reserved_slots < 69`, domain-bound proof fields, and no `payout`, `treasury`, `private_key`, `transfer`, or reward amount fields.

- [ ] **Step 2: Run SQL static tests to verify the new migration assertions fail**

Run: `npx vitest run server/ledger/dailyLedger.test.ts`

Expected: FAIL for the new assertions until the migration is authored.

- [ ] **Step 3: Author the proof migration**

Add:

```text
blueprint_status: DRAFT, VALIDATED, PUBLISHED, RETIRED
daily_expedition_blueprints: immutable content/hash/version/status and (day_key, mission_type) active uniqueness
expedition_start_challenges: challenge_hash, wallet, mission, day_key, blueprint_id/hash, created/expiry/consumed timestamps, run_id, authorization fingerprint
run_sessions: run_session_hash, run_id, wallet, created_at, expires_at, revoked_at
expedition_runs additions: room/blueprint bindings, run_challenge, checkpoint hashes/seq, replay snapshot, trusted final summary, verified_at
expedition_action_batches: run_id, sequence range, previous/current state/transcript/checkpoint hashes, batch fingerprint, canonical actions, derived snapshot, created_at
product_vault_seals: one run-bound canonical payload/hash, checkpoint hash, verified public key/signature/fingerprint/timestamp
expedition_claims: one claim_id per run, immutable canonical payload/hash, status, signature evidence, Vault hash, reservation result, timestamps
```

Use database constraints for enum/status values, normalized wallet length, exact versions where Rules v1 is active, one claim per run, one Vault proof per run, and immutable content columns. Permit only the controlled `PUBLISHED -> RETIRED` status transition after publication.

- [ ] **Step 4: Implement transaction functions with database-time and locks**

`start_expedition_authorized` must lock the challenge first, return the existing run for an exact consumed retry before current-day rejection, reject unused cross-midnight challenges, verify active published blueprint/day, lock wallet state, enforce three attempts, create run plus seq-zero checkpoint plus run challenge plus session binding, mark challenge consumed, and commit all writes together. `append_expedition_actions` must check exact committed-batch retry before stale hash rejection, then lock/run-check/append atomically. `finalize_reward_claim` must lock claim/run/wallet/day/pool and perform claim terminal state plus slot increment in one transaction.

- [ ] **Step 5: Harden every SECURITY DEFINER function**

Use an explicit safe `search_path`, schema-qualify every protected table/function reference, use no dynamic SQL, revoke execute from `PUBLIC`, `anon`, and `authenticated`, and grant execute only to the intended server role. Add no public write policy for proof tables.

- [ ] **Step 6: Run migration lint/static checks**

Run: `npx vitest run server/ledger/dailyLedger.test.ts`

Expected: PASS for the static constraints. Real application and privilege tests remain pending until Supabase credentials exist.

## Task 5: Memory Proof Store and Stable Service Errors

**Files:**
- Create: `server/expeditions/types.ts`
- Create: `server/expeditions/errors.ts`
- Create: `server/expeditions/memoryProofStore.ts`
- Create: `server/expeditions/proofService.ts`
- Create: `server/expeditions/start.test.ts`
- Create: `server/expeditions/checkpoint.test.ts`
- Modify: `server/ledger/types.ts`
- Modify: `server/ledger/memoryLedger.ts`

**Interfaces:**
- `issueStartChallenge(wallet, mission, now): Promise<StartChallengeResponse>`.
- `authorizeStart(signedStart, proof): Promise<StartResult>`.
- `appendRunActions(session, runId, previousCheckpointHash, actions): Promise<CheckpointAcknowledgement>`.
- `verifyExpeditionRun(session, runId, checkpointHash): Promise<VerifiedRunResult>`.
- `abandonExpedition(session, runId, checkpointHash): Promise<AbandonedRunResult>`.
- `prepareProductVaultSeal(session, runId): Promise<ProductVaultSealPayload>`.
- `submitProductVaultSeal(session, runId, signedProof): Promise<VaultSealVerificationResult>`.
- `prepareRewardClaim(session, runId): Promise<PreparedClaim>`.
- `submitRewardClaim(session, signedClaim): Promise<ReservationOutcome>`.
- `getActiveExpedition(session, runId): Promise<ActiveExpedition>`.

- [ ] **Step 1: Write failing memory start tests**

Cover selected wallet normalization, challenge day binding, blueprint identity binding, five-minute expiry, midnight cap, signature cancellation before service call, successful one-attempt start, exact duplicate start, altered duplicate rejection, and daily limit without a run.

- [ ] **Step 2: Run focused start tests to verify they fail**

Run: `npx vitest run server/expeditions/start.test.ts`

Expected: FAIL because the proof store/service does not exist.

- [ ] **Step 3: Implement the mutex-protected memory records**

Store only the run-session capability hash, never the raw capability. Store challenge hash and all durable bindings. Keep immutable action batches as the source of truth, with replay snapshots as checked optimizations. Use one mutex critical section for challenge consumption/run creation/session creation and for claim finalization/slot reservation.

- [ ] **Step 4: Write failing checkpoint tests**

Cover seq-zero hashes, batch size 8, total ceiling 256, pending window 16, stale `CHECKPOINT_MISMATCH`, exact retry before stale rejection, altered same-sequence batch rejection, immutable action history, snapshot hash mismatch reconstruction/fail-closed behavior, same-run concurrent serialization, and server-derived progress.

- [ ] **Step 5: Run focused checkpoint tests to verify they fail**

Run: `npx vitest run server/expeditions/checkpoint.test.ts`

Expected: FAIL until checkpoint append and immutable history are implemented.

- [ ] **Step 6: Implement checkpoint append and finalization**

Authenticate the session before any lookup. Detect an existing batch by `runId + previousCheckpointHash + canonical batch fingerprint` before ordinary stale rejection. Otherwise require `STARTED`, validate action sequence/versions/blueprint, validate the stored snapshot hash or rebuild from acknowledged batches, apply `advanceRun()`, persist the batch/snapshot/hashes under the mutex, and return only server-derived summary values. Finalization accepts only session/run/checkpoint identifiers, reconstructs all actions, replays from the immutable initial state, and applies explicit `COMPLETED`, `FAILED`, or `ABANDONED` classification.

- [ ] **Step 7: Run focused memory tests and the full server unit suite**

Run: `npx vitest run server/expeditions server/ledger`

Expected: PASS except intentionally skipped Postgres tests when credentials are absent.

## Task 6: Shared Nimiq Crypto and Authenticated Run Sessions

**Files:**
- Create: `server/expeditions/session.ts`
- Create: `server/expeditions/crypto.ts`
- Create: `server/expeditions/canonical.ts`
- Modify: `server/verifyTreasureSeal.ts` only to import shared crypto helpers
- Modify: `src/integrations/nimiq/nimiqTypes.ts`
- Modify: `src/integrations/nimiq/nimiqClient.ts`
- Test: `server/verifyTreasureSeal.test.ts`
- Test: `src/integrations/nimiq/nimiqClient.test.ts`

**Interfaces:**
- Produces `createRunSessionCapability()`, `hashRunSessionCapability()`, `serializeRunSessionCookie()`, `parseRunSessionCookie()`, and `requireRunSession()`.
- Produces `verifyNimiqSignedCanonicalMessage({ payload, wallet, publicKey, signature })` using existing `@nimiq/core` logic and signed-message prefix.
- Produces explicit account-selection support when `listAccounts()` returns more than one address.

- [ ] **Step 1: Add failing crypto/session tests**

Assert capability entropy is at least 32 random bytes, raw capability is absent from persisted records and proof hashes, cookie flags are `Secure`, `HttpOnly`, `SameSite=Strict`, and `runId + wallet` without a valid cookie is rejected. Preserve every existing dev verifier acceptance/rejection assertion.

- [ ] **Step 2: Run focused tests to verify failures**

Run: `npx vitest run server/verifyTreasureSeal.test.ts src/integrations/nimiq/nimiqClient.test.ts`

Expected: new session/crypto tests fail while existing verifier tests pass.

- [ ] **Step 3: Extract the crypto tail without changing old verifier behavior**

Move only address derivation, payload hash, Nimiq signed-message hash, public-key parsing, and signature verification into the shared helper. Keep old message-type parsing, environment checks, canonical preview serialization, result reasons, and response shape intact.

- [ ] **Step 4: Implement session capability and explicit account selection**

Generate a server-side random 256-bit capability on successful atomic start, persist only its hash/binding, and emit the secure same-origin cookie. Add a UI selection path for multiple accounts; capture the selected normalized wallet and reuse it for challenge creation and signing without silently switching.

- [ ] **Step 5: Run focused tests and existing Nimiq tests**

Run: `npx vitest run server/verifyTreasureSeal.test.ts src/integrations/nimiq`

Expected: PASS with unchanged preview/dev behavior.

## Task 7: Atomic Start Authorization Service

**Files:**
- Modify: `server/expeditions/proofService.ts`
- Modify: `server/expeditions/memoryProofStore.ts`
- Modify: `src/api/expeditionProof.ts`
- Create: `server/expeditions/start.test.ts` additions
- Modify: `src/domain/expeditionProof.ts`

**Interfaces:**
- Start payload shape is exactly `version`, `type`, `wallet`, `mission`, `dayKey`, `challenge`, `blueprintId`, and `blueprintHash`.
- Start result contains `runId`, `runChallenge`, `attemptsRemaining`, all three version values, blueprint ID/hash/full data, `dayKey`, and `nextResetAt`.
- Stable start outcomes are `START_CREATED`, `START_ALREADY_CREATED`, `START_CHALLENGE_EXPIRED`, `START_CHALLENGE_DAY_EXPIRED`, `START_CHALLENGE_INVALID`, `DAILY_EXPEDITION_LIMIT_REACHED`, and `DAILY_BLUEPRINT_UNAVAILABLE`.

- [ ] **Step 1: Add failing start authorization assertions**

Test wrong wallet/address, changed mission/day/blueprint, invalid signature, challenge expiry, cross-midnight unused challenge, missing daily blueprint, active publication replacement, account cancellation, exact retry after midnight, duplicate concurrent submission, and rollback when a required write fails.

- [ ] **Step 2: Run focused tests to verify failures**

Run: `npx vitest run server/expeditions/start.test.ts`

Expected: FAIL for the new cases.

- [ ] **Step 3: Implement challenge issuance**

Normalize the explicitly selected wallet, select the active published validated blueprint for the current database UTC day, set expiry to `min(created_at + 5 minutes, next UTC midnight)`, persist the challenge hash and all bindings, and return only challenge metadata. Return `DAILY_BLUEPRINT_UNAVAILABLE` if there is no active published validated record.

- [ ] **Step 4: Implement signed start verification and atomic completion**

Strictly parse and canonicalize the start payload. Verify the signature/address and require signed blueprint/day values to equal the challenge and active publication. In one store operation lock the challenge, first handle exact consumed idempotency, then enforce day/expiry/blueprint/current-wallet limits, create the run/seq-zero checkpoint/run challenge/session, consume the challenge, and return the stored result. Do not expose the capability in the response body.

- [ ] **Step 5: Run start tests and existing ledger tests**

Run: `npx vitest run server/expeditions/start.test.ts server/ledger/dailyLedger.test.ts`

Expected: PASS; existing low-level accounting tests remain green.

## Task 8: Run-Bound Product Vault Seal

**Files:**
- Create: `src/domain/productVaultSeal.ts`
- Create: `src/domain/productVaultSeal.test.ts`
- Create: `src/components/play/useProductVaultSeal.ts`
- Modify: `src/components/play/vaultSeal.ts`
- Modify: `src/components/play/useVaultSeal.ts` only where shared reducer behavior is reused
- Modify: `src/integrations/nimiq/verifySealClient.ts`
- Modify: `server/expeditions/proofService.ts`
- Create: `server/expeditions/claim.test.ts` additions

**Interfaces:**
- Produces `buildProductVaultSealPayload(serverFields)` and `serializeProductVaultSeal(payload)` for strict `NIMHUNT_VAULT_SEAL_V1`.
- Product payload fields are `version`, `type`, `wallet`, `runId`, `mission`, `world`, `room`, `objective`, `runChallenge`, `rulesVersion`, `roomVersion`, `blueprintVersion`, `blueprintId`, `blueprintHash`, and `vaultCheckpointHash` in fixed order.
- Product Vault operation requires the authenticated run session and a checkpoint whose trusted state first proves `objectiveReached && hp > 0`.

- [ ] **Step 1: Write failing product Vault tests**

Cover strict field ordering, changed run/challenge/blueprint/checkpoint rejection, Vault seal from another run, checkpoint not proving alive Vault reach, invalid signature, wallet mismatch, and successful proof persistence. Assert the existing preview type still passes all old tests.

- [ ] **Step 2: Run focused tests to verify failures**

Run: `npx vitest run src/domain/productVaultSeal.test.ts server/expeditions/claim.test.ts server/verifyTreasureSeal.test.ts`

Expected: product tests fail while old preview tests pass.

- [ ] **Step 3: Implement strict product payload and server verification**

Build authoritative fields only from the durable run and selected checkpoint. Parse/re-serialize the product payload, verify address/signature, require session/run binding, require `mission === 'vault-breaker'`, require exact version/blueprint/run challenge, and require the checkpoint hash to belong to the run and contain the server-derived live Vault state. Store canonical payload/hash and verified proof against that run.

- [ ] **Step 4: Wire the deliberate product signing flow**

At Vault reach, flush the checkpoint chain, request the server product payload, display the exact serialized message, then call the existing Nimiq provider signer only after the player taps the seal CTA. Send the proof through the authenticated product endpoint. Keep preview/dev signing separate.

- [ ] **Step 5: Run Vault and Nimiq tests**

Run: `npx vitest run src/domain/productVaultSeal.test.ts src/components/play/vaultSeal.test.ts server/expeditions/claim.test.ts server/verifyTreasureSeal.test.ts`

Expected: PASS.

## Task 9: Durable Claim Preparation and Atomic Reservation

**Files:**
- Modify: `server/expeditions/proofService.ts`
- Modify: `server/expeditions/memoryProofStore.ts`
- Modify: `server/ledger/types.ts`
- Modify: `server/ledger/memoryLedger.ts`
- Modify: `server/ledger/postgresLedger.ts`
- Create: `server/expeditions/claim.test.ts`
- Modify: `src/api/expeditionProof.ts`
- Modify: `src/domain/expeditionProof.ts`

**Interfaces:**
- `prepareRewardClaim(session, runId)` returns `claimId`, immutable canonical payload, claim hash, and `PREPARED` state.
- Gem/Chest payload omits `vaultSealHash`; Vault payload includes it.
- `submitRewardClaim(session, { payload, publicKey, signature })` returns `RESERVED`, `SOLD_OUT`, `ALREADY_REWARDED`, or `CLAIM_WINDOW_EXPIRED`.
- Durable states are `PREPARED`, `RESERVED`, `SOLD_OUT`, `ALREADY_REWARDED`, and `EXPIRED`.

- [ ] **Step 1: Write failing claim tests**

Test one claim per run, preparation idempotency, claim ID/string/hash binding, altered transcript/blueprint/day/run challenge rejection, wrong wallet/session rejection, invalid signature leaves `PREPARED`, persisted signature evidence recovery, Vault seal requirement/cross-run rejection, expiry, exact terminal retries, same-claim concurrency, two claims racing slot 69, and one wallet racing two eligible runs.

- [ ] **Step 2: Run claim tests to verify failures**

Run: `npx vitest run server/expeditions/claim.test.ts`

Expected: FAIL until claim persistence/finalization exists.

- [ ] **Step 3: Implement immutable claim preparation**

Require authenticated session, `COMPLETED + ELIGIBLE + verified_at`, trusted transcript hash, open original UTC-day window, and run-bound product Vault proof where required. Generate one server claim ID and persist the exact canonical payload. Return the stored claim on exact retry.

- [ ] **Step 4: Implement signature evidence and crash recovery**

On a valid signature, persist `signatureVerifiedAt`, public key, signature/protected proof reference, and fingerprint bound to the exact claim hash before finalization. If finalization fails afterward, an authenticated exact retry may use the stored valid evidence. Invalid signatures do not change `PREPARED`.

- [ ] **Step 5: Extend the ledger reservation interface**

Keep old direct accounting test calls working, but require `claimId` on the product path. Product `reserveDailyReward(runId, wallet, claimId)` passes the durable session-derived wallet and expected claim hash into the one claim finalization operation. No product route calls the old unauthenticated complete/reserve surface.

- [ ] **Step 6: Implement one-transaction finalization in memory**

Under one mutex, return stored terminal results first, validate persisted signature evidence and all run/claim bindings, require Vault proof, enforce current claim day and wallet reward limit, increment the pool only below 69, assign the reservation number, update wallet/run/claim state, and persist the result. Mark `SOLD_OUT`, `ALREADY_REWARDED`, or `EXPIRED` without slot allocation as specified.

- [ ] **Step 7: Run claim, ledger, and replay tests**

Run: `npx vitest run server/expeditions server/ledger src/game/replay`

Expected: PASS.

## Task 10: Postgres Adapter and Real Transaction Functions

**Files:**
- Create: `server/expeditions/postgresProofStore.ts`
- Modify: `server/ledger/postgresLedger.ts`
- Modify: `server/ledger/postgres.integration.test.ts`
- Create: `server/ledger/proof.integration.test.ts`
- Modify: `server/ledger/config.ts` only for server-only integration configuration validation

**Interfaces:**
- Postgres adapter implements every `server/expeditions/types.ts` store method with Supabase service-role access only.
- Product reservation uses one RPC call to `finalize_reward_claim`; it does not chain separate claim update and `reserve_daily_reward` calls.

- [ ] **Step 1: Add skipped-until-configured integration fixtures**

Use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `NIMHUNT_LEDGER_INTEGRATION=1` exactly as existing tests do. Generate test wallets with `KeyPair.generate()`. Ensure tests are skipped only when configuration is absent and report that status clearly.

- [ ] **Step 2: Add migration-application test instructions**

Run the migrations in order against the configured Supabase project:

```text
server/ledger/sql/001_daily_ledger.sql
server/ledger/sql/002_expedition_proof.sql
```

Do not use Drizzle push or any destructive reset command.

- [ ] **Step 3: Implement the Supabase adapter**

Convert RPC results through strict parsers. Map database stable errors to domain errors. Use server/database timestamps and preserve exact canonical payload/hash values. Never put service-role configuration in browser imports.

- [ ] **Step 4: Add real Postgres concurrency coverage**

Open independent Supabase clients/connections for:

- duplicate/concurrent same challenge, asserting one run and one attempt;
- attempt count ceiling of three;
- checkpoint batches from the same prior hash, asserting one advance and exact retry behavior;
- stale checkpoint cannot rewrite history;
- claim finalization with signature evidence in one transaction;
- two independent claims from `reserved_slots = 68`, asserting exactly one `RESERVED #69` and one `SOLD_OUT`;
- two eligible runs for one wallet, asserting at most one `RESERVED`;
- expired claim cannot reserve.

- [ ] **Step 5: Run configured integration tests**

Run: `NIMHUNT_LEDGER_INTEGRATION=1 npx vitest run server/ledger/proof.integration.test.ts server/ledger/postgres.integration.test.ts`

Expected when configured: PASS against the actual database. Without credentials: skipped and reported `POSTGRES VALIDATION: PENDING`.

## Task 11: Authenticated Product HTTP and Browser API

**Files:**
- Create: `server/expeditions/http.ts`
- Create: `server/expeditions/vitePlugin.ts`
- Create: `server/expeditions/http.test.ts`
- Create: `src/api/expeditionProof.ts`
- Modify: `vite.config.ts`
- Modify: `server/ledger/http.ts`
- Modify: `server/ledger/vitePlugin.ts`
- Modify: `src/domain/expeditionProof.ts`

**Interfaces:**
- Product paths are `/api/expeditions/start-challenge`, `/api/expeditions/start`, `/api/expeditions/checkpoint`, `/api/expeditions/verify`, `/api/expeditions/abandon`, `/api/expeditions/active`, `/api/expeditions/vault-seal`, `/api/rewards/prepare`, and `/api/rewards/claim`.
- Public `GET /api/daily-hunt-status` remains unauthenticated.
- Wallet daily status remains a read and never authorizes mutation.
- Product mutation responses use `cache-control: no-store`, `x-content-type-options: nosniff`, JSON content type, and body limits.

- [ ] **Step 1: Write failing HTTP tests**

Cover missing/invalid cookie, cookie for another run, wallet body mismatch, oversized body, malformed JSON, wrong method, public status without cookie, proof-loss/error mapping, `Set-Cookie` flags on successful start, exact start retry returning the original run, and internal legacy accounting routes not registered by the Vite product plugin.

- [ ] **Step 2: Run focused HTTP tests to verify failures**

Run: `npx vitest run server/expeditions/http.test.ts`

Expected: FAIL until middleware and browser client exist.

- [ ] **Step 3: Implement cookie/session middleware**

Parse the `Secure; HttpOnly; SameSite=Strict` run-session cookie, require it for all post-start operations, derive wallet/run identity from it, and pass only server-derived identity to the proof service. Set the cookie only after the atomic start operation succeeds. On exact start retry, reissue a fresh capability cookie while returning unchanged run fields.

- [ ] **Step 4: Register product middleware and close legacy network writes**

Register the proof plugin in `vite.config.ts`. Keep old direct accounting methods for tests/internal adapters, but do not register unauthenticated completion/reservation routes as product HTTP paths. Preserve public status and dev verifier middleware.

- [ ] **Step 5: Implement typed browser clients**

Use same-origin `fetch` with `credentials: 'same-origin'`. Parse every response strictly. Never serialize client HUD outcomes, wallet overrides, slot numbers, or blueprint replacement data into mutation requests.

- [ ] **Step 6: Run HTTP and ledger tests**

Run: `npx vitest run server/expeditions/http.test.ts server/ledger`

Expected: PASS.

## Task 12: Phaser Accepted-Action and Recovery Integration

**Files:**
- Modify: `src/game/events/gameEvents.ts`
- Modify: `src/game/createNimHuntGame.ts`
- Modify: `src/game/scenes/AngkorDevScene.ts`
- Modify: `src/components/play/useAngkorRun.ts`
- Modify: `src/components/play/ExpeditionView.tsx`
- Create: `src/components/play/useProductExpedition.ts`
- Create: `src/components/play/useProductExpedition.test.ts`

**Interfaces:**
- Product `createNimHuntGame()` receives `{ mode: 'product'; mission; blueprint; runId; initialTrustedState? }`.
- Dev `createNimHuntGame()` receives `{ mode: 'dev'; mission }` and uses the current local baseline.
- The bridge emits an accepted action only after the pure movement/puzzle validation accepts it.
- `useProductExpedition` owns the queued action batches, previous checkpoint hash, 16-action backpressure, flushes, finalization, recovery, and proof state.

- [ ] **Step 1: Add failing accepted-action bridge tests**

Assert blocked moves emit no action, an accepted move emits exactly one `{ seq, type: 'MOVE', direction }`, reset/dev mode emits no product checkpoint, and unmount destroys the game without wallet calls from Phaser.

- [ ] **Step 2: Run focused bridge tests to verify failures**

Run: `npx vitest run src/game/events/gameEvents.test.ts src/components/play/useProductExpedition.test.ts`

Expected: new product tests fail while current bridge tests remain green.

- [ ] **Step 3: Refactor scene transitions to share pure blueprint/engine semantics**

Keep existing animation, camera, textures, and HUD output. Replace direct constant-only state initialization in product mode with the server blueprint. Record the accepted action at validation time, not blocked input, and do not wait on network in the Phaser scene.

- [ ] **Step 4: Implement bounded background checkpoint queue**

Queue accepted actions in batches of eight. Send batches sequentially with the authenticated cookie and previous checkpoint hash. Permit at most 16 unacknowledged actions; at the ceiling, stop accepting new movement briefly and show `Syncing expedition...`. Retry exact requests idempotently. On unrecoverable mismatch/backend failure, enter `PROOF_LOST` and never substitute local outcomes.

- [ ] **Step 5: Implement terminal flush and recovery**

Flush before Gem/Chest finalization, death, Vault reach, leave, and page transition where practical. On recovery, request the active run with the session and rebuild Phaser from server-trusted blueprint/replay snapshot/acknowledged sequence. Do not read localStorage for outcome or state. If recovery cannot authenticate safely, fail closed.

- [ ] **Step 6: Run game and product hook tests**

Run: `npx vitest run src/game src/components/play/useProductExpedition.test.ts`

Expected: PASS with all existing scene/entity/system tests green.

## Task 13: Product `/play` Flow, Claim UI, Practice, and Mobile States

**Files:**
- Create: `src/components/play/productFlow.ts`
- Create: `src/components/play/productFlow.test.ts`
- Create: `src/components/play/useProductVaultSeal.ts`
- Modify: `src/components/play/PlayShell.tsx`
- Modify: `src/components/play/MissionBrief.tsx`
- Modify: `src/components/play/PlayPage.tsx`
- Modify: `src/components/play/ExpeditionView.tsx`
- Modify: `src/components/play/ExpeditionView.module.css`
- Modify: `src/components/play/expeditionFlow.ts`
- Modify: `src/types/play.ts`
- Modify: `src/components/play/vaultSeal.ts`
- Modify: `src/components/play/VaultSealOverlay.tsx`
- Modify: `src/components/play/HuntStatus.tsx`
- Modify: `src/components/play/huntStatusView.ts`

**Interfaces:**
- Product gameplay and proof state are separate dimensions.
- Product Start invokes explicit account selection, challenge, start signing, and API start before adding the authorized run route.
- Practice route/session is visibly labeled and never uses proof APIs.
- UI strings include `Expedition verified`, `Reserve today's treasure`, `Reward proof was interrupted.`, `Treasure slot reserved`, `SOLD_OUT`, `ALREADY_REWARDED`, and `CLAIM_WINDOW_EXPIRED` without implying payment.

- [ ] **Step 1: Write failing product state tests**

Cover `PLAYING + CHECKPOINT_PENDING`, `PLAYING + CHECKPOINT_SYNCED`, `PROOF_LOST` without gameplay failure, local completion waiting for server verification, start cancellation with zero consumed attempts, claim cancellation with `PREPARED`, explicit Practice, and restoration of `RESERVED`/`SOLD_OUT`/`ALREADY_REWARDED`.

- [ ] **Step 2: Run focused UI-state tests to verify failures**

Run: `npx vitest run src/components/play/productFlow.test.ts src/components/play/expeditionFlow.test.ts`

Expected: new state tests fail before product wiring.

- [ ] **Step 3: Implement explicit start and practice navigation**

Remove fixture attempt display from product mission briefs. Show wallet attempts as unavailable before deliberate connection. Keep public hunt status independent. Add a separate `?practice=<mission>` route. Do not auto-request a wallet on `/play` load. Do not let a manually typed `?run=<mission>` launch an eligible product run without a valid server session/start context.

- [ ] **Step 4: Implement product result and claim UI**

After server finalization, show `Expedition verified`; do not request claim signing automatically. On `Reserve today's treasure`, fetch/restore the persisted canonical claim, display the exact serialized payload, request the deliberate Nimiq signature, submit it, and render only accounting outcomes. Show the stored reservation number/count on exact retry.

- [ ] **Step 5: Implement Vault ordering and proof-loss UX**

Use `Vault reached -> acknowledged checkpoint -> trusted Vault state -> product Vault seal -> final eligibility -> claim -> reservation`. Lock gameplay only for seal/finalization/result/leave actions, not each checkpoint batch. Show proof loss as ineligible but not failed. Let the player continue locally only with clear non-reward wording.

- [ ] **Step 6: Implement mobile reload/recovery behavior**

Retain only safe recovery identifiers if needed. Query server-trusted active run/claim state after an explicit recovery action. Restore claim terminal states exactly. If the run session is unavailable, fail closed and offer Practice or explicit abandonment; never resume from a local HUD.

- [ ] **Step 7: Run UI and accessibility tests**

Run: `npx vitest run src/components/play`

Expected: PASS. Verify focus management, readable payload/error text, 44px controls, keyboard behavior, and existing design-system styles remain intact.

## Task 14: Postgres RLS, Privilege, Route, and Forbidden-Scope Verification

**Files:**
- Modify: `server/ledger/proof.integration.test.ts`
- Modify: `server/ledger/dailyLedger.test.ts`
- Modify: `server/expeditions/http.test.ts`
- Modify: `server/verifyTreasureSeal.test.ts` only for preserved regression coverage
- Modify: `.env.example`

**Interfaces:**
- Produces the two final verdict inputs: `IMPLEMENTATION` and `POSTGRES + DEVICE VALIDATION`.

- [ ] **Step 1: Add active RLS/privilege tests**

Against configured Supabase, use anon and authenticated clients to attempt INSERT/UPDATE/DELETE on proof and ledger tables and call protected RPCs. Assert denial. Use service-role client to assert required operations succeed. Inspect public status response to ensure it contains no wallet-sensitive fields.

- [ ] **Step 2: Add security configuration assertions**

Assert no service-role key is in `dist` or any `VITE_*` configuration. Assert every `SECURITY DEFINER` function has explicit safe search path, schema-qualified references, no unsafe dynamic SQL, and intended execute grants only.

- [ ] **Step 3: Add route/UX smoke tests**

Verify `/`, `/play`, `/play?dev=nimiq`, `/play?dev=game`, and Practice behavior. Confirm `/` output is unchanged, `/play` does not prompt for a wallet, dev game has no durable proof traffic, and Practice consumes no attempt/proof/slot.

- [ ] **Step 4: Add forbidden-scope scan**

Search repository changes and built output for treasury private keys, seed phrases, NIM send/transfer calls, payout workers/amounts/status/tx hashes, chance-based reward selection, collapsing-boulder implementation, new rooms/enemies, and marketing modifications. The only reward action permitted is accounting-only slot reservation.

- [ ] **Step 5: Run automated verification**

Run:

```text
npm test
npm run lint
npx tsc -b
npm run build
```

Expected: all automated tests pass; Postgres tests are either green when configured or explicitly skipped with `POSTGRES VALIDATION: PENDING`.

## Task 15: Final Device and Supabase Gate

**Files:**
- Modify: `.agent-state/project-state.md`
- Modify: `.agent-state/memory.md`
- Modify: `.agent-state/left-off.md`

**Interfaces:**
- Produces final implementation report with `IMPLEMENTATION: PASS | FAIL` and `POSTGRES + DEVICE VALIDATION: PASS | PENDING | FAIL`.

- [ ] **Step 1: Apply migrations when credentials are available**

Apply `server/ledger/sql/001_daily_ledger.sql` and `server/ledger/sql/002_expedition_proof.sql` with the configured Supabase project. Do not expose credentials or write them to Git.

- [ ] **Step 2: Run real Postgres tests and final-slot race**

Run: `NIMHUNT_LEDGER_INTEGRATION=1 npx vitest run server/ledger/proof.integration.test.ts server/ledger/postgres.integration.test.ts`

Require the two-connection race from 68 reserved slots to produce one `RESERVED #69` and one `SOLD_OUT`, and require one-wallet/two-run race to produce at most one reservation.

- [ ] **Step 3: Run configured Nimiq Pay device flow**

Complete Gem Runner at minimum:

```text
mission brief
-> deliberate account selection
-> signed start authorization
-> one durable attempt
-> server blueprint
-> background action checkpoints
-> final flush
-> server VERIFIED_ELIGIBLE
-> deliberate exact claim display
-> Nimiq claim signature
-> server verification
-> accounting-only RESERVED result
```

Verify reservation number/remaining count against the database and verify that no NIM transaction appears. Repeat cancellation, duplicate start retry, tampered transcript, claim retry, and proof-loss cases. Complete the additional run-bound Vault seal sequence for Vault Breaker.

- [ ] **Step 4: Update continuity state**

Record the implementation phase, changed paths, automated results, Postgres result, device result, credential blocker if any, and next action. Keep `POSTGRES + DEVICE VALIDATION: PENDING` when credentials or device verification are unavailable.

- [ ] **Step 5: Report residual payout risk**

State explicitly that even a passing Postgres/device gate does not make real-NIM funding economically safe. Before a future payout milestone, separately verify bot policy, Sybil/multi-wallet policy, request/rate-limit protections, isolated treasury/payout service, and payout idempotency/reconciliation. Do not implement any of those systems in this milestone.

## Plan Self-Review Checklist

- [ ] Pure replay uses existing movement, hazards, gems, puzzle, Goblin, item, chest, and mission rules without Phaser/DOM imports.
- [ ] Full client blueprint access is allowed, while server blueprint binding and hash are authoritative.
- [ ] Blueprint hash excludes ID, self-hash, stored JSON string, lifecycle status, and database timestamps.
- [ ] Canonical transcript includes normalized wallet and all blueprint bindings.
- [ ] Rules v1 rejects multiple Goblins, timed hazards, and unimplemented transitions.
- [ ] Blueprint validator proves a complete winning action sequence within 256 actions.
- [ ] Start challenge expiry is capped at UTC midnight and signed payload includes day/blueprint identity.
- [ ] Atomic start handles concurrent duplicate submission and exact post-midnight retry.
- [ ] Authenticated run session is required for every post-start mutation/recovery operation.
- [ ] Checkpoint retry detection happens before stale-checkpoint rejection.
- [ ] Immutable action history is source of truth; snapshots are integrity-checked optimizations.
- [ ] Local gameplay remains responsive with 8-action batches and a 16-action unacknowledged ceiling.
- [ ] Proof loss is not mislabeled as gameplay failure.
- [ ] Product Vault proof is run-bound and uses `NIMHUNT_VAULT_SEAL_V1`; preview/dev behavior is preserved.
- [ ] Claims have one immutable claim ID/string per run and durable signature crash recovery.
- [ ] Claim and 69-slot reservation commit in one Postgres transaction.
- [ ] Daily claim expiry cannot reserve a later day.
- [ ] Practice/dev flows cannot consume attempts, checkpoints, claims, or slots.
- [ ] Real Postgres/RLS/device verification is distinct from implementation completion.
- [ ] No payout or treasury scope is present.
