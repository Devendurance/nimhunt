# Authenticated Product Start Design

**Date:** 2026-09-09

**Status:** Design approved; implementation pending

**Scope:** Authenticated product start and server-bound Phaser launch for `/play`

## 1. Goal

Wire the reward-eligible `/play` flow so that a deliberate Start action:

```text
mission brief
-> lazy Nimiq Pay initialization
-> explicit account approval/selection
-> server start challenge
-> exact signed NIMHUNT_START_EXPEDITION payload
-> atomic durable run creation
-> HttpOnly run-session cookie
-> authenticated /active recovery
-> server gameplay-start transition
-> Phaser with the server-bound blueprint
```

The slice proves authenticated durable start and server-bound game launch. It does not prove gameplay completion or reward eligibility.

## 2. Non-Goals

This slice does not add:

- action checkpoints or checkpoint batching;
- replay finalization or server gameplay verification;
- product Vault proof;
- reward claims, slot reservation, NIM transfer, treasury, or payout;
- new rooms, enemies, mechanics, or visual/layout changes to Room 01;
- full mid-run reload recovery;
- a Postgres proof adapter.

`POSTGRES + DEVICE VALIDATION` remains `PENDING`.

## 3. Route and Mode Boundaries

The existing dev and preview surfaces remain separate from product mode.

| Route | Behavior |
|---|---|
| `/play` | Mission board and brief. No wallet/provider request. |
| `/play?dev=nimiq` | Existing Nimiq integration panel. `useNimiq` remains unchanged. |
| `/play?dev=game` | Existing local Room 01 development game. No proof traffic or attempt use. |
| `/play?practice=<mission>` | Explicit local Practice game. No wallet, proof, session, attempt, or reward traffic. |
| `/play?run=<mission>&runId=<id>` | Product locator only. It mounts nothing until authenticated `/active` and gameplay-start checks pass. |

`runId` and the URL mission are non-secret navigation metadata. Neither authorizes access or configures authoritative gameplay. A bare `?run=<mission>`, a missing `runId`, a missing cookie, or a forged locator cannot mount eligible Phaser.

The product route uses this sequence:

1. Parse only the safe route locator.
2. Call authenticated `GET /api/expeditions/active?runId=<id>`.
3. Require the session-bound run ID, durable mission, supported versions, immutable blueprint ID/hash, complete blueprint, and recoverable pre-mount state.
4. Reject a URL/durable mission mismatch rather than using the URL value.
5. Call an explicit authenticated gameplay-start operation. This marks that the product game has begun without creating a run, consuming an attempt, changing blueprint bindings, or issuing a session.
6. Mount exactly one product Phaser instance.

The server-owned gameplay-start marker distinguishes a committed run that has not mounted from a run that has begun gameplay. `/active` is read-only and never sets this marker.

## 4. Product Start Coordinator

Product wallet I/O is owned by a new dedicated coordinator. The existing `useNimiq` hook and `/play?dev=nimiq` are not refactored.

The coordinator uses explicit states equivalent to:

```text
IDLE
REQUESTING_ACCOUNT
SELECTING_ACCOUNT
REQUESTING_CHALLENGE
AWAITING_START_SIGNATURE
SUBMITTING_START
RECOVERING_START
STARTED
CANCELLED
LIMIT_REACHED
BLUEPRINT_UNAVAILABLE
PROOF_UNAVAILABLE
REJECTED
```

Only `STARTED` can navigate toward an eligible product route. The route still requires authenticated `/active` and gameplay-start success before Phaser mounts.

### 4.1 Account flow

- The deliberate Start action lazily initializes the provider and calls `listAccounts()`.
- One account proceeds after provider approval.
- Multiple accounts enter `SELECTING_ACCOUNT` and show explicit account choices.
- Selecting an account freezes its normalized wallet for the entire challenge/sign/start attempt.
- The coordinator does not call `listAccounts()` again during that attempt or silently switch accounts.
- Choosing another account requires an explicit cancel/reset back to the brief.
- Account access cancellation, selection cancellation, and signature cancellation return to the brief with:

```text
Expedition start was cancelled. No daily expedition was used.
```

No attempt is consumed in any of these paths.

### 4.2 Challenge and signature flow

