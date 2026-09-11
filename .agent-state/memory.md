# NimHunt - Durable Memory

> Last reviewed: 2026-09-11

This file stores decisions and lessons that should survive future sessions. It is not a replacement for the canonical product or architecture documents.

## Canonical Sources

- [`docs/prd.md`](../docs/prd.md) defines product requirements and acceptance criteria.
- [`docs/architecture.md`](../docs/architecture.md) defines runtime boundaries, security invariants, data model, and testing strategy.
- [`docs/projectplan.md`](../docs/projectplan.md) defines Cycle 2 phases, gates, and cut order.
- [`DESIGN.md`](../DESIGN.md) defines the visual system and UI constraints.

## Product Rules

- Angkor Ruins is the only playable Cycle 2 world. Bavaria and Siberia are locked teasers.
- Players receive 3 free expeditions per day and the hunt has 69 daily NIM reward slots.
- The current plan recommends at most 1 finalized real-NIM reward per wallet per day; later runs still count for progression and leaderboards.
- Every expedition starts with a visible, deterministic task.
- Real NIM eligibility comes from completing the stated skill task alive, never from random chest contents.
- Gems are progression and stat items in Cycle 2. They are not redeemable or transferable, and the UI must not show a fixed cash value.
- The public `/` route is marketing and discovery. The actual reward game is the `/play` Mini App experience inside Nimiq Pay.

## Gameplay Conventions

- Angkor gameplay is grid-based, four-direction, and mobile-first with a touch D-pad.
- The current Room 01 tuning is 100 starting HP, 25 damage from spikes, 20 damage from poison, 20 damage from an unequipped Goblin collision, 25 HP potion healing, and a one-time sword pickup that defeats the Goblin without damage.
- Player movement, item resolution, Goblin evaluation, combat, HUD emission, and reset follow a deterministic turn-based sequence.
- A potion is not consumed when the player is already at full HP.
- A Gem Runner map must contain enough reachable visible gems to satisfy its target without depending on random chest loot.
- Chest loot is fixed by Room 01 configuration (no reroll): (1,2)=GEMS, (6,3)=POTION, (5,5)=TRAP, (10,3)=SWORD. Chests open on step-onto, exactly once, and count toward Chest Hunter even when loot is EMPTY/trap/full-HP potion.
- Chest Hunter completes only with chestsOpened >= 4 AND hp > 0. Gem Runner default is preserved when `mission` param is omitted.
- Vault Breaker is playable via `/play?run=vault-breaker`. Completion is two-stage: `evaluateMission` never auto-completes vault runs (reach ≠ complete); `isVaultBreakerComplete` requires vault-reached-alive + trusted VERIFIED seal. Death still fails.
- Preview seal type `NIMHUNT_VAULT_SEAL_PREVIEW` (version/type/wallet/mission/world/room/objective/environment, no reward fields) shares `serializeCanonicalSeal` with the dev seal. Server accepts both types through one crypto tail + address-binding invariant; client flags never trusted.
- React owns all wallet I/O (`useVaultSeal`: init/listAccounts/sign/verify only after Seal tap; race-safe, no auto-run). Phaser makes zero wallet calls. Overlay locks movement, preserves the run, destroys on exit. Statuses: UNSEALED/REQUESTING_ACCOUNT/AWAITING_SIGNATURE/VERIFYING/VERIFIED/REJECTED.
- One Phaser engine: `useAngkorRun` owns `createNimHuntGame` mount/destroy; product `ExpeditionView` and dev `GameDevView` are thin wrappers. Leaving/backing to `/play` unmounts and destroys the instance.
- Product HUD hides all dev labels/debug/coords/reset; D-pad is arrows-only. Dev view keeps everything.
- The current playable implementation is a single Room 01 development scene; multi-room expedition content remains future P4 work.

## Architecture Boundaries

- React owns the marketing page, Mini App shell, HUD, dialogs, wallet state, and claim UI.
- Phaser owns the grid scene, rendering, player and enemy movement, and in-map interactions.
- Pure game rules live under `src/game/systems/` so they can be tested without Phaser.
- `src/game/events/gameEvents.ts` is the typed React/Phaser bridge.
- Phaser must not call wallet APIs directly. Nimiq operations belong in the integration and domain layers.
- Keep game simulation deterministic where practical and use explicit state transitions instead of scattered flags.

## Nimiq and Security Invariants

