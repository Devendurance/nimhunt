# NimHunt - Durable Memory

> Last reviewed: 2026-09-17

This file stores decisions and lessons that should survive future sessions. It is not a replacement for the canonical product or architecture documents.

## Verified live status

FULL LIVE E2E:
PASS

MAINNET PAYOUT:
PASS (historical 10,000 Luna + authorized beta 10,000,000 Luna)

PAYOUT AUTOMATION:
IMPLEMENTED, DISABLED

BETA REWARD AMOUNT:
100 NIM = 10,000,000 Luna

LIVE 010:
PASS

## Automatic payout pipeline

- Automatic execution requires ALL of: `NIMHUNT_PAYOUT_NETWORK=mainnet`, `NIMHUNT_ENABLE_MAINNET_PAYOUT=true`, `NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=true`, and DB `payout_automation_control.automatic_payouts_enabled` (default OFF).
- `reward_payouts.day_key` is reservation UTC day (69-slot economics). Do not treat it as treasury spend day.
- `reward_payouts.execution_day_key` is the UTC day a payout is committed for execution (set on acquire). Daily treasury cap uses this field.
- Committed execution spend: PROCESSING + SUBMITTED + CONFIRMED + FAILED_FINAL with tx_hash. PENDING is not spent.
- `010_payout_execution_day.sql` is applied live. This environment has no DDL path (`DATABASE_URL` / `SUPABASE_ACCESS_TOKEN` absent); live objects were already present and were not replayed.
- Historical 0.1 NIM `d19bf406-2b81-4c5a-b271-da8eb7587cbd`: reservation 2026-09-16 / execution 2026-09-16 / CONFIRMED 10,000 Luna / tx `c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6`.
- Authorized beta 100 NIM `14d204b5-5ced-477b-b626-05cfdbe29e1c`: reservation 2026-09-16 / execution 2026-09-17 / CONFIRMED 10,000,000 Luna / tx `f93d6a1e169182f0b3400daa70e3f9557d11dda1bdfb975541c5747f0d05f4fd`.
- Live 2026-09-17 execution committed = 10,000,000 Luna. Remaining under 690,000,000 = 680,000,000 Luna.
- Two live disabled scheduler cycles ran 2026-09-17 (same runPayoutWorker path, both switches OFF): DISABLED, signed 0, broadcast 0, rows stayed 2, last_cycle_result=DISABLED recorded. No NIM sent.
- CORRECTION 2026-09-17: Vercel Cron DOES send `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set. Previous "cannot attach Bearer" conclusion was wrong. Canonical production secret is now CRON_SECRET; NIMHUNT_PAYOUT_CRON_SECRET is a local/dev alias only (CRON_SECRET wins). VITE_CRON_SECRET / VITE_NIMHUNT_PAYOUT_CRON_SECRET fail closed. No production deployment exists yet; vercel.json deliberately NOT created (creation+deploy would immediately start the 10-min schedule).

## Scheduled payout orchestration

- Scheduler architecture is a protected HTTP trigger at `/api/internal/payout-cycle`; it invokes the existing `runPayoutWorker` and does not create a second payout engine or resident worker.
- The route accepts Vercel-compatible GET and operator/test POST, requires `Authorization: Bearer` with server-only `CRON_SECRET` (canonical) or local alias `NIMHUNT_PAYOUT_CRON_SECRET`, ignores request bodies, and rejects query overrides. Constant-time sha256+timingSafeEqual preserved; cookies irrelevant.
- `NIMHUNT_PAYOUT_MAX_PER_CYCLE` is server-only, defaults to 5, and is bounded to 1-69. Both existing automation kill switches remain authoritative.
- `011_payout_scheduler_operations.sql` is LIVE (verified 2026-09-17 read-only: last_cycle_* columns present, get_payout_operations_status + record_payout_cycle_result reachable via service role, malformed record rejected, acquire returns AUTOMATION_DISABLED). Never replayed 001-010.
- DEPLOY READINESS 2026-09-17: api/internal/payout-cycle.ts present (existing route only), vercel.json absent (correct, creation gated on deployed-route auth PASS), local env NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=false, scheduler source=CRON_SECRET maxPerCycle=5, no VITE_* secret in client bundle (dist scan 0 hits), npm test 605 pass / lint 0 / tsc 0 / build ok / git diff --check 0. Sandbox has no Vercel CLI, no .vercel linkage, no Vercel token — production deploy + native cron observation require owner action. payout:status live re-query timed out in sandbox (network); last live verified state 2026-09-17 stands (env OFF, DB OFF, PENDING/PROCESSING/SUBMITTED 0, execution-day committed 10,000,000 Luna, remaining 680,000,000, lastCycle DISABLED).
- Overlap tests use a mocked treasury only. Docker scheduled-cycle overlap preserves the claim uniqueness, one send, reserve, and execution-day cap.
- VERCEL-COMPAT 2026-09-17: scheduler serverless graph uses `.js` relative imports (NodeNext/Vercel/bundler-safe; `node --experimental-strip-types` scripts still use `.ts` and are dev-only). `tsconfig.server.json` (allowImportingTsExtensions:false, types:["node"], nodenext) + `npm run typecheck:server` catches TS5097/TS2591 locally. `asCycleResult` validates last_cycle_result into COMPLETED|DISABLED|FAILED|null, throws PAYOUT_UNAVAILABLE otherwise. No automation, no reward/cap change, no auth weakening.
- HOBBY-DAILY-CRON 2026-09-17: `vercel.json` created (single cron `/api/internal/payout-cycle` @ `0 14 * * *`, $schema pinned, no secret) — commit 6934c0b pushed to main (no force). 14:00 UTC chosen over 13:00 UTC because commit time (~13:06 UTC) had just missed the 13:00 window; next observable fire is 14:00 UTC same day. Hobby plan = max once/day, so `*/10`/hourly/multi-entry forbidden. Local verify: 616 pass / lint 0 / typecheck:server 0 / tsc 0 / build ok / diff --check 0; production live (root 200, route 401 no-auth). Dashboard cron registration + first native DISABLED invocation PENDING (sandbox has no Vercel CLI/token).

## Mission-Specific Daily Angkor Difficulty (angkor-blueprint-v2)

- `angkor-blueprint-v2` introduces 9 canonical variants (3 per mission: Gem Runner, Chest Hunter, Vault Breaker) with distinct obstacle/item geometries and multi-Goblin pressure (GR: 1-2, CH: 2, VB: 2-3).
- Deterministic selector `selectDailyVariantIndex(dayKey, mission)` uses FNV-1a hash of `${dayKey}:${mission}:angkor:01:angkor-blueprint-v2` % 3.
- Solvability: every variant is verified solvable within <= 256 actions by BFS solver without dying (tested in 10-31 actions).
- Client bundle isolation: `dailyAngkorLayouts.ts` must NOT import `canonical.ts` directly, to prevent `@nimiq/core` (WASM worker) from being bundled into client code. Authoritative hash is attached via `hasher` callback or in `blueprintBootstrap.ts` / tests.
- Replay engine: `stepGoblin` accepts blueprint gate coordinate to enforce locked gate impassability for Goblins. Combat and movement resolve sequentially per Goblin.
- Backwards compatibility: `isSupportedBlueprintVersion` supports both `angkor-blueprint-v1` and `angkor-blueprint-v2`. Historical v1 blueprints, prevalidation hashes, and test replays remain 100% intact.

## Timed Collapsing-Boulder Hazard (COLLAPSING_BOULDER)

- Lifecycle: `ARMED` -> `WARNING` (tripped once by player landing on `triggerCells`) -> `FALLEN` (after `targetTicks` simulation ticks, default 4 ticks @ 750ms = 3.0s real time).
- Deterministic simulation via `TICK` actions: Replay action stream supports `ReplayAction = MoveAction | TickAction`. `MOVE` actions advance player/turn logic without advancing the hazard countdown. `TICK` actions advance `elapsedTicks` towards `targetTicks` without moving the player or triggering goblins. Replay is 100% deterministic and server-verifiable without wall-clock reliance.
- Anti-stall / anti-tamper: Engine rejects `TICK` actions with `UNEXPECTED_TICK` when no hazard is in `WARNING`.
- Impact semantics: Walkable during `WARNING` (escape window). Instant death (`hp = 0`, `runStatus = 'FAILED'`, `missionStatus = 'FAILED'`) if player occupies impact cell at exact collapse tick (`elapsedTicks >= targetTicks`). Once `FALLEN`, tile becomes permanently impassable (`BOULDER_BLOCKED`). Cannot re-trigger.
- Entity interactions: `resolvePuzzleMove` blocks player entry into fallen boulders and prevents pushable boulders from being pushed into fallen boulders. `stepGoblin` blocks goblin pathing into fallen boulders. Pushable boulder puzzle behavior is 100% unaffected.
- Layout scoping: Integrated into Vault Breaker Variant 1 (`vb1-collapsing-boulder-1` at `(6,2)`, triggers at `(6,1)` and `(5,1)`, `delay: 4`, `warningTicks: 4`, `trigger: 'REAL_TIME'`). All 9 canonical variants remain proven solvable <= 256 actions.
- Client presentation: Subtle rune marker when ARMED; pulsing red/amber border with numeric tick countdown (3 -> 2 -> 1 -> !) when WARNING via `750ms` timer dispatching authoritative `TICK` actions; dust shake and solid boulder when FALLEN; 'Crushed by collapsing boulder!' notice on crush death. Clean reset and shutdown lifecycle.

## Server-Owned Timing Authority & Anti-Withholding (COLLAPSING_BOULDER)

- Threat vector: A modified client could trigger WARNING and withhold `TICK` actions to keep the hazard in WARNING indefinitely, freely traverse the impact cell seconds or minutes later, and pass deterministic replay.
- Server timing anchor: On accepting the action transitioning `ARMED -> WARNING`, the server sets an authoritative server-owned anchor (`warningStartedAt`, `collapseDeadlineAt = warningStartedAt + (warningTicks * 750ms)`).
- Immediate client flush: `recordAcceptedMove` in `productCheckpoint.ts` checks if any collapsing boulder transitioned `ARMED -> WARNING` and immediately calls `queue.requestFlush()`, ensuring the server establishes the deadline promptly upon trigger.
- Deadline enforcement during gameplay: In `applyCheckpointBatch`, if `now >= collapseDeadlineAt` and a hazard is still in `WARNING`:
  - The server treats the hazard as `FALLEN` before accepting subsequent actions.
  - If the player is on the impact cell when the deadline expires: instant crush death (`hp = 0`, `runStatus = 'FAILED'`, `missionStatus = 'FAILED'`).
  - Movement into the impact cell is blocked (`BOULDER_BLOCKED` -> `INVALID_ACTION`).
  - Belated `TICK` actions are rejected with `UNEXPECTED_TICK` (`INVALID_ACTION`).
- Final verification audit: `auditTrustedRun` in `server/expeditions/verify.ts` validates that any triggered hazard has a recorded server deadline and resolved to `FALLEN` in the replayed transcript. If ticks were withheld, verification fails closed with `PROOF_LOST`.
- Zero database migrations required: Hazard deadlines are stored in `state.hazardDeadlines` (persisted seamlessly in `expedition_runs.replay_snapshot` jsonb and in-memory `run.hazardDeadlines`). `hashReplayState` excludes unhashed metadata, preserving exact stateHash synchronization between client and server.

## Production UX copy conventions (2026-09-18)

- Reserved states say "Your reward is secured." + "Daily rewards are paid in the next payout batch." Never imply instant transfer (no "sent/received/paid out").
- No Luna units, SQL, worker/scheduler mechanics, or lifecycle enums in user copy. Amounts render as NIM only.
- Mission objectives: Gem "Collect 6 gems and survive." / Chest "Open 4 chests and survive." / Vault "Find the key. Unlock the gate. Reach the vault."
- Dev surfaces stay behind explicit `?dev=` query paths; production shell shows no dev labels, coordinates, blueprint internals, or stale test wording.

## Canonical Sources

- [`docs/prd.md`](../docs/prd.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/projectplan.md`](../docs/projectplan.md)
- [`DESIGN.md`](../DESIGN.md)