- While any flow is active, Start is disabled and only one coordinator attempt may exist.
- `start-challenge` is requested only after an account is fixed.
- The client displays the exact canonical `NIMHUNT_START_EXPEDITION` JSON returned from the server-bound challenge fields.
- A separate deliberate `Authorize this expedition` action invokes the provider signer.
- A cancelled or rejected signature does not call `/start`, consumes no attempt, clears the attempt state, and requires a fresh challenge/signature on retry.
- `START_CHALLENGE_EXPIRED`, `START_CHALLENGE_DAY_EXPIRED`, and `START_CHALLENGE_INVALID` never reuse the signed payload. They return to a safe retry state; a new deliberate retry obtains a fresh challenge and signature.

The UI shows `No daily expedition has been used yet.` until the server confirms durable run creation. React never decrements attempts optimistically.

### 4.3 Lost response recovery

If an exact signed `/start` request may have reached the server but its response is lost:

1. Enter `RECOVERING_START`.
2. Retry the exact same signed request, with the same payload, public key, and signature.
3. Accept `START_ALREADY_CREATED` only as the same previously committed run/session response.
4. Do not issue a new challenge or automatically create another run.

Ordinary rejection, signature cancellation, challenge expiry, and binding errors do not use this recovery path.

When returning to `IDLE`, clear the selected account, challenge, canonical payload, pending signature, and transient errors. Never store these values or any session capability in localStorage.

## 5. Server Runtime and Memory Adapter

Add a dedicated Vite proof middleware for product start, active recovery, gameplay-start, and local wallet-status reads. It uses the existing memory proof service and current Room 01 bootstrap blueprints only when explicitly authorized.

Memory mode requires both:

- an explicit proof-backend configuration such as `NIMHUNT_PROOF_BACKEND=memory`;
- Vite development/test execution, never preview/production execution.

Absence of Supabase credentials does not infer or enable memory mode. Preview/production has no memory fallback. Until a Postgres proof adapter exists, product proof requests in those modes return `PROOF_UNAVAILABLE`.

The memory adapter:

- publishes the current UTC-day Room 01 blueprint for each supported mission;
- derives attempts and active runs from the memory proof service;
- may serve development public 69-slot status with no claim reservations in this slice;
- loses runs, sessions, and challenges when the Vite server restarts;
- rejects old browser cookies after restart rather than recreating runs from URL/client data.

This behavior is explicitly development/test-only and must be covered by fail-closed tests.

## 6. HTTP and Session Contract

The product surface is:

```text
POST /api/expeditions/start-challenge
POST /api/expeditions/start
GET  /api/expeditions/active?runId=<id>
POST /api/expeditions/gameplay-start
```

All responses use JSON, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

### 6.1 Start challenge

`start-challenge` requires the expected POST method, JSON content type, bounded body, and strict wallet/mission fields. It normalizes the selected wallet server-side, binds the current published blueprint, and consumes no attempt.

### 6.2 Start authorization

`start` requires the exact canonical payload, public key, and signature. It strictly rejects unknown fields, malformed payloads, unsupported versions, mismatched challenge bindings, and invalid signatures.

The server atomically:

- locks and validates the challenge;
- handles exact consumed idempotency before ordinary expiry/limit checks;
- checks the current server day and published blueprint;
- enforces the three-expedition limit;
- creates one durable run, initial trusted state, run challenge, and session binding;
- consumes the challenge and increments the attempt exactly once.

`START_ALREADY_CREATED` may reissue a cookie only after proving the same consumed challenge, canonical payload, authorization fingerprint, wallet, public key/signature binding, and run. Knowing a run ID is never sufficient for cookie issuance.

### 6.3 Run-session cookie

Use one dedicated cookie with:

```text
HttpOnly
SameSite=Strict
Secure outside explicitly authorized local/LAN HTTP development
Path=/api
no Domain attribute
explicit Max-Age/Expires
```

The server-side expiry is no later than:

```text
min(configured session lifetime, run.nextResetAt)
```

Only the capability hash is persisted. The raw capability is never returned in JSON, exposed to JavaScript, put in a query string, logged, hashed into proof data, or written to localStorage.

Future terminalization must revoke or invalidate the session for mutations. A stale cookie cannot revive an expired or terminal run.

### 6.4 Same-origin and CSRF policy