- Nimiq Pay account access and signing are deliberate wallet actions, not an assumption made by the marketing route.
- Reward slots, task eligibility, claim verification, payout amount, daily limits, and replay protection are server-authoritative.
- Daily reset is the UTC calendar day from server/database time, never device time.
- 69 daily reward slots and 3 expeditions per wallet per UTC day; at most 1 reserved NIM reward per wallet per UTC day. Failed and abandoned runs still consume an attempt.
- Slot reservation must increment `reserved_slots` atomically in Postgres (`UPDATE … reserved_slots = reserved_slots + 1 WHERE reserved_slots < 69` under row locks). Never read-then-increment in unlocked JavaScript.
- `COMPLETED` in this milestone is accounting state only. It is not sufficient proof for real NIM payout.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. The browser never talks to ledger tables; it may only call public HTTP reads such as `/api/daily-hunt-status`.
- Product `/play` Start must not silently call `startExpedition` during browser development; that would consume daily attempts without a deliberate wallet identity.
- Claims use a canonical structured payload, a single-use nonce, and an expiring reservation.
- The client cannot mint reward slots, choose payout amounts, finalize claims, or claim success before authoritative confirmation.
- Treasury private keys and all other secrets stay in server-side secret storage and never ship to the frontend or enter Git.
- Payout logic is isolated, idempotent, audited, and never retries a failed payout as a new prize automatically.
- Gems, chests, and other non-cash progression systems must not be presented as paid randomized loot.

## Lessons and Conventions

- Preserve the pure/render separation: add or test rules in `src/game/systems/` before wiring Phaser presentation.
- Prefer focused state files and point to canonical docs instead of copying large product or architecture sections here.
- Treat state files as continuity context only. Verify current code and worktree contents before relying on any status statement.
- Run `npm test`, `npm run lint`, and `npm run build` after meaningful repository changes.
- `main.tsx` wraps the app in React StrictMode. Cleanup-only mount effects that set `mountedRef.current = false` and never restore it will abort every later async wallet call in development. Reset the flag in the effect body, matching `useVaultSeal` and `useNimiq`'s local cancelled flag. `useProductStart` hit this: `/play?dev=nimiq` showed the native sheet, product Start stayed on `REQUESTING_ACCOUNT` because `listAccounts()` never ran.

## Replay Proof Decisions

- Replay validation uses the exact pure engine and a BFS state key with action history excluded and `seq` normalized to `0`; blocked moves are not enqueued and the 256-action guard runs before successor expansion.
- Blueprint validation first rejects impossible objective cardinality (for example, a Gem Runner target with no reachable gem or gem-bearing chest) with `NO_WINNING_SEQUENCE`, avoiding exhaustive search of an impossible state space.
- `createRoom01Blueprint()` is a client-safe baseline source. The server bootstrap computes and attaches its canonical hash; importing `@nimiq/core` through client-reachable world data breaks Vite's IIFE worker build because of top-level WASM await.
- Temporary validator diagnostics and instrumentation were removed after capturing the root-cause evidence.
- Rules v1 blueprint preflight now accounts for locked-gate reachability before BFS; cardinality-valid objectives in an inaccessible puzzle component fail as `NO_WINNING_SEQUENCE` without a production timeout.
- Validator BFS deduplicates with the canonical serialized replay state (with `seq` normalized to zero), not a cryptographic hash per candidate; this preserves exact state identity while avoiding unnecessary CPU in publication validation.
- Validator BFS must not use `Array.shift()`. Room 01 Chest Hunter explores ~368k states with a ~186k frontier; O(n) dequeue made cold `npm run dev` take ~200s. Use an index/deque and reconstruct the winning path from parent pointers.
- Development memory proof bootstrap must not run in the Vite plugin `config()` hook. Create the plugin immediately and lazily initialize the memory backend once on the first owned proof request, with a shared in-flight promise for concurrent callers. Preview/production handlers must not construct that backend.
- Built-in Room 01 bootstrap publication may skip BFS only when the frozen-day canonical template hash exactly matches a checked-in constant (`1970-01-01` dayKey, because `hashBlueprint()` includes the real UTC day). Mission name alone is never enough. Any other blueprint, or a one-byte template change, must run `validateExpeditionBlueprint()` and fail closed as `BLUEPRINT_INVALID` if unsolvable. Editing a built-in template requires tests to pass full validation and a deliberate expected-hash/sequence update.
- Durable proof start uses `server/ledger/sql/002_expedition_proof.sql`: published blueprint content is immutable, one active publication exists per day/mission, challenge expiry is capped by UTC midnight, and the start RPC locks challenge then wallet/day state before creating run/checkpoint/session records.
- Both daily-ledger and expedition-proof SECURITY DEFINER SQL functions use `pg_catalog, public` search paths, schema-qualified protected references, and service-role-only execution grants.
- Start authorization is the strict `NIMHUNT_START_EXPEDITION` payload, verified through the shared Nimiq signed-message crypto tail. Exact consumed retries return the stored start response before day/expiry checks; unused failures do not increment attempts.
- Run-session capabilities use 256-bit CSPRNG material, Secure/HttpOnly/SameSite=Strict cookies, and hash-only durable binding. Raw capabilities are not part of proof hashes or durable snapshots.