The expected application origin is explicit per environment. Cookie-authenticated mutating requests reject cross-origin `Origin` values. The server does not blindly trust arbitrary `Host` or `X-Forwarded-*` headers; trusted-proxy behavior must be configured explicitly.

For same-origin browser reads where `Origin` may be absent, the server uses the configured host/transport allowlist and does not treat the absence of Origin as authorization. SameSite is defense-in-depth, not the authorization boundary. Credentialed wildcard CORS is not enabled.

### 6.5 Active recovery

`/active` derives identity only from the valid session cookie. It requires:

```text
session.runId == requested runId == durable run.runId
```

It also requires an unexpired/unrevoked session, `STARTED` status, a recoverable pre-mount marker, matching durable mission, matching blueprint ID/hash, supported versions, and a complete trusted blueprint.

It never creates a run, consumes an attempt, issues a replacement session, changes blueprint bindings, resets gameplay, generates a run challenge, or marks gameplay started.

Missing, invalid, expired, revoked, mismatched, or already-started recovery returns a stable `RUN_SESSION_INVALID` or `ACTIVE_RUN_UNAVAILABLE` response and no game mounts.

### 6.6 Gameplay-start transition

`POST /api/expeditions/gameplay-start` is the explicit server-controlled transition used after successful pre-mount `/active` and before Phaser creation. It requires the authenticated session and matching run ID, is idempotent for the same pre-mount run, and only records a server timestamp/marker.

It does not create a run, consume an attempt, issue a session, change a blueprint, or perform proof/reward work. Once this marker exists, this slice cannot restore eligible gameplay from the initial state after a reload. `/active` reports recovery unavailable instead.

## 7. Blueprint and Phaser Handoff

The typed browser API client strictly parses `/start` and `/active` responses. It rejects missing run IDs, unsupported rules/room/blueprint versions, malformed blueprints, missing blueprint IDs/hashes, mission mismatches, invalid run state, and incomplete blueprint-owned fields.

The browser validates response shape and versions but does not recompute authoritative blueprint hashes. Server publication and hash verification remain server responsibilities.

Product `createNimHuntGame` receives a discriminated product option containing the exact blueprint returned by authenticated `/active` and the trusted pre-mount state. It does not merge product coordinates with local Room 01 coordinates.

All blueprint-owned values come from the server response:

- player spawn;
- Goblin configuration;
- gems;
- chests and deterministic loot;
- sword and potion positions;
- hazards;
- boulders;
- key, gate, and objective positions;
- mission parameters.

Stable room geometry and renderer defaults may remain local because they are bound by the supported room/rules versions. A missing or invalid product blueprint field never falls back to a local product coordinate; the route fails closed before Phaser creation.

Dev and Practice use separate local constructors and cannot inherit product session or blueprint state.

The product mount gate is singleton-safe: duplicate route resolution, React rerenders, or repeated `/active` results cannot create a second Phaser instance. Route exit destroys the current instance exactly once.

## 8. Mid-Run Reload Boundary

This slice supports only pre-mount recovery:

```text
durable /start commit
-> navigation/response interruption
-> /active finds run with no gameplay-start marker
-> gameplay-start
-> one product Phaser mount
```

It does not support recovery after product gameplay has begun because no accepted actions are checkpointed yet. A reload after the gameplay-start marker shows:

```text
Eligible expedition recovery is unavailable after gameplay has started.
```

It does not remount the initial blueprint, trust localStorage, create a second run, or silently switch to Practice. Abandon/proof-loss handling belongs to the next proof milestone.

## 9. Attempt Status and Practice

Public 69-slot status may load without a wallet. Wallet-specific attempts remain unknown before an account is deliberately selected; the UI never shows a fake `3 expeditions left` value.

After `STARTED`, the client refreshes wallet daily status from the server and renders the authoritative used/remaining values. A same-SPA return to `/play` may refresh using a safely retained in-memory wallet context, but it never initializes Nimiq Pay merely to read attempts. Local storage is not authoritative run state.

The only automatic practice offer is an explicit CTA after:

- `DAILY_EXPEDITION_LIMIT_REACHED`;
- `DAILY_BLUEPRINT_UNAVAILABLE`;
- `PROOF_UNAVAILABLE`.

Copy is:

```text
You've used today's 3 reward-eligible expeditions.
Today's reward expedition isn't available yet.
Reward expeditions are temporarily unavailable.
```

Practice launch requires a deliberate selection and shows:

```text
PRACTICE RUN
No daily expedition used.
No NIM reward can be reserved.
```

Practice does not call either start endpoint, establish a reward session, consume attempts, call `/active`, send proof/checkpoint traffic, reserve a slot, or become eligible because a session later exists.

## 10. Verification Matrix

### Coordinator and API

- `/play` load and mission brief opening never call the provider;
- deliberate Start triggers lazy account flow;
- one-account and multi-account behavior are explicit;
- account freeze prevents re-listing or silent switching;
- duplicate Start taps create one challenge/request flow;
- account, selection, and signature cancellation consume zero attempts;
- challenge expiry/invalidation requires a fresh challenge/signature;
- lost signed-start response enters recovery and exact retry returns the same run;
- `START_ALREADY_CREATED` creates no second run or attempt;
- limit, missing blueprint, and backend unavailable states offer explicit Practice;
- invalid signature/binding errors never silently downgrade to Practice;
- attempt status refreshes only after `STARTED`.

### HTTP and security

- raw capability is absent from `/start` JSON;
- valid cookie permits only matching `/active`;
- run ID without cookie is rejected;
- a valid cookie plus a different run ID is rejected;
- expired/revoked/terminal sessions fail closed;
- exact retry reissues access only to the same run;
- altered retry cannot obtain a session;
- cross-origin cookie mutation is rejected;
- local HTTP cookie omits Secure only under explicit local development configuration;
- preview/production never use memory fallback;
- all product responses are no-store;
- logs do not emit cookies, raw capabilities, full signatures, or reusable signed payloads;
- request methods, content types, body sizes, and unknown fields are strict;
- `/active` has no run-creation/reset/session-replacement side effects.

### Route and game

- bare `?run` never mounts Phaser;
- missing-cookie `runId` never mounts Phaser;
- URL mission mismatch cannot configure gameplay;
- `/active` mission is authoritative;
- incomplete product blueprints fail closed;
- product Phaser receives all blueprint-owned values from `/active`;
- product mode never falls back to local object coordinates;
- pre-mount committed-start recovery works;
- mid-run reload is not treated as safe recovery before checkpoints exist;
- duplicate route resolution mounts one Phaser instance;
- Practice never calls `/active`;
- Dev remains local and proof-free.

### Required commands

```text
npm test
npm run lint
npx tsc -b
npm run build
```

Smoke routes:

```text
/
/play
/play?dev=nimiq
/play?dev=game
```

If real Nimiq Pay is available, manually verify account approval/selection, exact start authorization, one durable attempt, cancellation paths, and idempotent retry. Postgres/device validation remains `PENDING` unless the real gates are configured and executed.

## 11. Mandatory Repository Security Gate

Before final verification, replace all credential-shaped values in `.env.example` with obvious placeholders such as:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

The current committed `.env.example` contains a service-role-shaped JWT and project-specific URL. It must be treated as `POTENTIAL CREDENTIAL EXPOSURE` until proven otherwise. Do not print the values. Scrubbing the latest file is insufficient if the values were usable; they must be rotated/revoked in Supabase without committing the replacement. History rewriting is not required unless repository policy demands it.

Run a safe tracked-file/diff scan for service-role keys, JWT-shaped credentials, private keys, seed phrases, bearer/session capabilities, Nimiq private material, accidental `.env` files, and `VITE_*` service-role variables. Confirm `.env` remains ignored and untracked. Report only classifications and paths, never secret contents.

## 12. Implementation File Boundaries

Expected focused additions include:

- a product-start state/reducer and tests;
- a lazy product-start hook/coordinator and tests;
- typed product proof/start/active/gameplay-start browser API helpers and strict parsers;
- the explicit development-only proof Vite middleware;
- active/gameplay-start memory service operations and HTTP/session tests;
- route/product mount-gate tests;
- blueprint-aware product game options and scene handoff tests;
- wallet daily-status refresh wiring and tests.

Existing `useNimiq`, `/play?dev=nimiq`, marketing `/`, dev gameplay, and verified Room 01 mechanics remain unchanged except for the minimum discriminated product-mode handoff needed to consume the server blueprint.