## Authenticated Product Start

- Product `/play` starts must use a dedicated lazy coordinator: explicit account approval/selection, one frozen normalized wallet, fresh challenge, exact canonical start signature, and no optimistic attempt decrement.
- Product locators are non-authoritative: `?run=<mission>&runId=<id>` must pass authenticated `/active` and an idempotent gameplay-start transition before Phaser mounts; bare or mismatched locators fail closed.
- `/active` supports only pre-mount recovery. A server-owned gameplay-start marker makes post-mount reload unavailable until checkpoint/replay work exists; Practice is never an automatic fallback for that state.
- Product Phaser consumes the complete server blueprint and trusted initial state. Dev and Practice use local Room 01 construction and do not inherit product sessions or proof traffic.
- Product starts navigate only after the server returns `START_CREATED` or `START_ALREADY_CREATED`; the route then requires authenticated `/active` and idempotent gameplay-start before mounting Phaser.
- The public hunt board never uses fixture wallet-attempt values. Attempts are rendered as unknown until a successful start and are refreshed only with normalized in-memory wallet context.
- Product runtime mapping rejects the product path when required active data is absent or mismatched; supported Room 01 geometry remains local, while blueprint-owned objects and trusted initial replay state come from the server response.
- The memory proof adapter is allowed only with explicit `NIMHUNT_PROOF_BACKEND=memory` in development/test. Preview/production must fail closed until a Postgres proof adapter exists.
- The historical credential-shaped `.env.example` value was revoked/deactivated by the authorized owner, the template was scrubbed, and the remediation was committed in `57a902577747f7bca316c92ebc11758b7dbe116f`. Replacements never enter Git.
- Client integration coverage now exercises the real product-start hook, authenticated pre-mount gate, product game lifecycle, Practice isolation, and wallet-status refresh without adding proof or payout behavior. The full Vitest runner uses a 15-second per-test timeout because validator/start setup can exceed the default 5 seconds under parallel worker contention; isolated tests remain green.
- Empty Nimiq account results follow the same cancelled/no-attempt product-start path as explicit account cancellation; they do not request a challenge or submit `/start`.
- Start-challenge client parsing requires exact keys `ok, wallet, challenge, blueprintId, blueprintHash, dayKey, expiresAt`. A correctly shaped `{ ok: false, error }` envelope must keep the stable error code; unknown codes still become `MALFORMED_RESPONSE`.
- Unconfigured proof runtime (`NIMHUNT_APP_ORIGIN` missing or memory backend off) must return `PROOF_UNAVAILABLE`, not `MALFORMED_REQUEST`. Origin/host checks against an empty expected origin previously made the first phone `/api/expeditions/start-challenge` fail as `MALFORMED_REQUEST`, which the client collapsed to `MALFORMED_RESPONSE`.
- Invalid start-challenge wallets must return `INVALID_WALLET` as a proof error. `normalizeNimiqWallet()` throwing `LedgerError` was previously caught as `MALFORMED_REQUEST`.
- Development memory HTTP may accept authorized loopback/private IPv4 HTTP Origin/Host aliases on the same port as `NIMHUNT_APP_ORIGIN`. That is required for Nimiq Pay phone testing against Vite `host: true` while the configured origin remains `http://localhost:5173`.
- The focused authenticated client integration suite now covers 25 tests, including duplicate gate resolution, gameplay-start lost-response retry, post-marker reload fail-closed behavior, rejected/cancelled start wallet isolation, the actual PlayShell-to-wallet-status refresh lifecycle, StrictMode account-request survival, and init/listAccounts failure retry.

## Mission Board vs Wallet Attempts

- `3 MISSIONS` is the count of mission types on the board (Gem Runner, Chest Hunter, Vault Breaker). It must never be worded as `3 AVAILABLE`, which reads as remaining wallet attempts.
- Wallet daily attempts are a different counter. After a successful signed Start they come only from `/api/wallet-daily-status` using the remembered normalized wallet. Copy is `N EXPEDITIONS LEFT TODAY`. Before a wallet is known, show unknown (`—` / `wallet required`), never a fake `3`.
- Attempts are consumed at durable Start, not at mission completion, failure, leave, gameplay-start, or Practice. Returning to `/play` must refetch; do not decrement locally. PlayShell owns that refetch so the missions tab after "Back to missions" still refreshes.
- After three eligible Starts, remaining is `0` and Reward Start shows `You've used today's 3 reward-eligible expeditions.` Practice stays available. Mission cards stay selectable independently of remaining attempts.
