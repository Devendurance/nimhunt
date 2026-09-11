# Authenticated Product Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current direct `/play?run=` Phaser launch with an explicitly authorized, server-bound product start that can recover a committed pre-mount run without creating a second attempt.

**Architecture:** Keep the existing durable memory start/challenge/session primitive and extend it with read-only active recovery and an idempotent gameplay-start marker. Add a strict same-origin Vite middleware and typed browser API boundary, then put a dedicated product-start coordinator and a pre-mount route gate in front of Phaser. Dev and Practice continue using local Room 01 construction, while product construction receives the exact authenticated blueprint and initial state.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Phaser 4, Vitest 5, `@nimiq/mini-app-sdk`, existing `@nimiq/core` server verification, in-memory proof service for explicit development/test mode only.

## Global Constraints

- Execute this plan inline in this repository; `AGENTS.md` requires no subagent dispatch during change/edit mode.
- The approved scope is authenticated product start and server-bound Phaser launch only; do not add checkpoints, replay finalization, Vault proof, claims, reservation, NIM transfer, treasury, payout, new rooms, enemies, mechanics, or visual redesign.
- `useNimiq` and `/play?dev=nimiq` remain unchanged.
- `/`, `/play`, `/play?dev=nimiq`, and `/play?dev=game` must keep their current behavior except for the minimum product-mode handoff.
- Product provider initialization happens only after deliberate Start; opening `/play`, opening a mission brief, reading public hunt status, or loading a product locator does not initialize Nimiq Pay.
- The exact signed message type is `NIMHUNT_START_EXPEDITION`, with the canonical field order already used by `server/expeditions/canonical.ts`.
- A cancelled account request, account selection, or signature request calls neither `/start` nor any old accounting start endpoint and consumes zero attempts.
- A lost signed-start response retries the exact same `payload`, `publicKey`, and `signature`; it never requests a new challenge or silently creates a second run.
- Product `/active` is read-only and gameplay-start is the only pre-mount state transition.
- Memory proof mode requires `NIMHUNT_PROOF_BACKEND=memory` and development/test execution; preview and production fail closed with `PROOF_UNAVAILABLE`.
- Raw run-session capabilities never appear in JSON, React state, URLs, local storage, logs, or proof data; only the server-side hash is persisted.
- Product responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Product session cookies use `HttpOnly`, `SameSite=Strict`, `Path=/api`, no `Domain`, explicit expiry, and `Secure` except under explicit local/LAN HTTP development configuration.
- No Postgres proof adapter or device validation is added. `POSTGRES + DEVICE VALIDATION` remains `PENDING`.
- Before feature edits, complete the repository security gate for the committed credential-shaped `.env.example` value. Treat it as `POTENTIAL CREDENTIAL EXPOSURE` until proven fake, rotate/revoke if usable or uncertain, scrub it, and never print the value.
- Run `npm test`, `npm run lint`, `npx tsc -b`, and `npm run build` after the implementation. Do not run `drizzle push`; this plan makes no database schema change.

---

## File Map

Create these focused files:

- `src/domain/startAuthorization.ts` — browser/server-shared canonical start payload constants, type, and serializer.
- `src/api/expeditionProof.ts` — typed product start/active/gameplay-start requests and strict response parsers.
- `src/api/expeditionProof.test.ts` — malformed and valid API response parser coverage.
- `src/components/play/productStart.ts` — pure product-start state, actions, copy, and transition helpers.
- `src/components/play/productStart.test.ts` — cancellation, duplicate, stale-response, and recovery state tests.
- `src/components/play/useProductStart.ts` — lazy provider coordinator and React hook wrapper.
- `src/components/play/ProductStartPanel.tsx` — Start, account selection, exact payload, signature, retry, and safe error UI.
- `src/components/play/ProductExpeditionGate.tsx` — authenticated `/active` and gameplay-start pre-mount gate.
- `src/components/play/productGate.test.ts` — pure route-attempt and singleton gate coverage without adding a UI test dependency.
- `src/game/productBlueprint.ts` — server-blueprint-to-Room-01 runtime mapping and trusted initial-state conversion.
- `src/game/productBlueprint.test.ts` — blueprint-owned object and HUD handoff coverage.
- `server/expeditions/vitePlugin.ts` — explicit development-only proof middleware and runtime configuration.
- `server/expeditions/vitePlugin.test.ts` — runtime-mode fail-closed coverage.

Modify these existing files:

- `.env.example` — replace credential-shaped values with placeholders and add explicit non-secret local proof settings.
- `src/domain/expeditionProof.ts` — active/gameplay-start paths, error codes, and response types.
- `server/expeditions/canonical.ts` — consume/re-export the shared serializer without changing its canonical output.
- `server/expeditions/types.ts`, `memoryProofStore.ts`, `proofService.ts` — gameplay marker, active recovery, full wallet status, and authenticated service methods.
- `server/expeditions/session.ts` — `/api` cookie path, explicit expiry, and configurable local HTTP `Secure` behavior.
- `server/expeditions/http.ts` and `http.test.ts` — strict request parsing, origin policy, cookie authentication, active recovery, gameplay-start, and no-secret responses.
- `server/expeditions/start.test.ts`, `session.test.ts` — new marker, expiry, and cookie assertions.
- `server/ledger/vitePlugin.ts` — remove paths owned by the new proof middleware so the old accounting handler cannot intercept product start/status requests.
- `vite.config.ts` — register the proof middleware without changing the existing dev verifier or daily public status setup.
- `src/api/dailyHunt.ts`, `useDailyHuntStatus.ts`, `HuntStatus.tsx`, `huntStatusView.ts`, and related tests — unknown wallet attempts before deliberate account selection and authoritative refresh after `STARTED`.
- `src/components/play/PlayShell.tsx`, `MissionBrief.tsx`, and `PlayShell.module.css` only where existing classes can express coordinator states — keep the established UI language and touch targets.
- `src/components/play/expeditionFlow.ts`, `expeditionFlow.test.ts`, and `src/routes/PlayPage.tsx` — strict product locators, Practice routing, and no bare-run mount.
- `src/game/createNimHuntGame.ts`, `src/game/config/createGameConfig.ts`, `src/game/scenes/AngkorDevScene.ts`, `src/game/events/gameEvents.ts`, `src/game/world/room01.ts`, and `src/components/play/useAngkorRun.ts` — discriminated product blueprint handoff while retaining local dev construction.
- `src/components/play/ExpeditionView.tsx`, `GameDevView.tsx`, and scene tests — product/practice mode wiring, proof-free local paths, and exact server-owned object use.

Do not stage or modify the unrelated current worktree changes in `.agent-state/`, screenshots, `AGENTS.md`, `.gitignore`, the existing memory plan, or the user-edited design spec unless a later task explicitly requires it.

## Implementation Tasks

### Task 0: Repository Security Gate

**Files:**
- Modify: `.env.example`
- Verify: tracked files, relevant `.env.example` history, and current ignore rules

**Interfaces:**
- Produces no application API. It unblocks feature work only after the repository no longer depends on a potentially exposed credential.

- [ ] **Step 1: Classify suspicious values without printing them**

Run a redacted tracked-file and diff scan. Report only matching paths and classifications:

```bash
git grep -Il -E 'SUPABASE_SERVICE_ROLE_KEY|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|bearer[[:space:]]+[A-Za-z0-9._~-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' -- ':!*.png'
git diff --name-only --cached
git diff --name-only
git ls-files .env .env.*
git check-ignore -v .env
```

The current committed `.env.example` must be classified as `POTENTIAL CREDENTIAL EXPOSURE` because it contains a project-specific Supabase URL and a service-role-shaped JWT. Do not include its contents in terminal output, notes, or the final response.

- [ ] **Step 2: Check whether the committed Supabase value was usable**

Using an authorized Supabase project account, compare the project URL and key classification in the dashboard without copying the key into a command, log, or new file. If it is usable or uncertain, revoke/rotate it immediately. Store any replacement only in ignored local/deployment secret storage.

- [ ] **Step 3: Replace tracked example values with placeholders**

Make `.env.example` contain only non-secret configuration, including these exact safe values:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NIMHUNT_PROOF_BACKEND=disabled
NIMHUNT_APP_ORIGIN=http://localhost:5173
```

Preserve any existing non-secret ledger flags. Do not add a replacement credential.

- [ ] **Step 4: Verify ignore and history state**

Confirm `.env` is ignored and untracked, and inspect the `.env.example` path in relevant Git history with a redacting scanner. A historical match is reported as a path/classification only; do not rewrite history unless repository policy requires it.

- [ ] **Step 5: Commit only the security remediation**

```bash
git add .env.example
git commit -m "security: scrub credential-shaped env example"
```

Do not stage `.agent-state/`, screenshots, documentation changes, or any replacement secret.

### Task 1: Share the Canonical Start Contract

**Files:**
- Create: `src/domain/startAuthorization.ts`
- Test: `src/domain/startAuthorization.test.ts`
- Modify: `src/domain/expeditionProof.ts`
- Modify: `server/expeditions/canonical.ts`
- Test: `server/expeditions/canonical.test.ts`

**Interfaces:**
- Produces `StartExpeditionPayload`, `START_EXPEDITION_VERSION`, `START_EXPEDITION_TYPE`, and `serializeStartPayload()` for both browser and server.
- Produces `ProductActiveExpedition` and `ProductGameplayStartResponse` types for the API boundary.

- [ ] **Step 1: Write canonical serializer tests first**

Add tests that assert the exact multiline JSON order and that the server parser accepts only the shared serializer output:

```ts
it('serializes the signed start payload in the fixed field order', () => {
  expect(serializeStartPayload(fixturePayload)).toBe(`{\n  "version": 1,\n  "type": "NIMHUNT_START_EXPEDITION",\n  "wallet": "NQ...",\n  "mission": "gem-runner",\n  "dayKey": "2026-09-09",\n  "challenge": "challenge",\n  "blueprintId": "blueprint",\n  "blueprintHash": "${'a'.repeat(64)}"\n}`)
})
```

Also assert that changing key order, adding a key, or changing whitespace is rejected by `parseStartPayload()`.

- [ ] **Step 2: Move only shared canonical constants and serialization**

Implement `src/domain/startAuthorization.ts` with the existing eight fields in this order:

```ts
export const START_EXPEDITION_VERSION = 1 as const
export const START_EXPEDITION_TYPE = 'NIMHUNT_START_EXPEDITION' as const

export type StartExpeditionPayload = {
  readonly version: typeof START_EXPEDITION_VERSION
  readonly type: typeof START_EXPEDITION_TYPE
  readonly wallet: string
  readonly mission: MissionType
  readonly dayKey: string
  readonly challenge: string
  readonly blueprintId: string
  readonly blueprintHash: string
}

export function serializeStartPayload(payload: StartExpeditionPayload): string {
  return JSON.stringify({
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    mission: payload.mission,
    dayKey: payload.dayKey,
    challenge: payload.challenge,
    blueprintId: payload.blueprintId,
    blueprintHash: payload.blueprintHash,
  }, null, 2)
}
```

Update `server/expeditions/canonical.ts` to import and re-export those symbols so all existing server tests retain the same import surface. Keep parsing, hashing, and authorization fingerprinting server-side.

- [ ] **Step 3: Add active and gameplay-start domain types**

Extend `src/domain/expeditionProof.ts` with `GAMEPLAY_START_PATH`, `RUN_SESSION_INVALID`, and `ACTIVE_RUN_UNAVAILABLE` error codes. Define the response shape with no session capability:

```ts
export type ProductActiveExpedition = {
  readonly runId: string
  readonly dayKey: string
  readonly mission: MissionType
  readonly status: 'STARTED'
  readonly startedAt: string
  readonly expiresAt: string
  readonly gameplayStartedAt: string | null
  readonly rulesVersion: string
  readonly roomVersion: string
  readonly blueprintVersion: string
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly blueprint: ExpeditionBlueprint
  readonly state: ReplayState
  readonly checkpoint: ExpeditionCheckpoint
}

export type ProductGameplayStartResponse = {
  readonly runId: string
  readonly outcome: 'GAMEPLAY_STARTED' | 'GAMEPLAY_ALREADY_STARTED'
}
```

Add `wallet` to `StartChallengeResponse`; it is the server-normalized wallet used to build the exact signed payload. Do not add a raw session field to any browser-facing type.

- [ ] **Step 4: Run the focused contract tests**

```bash
npx vitest run src/domain/startAuthorization.test.ts server/expeditions/canonical.test.ts
```

Expected: all existing canonical tests and the new shared serializer tests pass.

- [ ] **Step 5: Commit the shared contract**

```bash
git add src/domain/startAuthorization.ts src/domain/startAuthorization.test.ts src/domain/expeditionProof.ts server/expeditions/canonical.ts server/expeditions/canonical.test.ts
git commit -m "feat: share authenticated start contract"
```

### Task 2: Extend the Memory Proof Service for Active Recovery

**Files:**
- Modify: `server/expeditions/types.ts`
- Modify: `server/expeditions/memoryProofStore.ts`
- Modify: `server/expeditions/proofService.ts`
- Modify: `server/expeditions/start.test.ts`
- Create: `server/expeditions/active.test.ts`

**Interfaces:**
- Consumes the shared `ProductActiveExpedition` and `ProductGameplayStartResponse` types.
- Produces `MemoryProofService.authenticateSession()`, `getActiveExpedition()`, and `markGameplayStarted()`.

- [ ] **Step 1: Add failing service tests**

Cover these exact cases:

```ts
it('returns only a matching pre-mount run for its authenticated session', async () => {
  const started = await signedStart(service, keyPair, wallet)
  const session = service.authenticateSession(started.result.sessionCapability)
  expect(service.getActiveExpedition(started.result.start.runId, session)).toMatchObject({
    runId: started.result.start.runId,
    mission: 'gem-runner',
    status: 'STARTED',
    gameplayStartedAt: null,
  })
})

it('marks gameplay start once and makes the same operation idempotent', async () => {
  const started = await signedStart(service, keyPair, wallet)
  const session = service.authenticateSession(started.result.sessionCapability)
  expect(service.markGameplayStarted(started.result.start.runId, session).outcome).toBe('GAMEPLAY_STARTED')
  expect(service.markGameplayStarted(started.result.start.runId, session).outcome).toBe('GAMEPLAY_ALREADY_STARTED')
  expect(service.getWalletDailyStatus(wallet).expeditionsStarted).toBe(1)
})

it('rejects active recovery after gameplay has started', async () => {
  const started = await signedStart(service, keyPair, wallet)
  const session = service.authenticateSession(started.result.sessionCapability)
  expect(service.markGameplayStarted(started.result.start.runId, session)).toEqual({
    runId: started.result.start.runId,
    outcome: 'GAMEPLAY_STARTED',
  })
  expect(() => service.getActiveExpedition(started.result.start.runId, session)).toThrow('ACTIVE_RUN_UNAVAILABLE')
})
```

Also test session/run mismatch, expired sessions, missing runs, and terminal/non-`STARTED` state without creating a new run or attempt.

- [ ] **Step 2: Add the server-owned marker and complete wallet status**

Add `gameplayStartedAt: string | null` to `DurableExpeditionRun`, initialize it to `null` at atomic start, and return the full `WalletDailyStatus` fields (`dayKey`, `expeditionsStarted`, `expeditionsRemaining`, `rewardAlreadyReserved`, `nextResetAt`) from the memory service.

Extend `MemoryProofService` as follows:

```ts
authenticateSession(raw: string): RunSessionRecord
getActiveExpedition(runId: string, session: RunSessionRecord): ProductActiveExpedition
markGameplayStarted(runId: string, session: RunSessionRecord): ProductGameplayStartResponse
```

- [ ] **Step 3: Implement active validation inside the mutex boundary**

`getActiveExpedition()` must verify the authenticated session is bound to `runId`, the run is unexpired and `STARTED`, `gameplayStartedAt` is `null`, the durable mission and blueprint identity match, the state is sequence zero with `PLAYING` status, and the checkpoint is the trusted initial checkpoint. Return cloned blueprint/state/checkpoint data only.

`markGameplayStarted()` must verify the same session/run binding inside `mutex.run()`. Set the timestamp once and return `GAMEPLAY_STARTED`; if the timestamp already exists, return `GAMEPLAY_ALREADY_STARTED` without changing any record, attempt count, blueprint, or session.

- [ ] **Step 4: Run service tests**

```bash
npx vitest run server/expeditions/start.test.ts server/expeditions/active.test.ts
```

Expected: existing atomic start/idempotency tests and all active-marker tests pass.

- [ ] **Step 5: Commit the memory service**

```bash
git add server/expeditions/types.ts server/expeditions/memoryProofStore.ts server/expeditions/proofService.ts server/expeditions/start.test.ts server/expeditions/active.test.ts
git commit -m "feat: add authenticated active recovery"
```

### Task 3: Harden the Expedition HTTP Dispatcher and Session Cookie

**Files:**
- Modify: `server/expeditions/session.ts`
- Modify: `server/expeditions/http.ts`
- Modify: `server/expeditions/http.test.ts`
- Modify: `server/expeditions/session.test.ts`

**Interfaces:**
- Consumes `MemoryProofService` active/gameplay-start methods.
- Produces strict HTTP routes: `POST /api/expeditions/start-challenge`, `POST /api/expeditions/start`, `GET /api/expeditions/active?runId=<id>`, and `POST /api/expeditions/gameplay-start`.

- [ ] **Step 1: Add failing HTTP/security tests**

Extend the existing fixture tests with this concrete matching-session case:

```ts
it('returns the active blueprint only with the matching session cookie and runId', async () => {
  const fixture = createFixture()
  const security = {
    expectedOrigin: 'http://localhost:5173',
    expectedHost: 'localhost:5173',
    expectedProtocol: 'http' as const,
    secureCookie: false,
  }
  const challenge = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start-challenge',
    headers: { origin: security.expectedOrigin, host: security.expectedHost, 'content-type': 'application/json' },
    body: { wallet: fixture.wallet, mission: 'gem-runner' },
  }, security)
  const challengeBody = challenge.body as { challenge: string; dayKey: string; blueprintId: string; blueprintHash: string }
  const payload = serializeStartPayload({ version: 1, type: 'NIMHUNT_START_EXPEDITION', wallet: fixture.wallet, mission: 'gem-runner', dayKey: challengeBody.dayKey, challenge: challengeBody.challenge, blueprintId: challengeBody.blueprintId, blueprintHash: challengeBody.blueprintHash })
  const signed = { payload, publicKey: fixture.keyPair.publicKey.toHex(), signature: fixture.keyPair.sign(nimiqSignedMessageHash(payload)).toHex() }
  const started = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start',
    headers: { origin: security.expectedOrigin, host: security.expectedHost, 'content-type': 'application/json' },
    body: signed,
  }, security)
  const cookie = started.headers?.['set-cookie']
  const active = await dispatchExpeditionHttp(fixture.service, {
    method: 'GET',
    path: `/api/expeditions/active?runId=${(started.body as { runId: string }).runId}`,
    headers: { cookie, host: security.expectedHost, protocol: security.expectedProtocol },
  }, security)
  expect(active.status).toBe(200)
  expect(active.body).toMatchObject({ ok: true, mission: 'gem-runner', gameplayStartedAt: null })
})
```

Define `testSecurity()` in the test fixture as the exact `ExpeditionHttpSecurity` object used above. Add cases asserting that a run ID without a cookie and a valid cookie with a different run ID return `RUN_SESSION_INVALID`, cross-origin gameplay-start returns `MALFORMED_REQUEST`, exact gameplay-start retry returns `GAMEPLAY_ALREADY_STARTED`, every successful body omits `sessionCapability`, and wrong methods, non-JSON bodies, unknown fields, and oversized bodies return `405`/`400`/`413`.

- [ ] **Step 2: Define the explicit dispatcher security policy**

Extend `ExpeditionHttpRequest` with case-insensitive request headers, `host`, and `protocol`. Add a required options object:

```ts
export type ExpeditionHttpSecurity = {
  readonly expectedOrigin: string
  readonly expectedHost: string
  readonly expectedProtocol: 'http' | 'https'
  readonly secureCookie: boolean
}

export async function dispatchExpeditionHttp(
  service: MemoryProofService | null,
  request: ExpeditionHttpRequest,
  security: ExpeditionHttpSecurity,
): Promise<ExpeditionHttpResponse>
```

Mutations require an exact `Origin` equal to `expectedOrigin`. A read may omit `Origin` only when host and protocol exactly match the configured policy. Any supplied mismatching origin is rejected. Do not add CORS response headers or wildcard credential behavior.

- [ ] **Step 3: Enforce strict route/body/query parsing**

Require `application/json` for every POST, bound raw body size by `MAX_EXPEDITION_BODY_BYTES`, reject arrays and malformed JSON, and reject unknown keys. Accept exactly `{ wallet, mission }` for challenge, exactly `{ payload, publicKey, signature }` for start, and exactly `{ runId }` for gameplay-start. Parse `/active` with exactly one bounded `runId` query value.

Authenticate `/active` and gameplay-start from `parseRunSessionCookie(request.headers.cookie)` only. Map missing/invalid/expired/revoked sessions to `RUN_SESSION_INVALID`; map marker-present recovery to `ACTIVE_RUN_UNAVAILABLE`. Never accept a run ID as authorization.

- [ ] **Step 4: Fix cookie serialization**

Change `serializeRunSessionCookie()` to accept `secureCookie`, always use `Path=/api`, include both `Max-Age` and `Expires`, and cap expiry at the supplied run/session expiry and `RUN_SESSION_MAX_AGE_SECONDS`. Omit `Secure` only when `secureCookie === false`. Keep `HttpOnly`, `SameSite=Strict`, no `Domain`, and hash-only server persistence.

- [ ] **Step 5: Implement the four route responses**

`start-challenge` returns the normalized wallet and challenge fields without a cookie. `start` returns only `{ ok, outcome, ...start }` and sets the cookie. `/active` returns the typed active response without issuing a cookie or changing state. Gameplay-start returns only `{ ok, runId, outcome }` and never returns blueprint/recovery data.

Every response, including errors and `204 OPTIONS`, sets `cache-control: no-store`, `content-type: application/json; charset=utf-8` where a body exists, and `x-content-type-options: nosniff`.

- [ ] **Step 6: Run focused HTTP/session tests**

```bash
npx vitest run server/expeditions/http.test.ts server/expeditions/session.test.ts
```

- [ ] **Step 7: Commit the HTTP boundary**

```bash
git add server/expeditions/session.ts server/expeditions/http.ts server/expeditions/http.test.ts server/expeditions/session.test.ts
git commit -m "feat: expose secure active expedition routes"
```

### Task 4: Register Explicit Development-Only Proof Middleware

**Files:**
- Create: `server/expeditions/vitePlugin.ts`
- Test: `server/expeditions/vitePlugin.test.ts`
- Modify: `server/ledger/vitePlugin.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes `dispatchExpeditionHttp()` and `createMemoryProofService()`.
- Produces the development-only `/api/expeditions/*` middleware and local wallet-status read.

- [ ] **Step 1: Write runtime mode tests**

Test the pure runtime resolver with these exact expectations:

```ts
expect(resolveExpeditionRuntime({ mode: 'development', backend: 'memory', appOrigin: 'http://localhost:5173' })).toMatchObject({ backend: 'memory', secureCookie: false })
expect(resolveExpeditionRuntime({ mode: 'test', backend: 'memory', appOrigin: 'http://localhost:5173' })).toMatchObject({ backend: 'memory' })
expect(resolveExpeditionRuntime({ mode: 'preview', backend: 'memory', appOrigin: 'https://hunt.example' })).toMatchObject({ backend: 'unavailable', secureCookie: true })
expect(resolveExpeditionRuntime({ mode: 'development', backend: undefined, appOrigin: 'http://localhost:5173' })).toMatchObject({ backend: 'unavailable' })
```

Also assert that missing `NIMHUNT_APP_ORIGIN` fails closed rather than accepting arbitrary origins.

- [ ] **Step 2: Implement explicit runtime configuration**

Read `NIMHUNT_PROOF_BACKEND` and `NIMHUNT_APP_ORIGIN` with `loadEnv(mode, process.cwd(), '')`. Enable the memory service only when `backend === 'memory'` and mode is `development` or `test`. `configurePreviewServer()` always supplies `null` service, even when the environment says `memory`. Derive `secureCookie` from the explicit configured origin and allow HTTP omission only for development/test HTTP origins.

Seed the memory service with `createPublishedBootstrapBlueprints(utcDayKey(new Date()))`. Do not infer memory mode from missing Supabase credentials and do not construct a Postgres proof service.

- [ ] **Step 3: Forward complete request metadata and bounded bodies**

The Vite handler owns only these paths:

```text
/api/expeditions/start-challenge
/api/expeditions/start
/api/expeditions/active
/api/expeditions/gameplay-start
/api/wallet-daily-status
```

Forward method, path/query, raw body, lower-case headers, host, and `http`/`https` protocol to `dispatchExpeditionHttp()`. Use the existing bounded-body pattern and return `PROOF_UNAVAILABLE` through the dispatcher when the service is null.

- [ ] **Step 4: Remove path overlap from the old ledger middleware**

Remove `/api/expeditions/start` and `/api/wallet-daily-status` from `LEDGER_PATHS` in `server/ledger/vitePlugin.ts`. Leave public `/api/daily-hunt-status` and the existing accounting-only terminal/reward endpoints unchanged. The proof plugin must be registered before the ledger plugin in `vite.config.ts`.

- [ ] **Step 5: Run middleware tests and commit**

```bash
npx vitest run server/expeditions/vitePlugin.test.ts server/ledger/dailyLedger.test.ts
git add server/expeditions/vitePlugin.ts server/expeditions/vitePlugin.test.ts server/ledger/vitePlugin.ts vite.config.ts
git commit -m "feat: gate proof middleware by runtime mode"
```

### Task 5: Add the Typed Browser Proof API

**Files:**
- Create: `src/api/expeditionProof.ts`
- Test: `src/api/expeditionProof.test.ts`
- Modify: `src/api/dailyHunt.ts`

**Interfaces:**
- Consumes `src/domain/expeditionProof.ts` and `src/domain/startAuthorization.ts`.
- Produces `requestStartChallenge()`, `authorizeStart()`, `fetchActiveExpedition()`, `markGameplayStarted()`, and strict parsers.

- [ ] **Step 1: Write parser tests before implementation**

Cover valid responses and rejection of missing IDs, unsupported rules/room/blueprint versions, missing blueprint identity, mission mismatch, invalid run state, incomplete object arrays, `gameplayStartedAt !== null`, unknown response shapes, and any response containing `sessionCapability`.

Use a valid `createPublishedBootstrapBlueprint()` fixture but do not recompute or assert the authoritative blueprint hash in browser code.

- [ ] **Step 2: Implement strict structural parsers**

Implement `parseStartChallengeResponse`, `parseStartResult`, `parseActiveExpedition`, and `parseGameplayStartResponse`. Validate every required blueprint-owned field: spawn, goblins and patrol routes, gems, chests and loot, sword/potion nullability, hazards, boulders, key, gate, objective, mission parameters, timed hazards, versions, IDs, hashes, and ISO timestamps. Require `blueprint.mission === response.mission` and supported `RULES_VERSION`, `ROOM_VERSION`, and `BLUEPRINT_VERSION`.

The parser may validate shape and versions but must not import `@nimiq/core` or recompute `blueprintHash` in the browser.

- [ ] **Step 3: Implement same-origin fetch helpers**

Every helper uses `credentials: 'same-origin'`, `cache: 'no-store'`, `accept: 'application/json'`, and JSON content type for POST. Use these request bodies exactly:

```ts
{ wallet, mission }
{ payload, publicKey, signature }
{ runId }
```

Convert network failures into a non-secret `NETWORK_ERROR` API error so the coordinator can distinguish them from ordinary server rejection. Convert known server error strings to typed `ExpeditionProofErrorCode` values without retaining or logging raw response bodies.

- [ ] **Step 4: Make wallet status explicit and credential-safe**

Update `fetchWalletDailyStatus()` to use `credentials: 'same-origin'`, strict response parsing, and no optimistic values. Add an optional wallet-status refresh path used only with an in-memory wallet already obtained by a successful product start; it must never initialize the provider.

- [ ] **Step 5: Run API tests and commit**

```bash
npx vitest run src/api/expeditionProof.test.ts src/components/play/huntStatusView.test.ts
git add src/api/expeditionProof.ts src/api/expeditionProof.test.ts src/api/dailyHunt.ts
git commit -m "feat: add strict product proof client"
```

### Task 6: Implement the Lazy Product-Start Coordinator

**Files:**
- Create: `src/components/play/productStart.ts`
- Test: `src/components/play/productStart.test.ts`
- Create: `src/components/play/useProductStart.ts`
- Modify: `src/integrations/nimiq/nimiqErrors.ts` only if a safe product-specific message mapper is required; do not change `useNimiq.ts`.

**Interfaces:**
- Consumes existing `initializeNimiqProvider()`, `listNimiqAccounts()`, and `signNimiqMessage()` helpers plus the typed proof API.
- Produces `useProductStart()` with `begin(mission)`, `selectAccount(account)`, `authorize()`, `retryStart()`, and `cancel()` actions.

- [ ] **Step 1: Define and test the pure state machine**

Represent these statuses exactly:

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

Tests must assert that only `IDLE` can begin, duplicate begin actions are ignored, multiple accounts require explicit selection, the selected account cannot change during an attempt, cancellation clears transient values and sets the required copy, and only `STARTED` carries a `StartResult`.

- [ ] **Step 2: Implement lazy account and challenge flow**

`begin(mission)` must initialize the provider and call `listAccounts()` only after the Start button action. One account proceeds directly; multiple accounts enter `SELECTING_ACCOUNT`. `selectAccount()` accepts only one account from that returned list and then calls `requestStartChallenge()` once. The coordinator must not call `listAccounts()` again during the attempt.

Build the canonical payload from the server-normalized `challenge.wallet` and challenge fields. Store it only in in-memory React state for display/signing; never use local storage or a URL.

- [ ] **Step 3: Implement exact authorization and recovery**

`authorize()` is valid only in `AWAITING_START_SIGNATURE`, displays the exact canonical payload before signing, and calls `signNimiqMessage(provider, canonicalPayload)`. Signature cancellation/rejection sets `CANCELLED`, clears the pending signature, and never invokes `/start`.

On `/start` network failure, retain the exact signed request and enter `RECOVERING_START`. `retryStart()` submits that identical object. Accept both `START_CREATED` and `START_ALREADY_CREATED` only from the server response for that exact request. Do not create a new challenge or account flow automatically.

- [ ] **Step 4: Map failures without silent downgrade**

Map `DAILY_EXPEDITION_LIMIT_REACHED` to `LIMIT_REACHED`, `DAILY_BLUEPRINT_UNAVAILABLE` to `BLUEPRINT_UNAVAILABLE`, `PROOF_UNAVAILABLE`/network setup failure to `PROOF_UNAVAILABLE`, and invalid signature/binding/challenge errors to `REJECTED`. Only the first three states may offer the explicit Practice CTA. Use these exact copy strings:

```text
You've used today's 3 reward-eligible expeditions.
Today's reward expedition isn't available yet.
Reward expeditions are temporarily unavailable.
Expedition start was cancelled. No daily expedition was used.
No daily expedition has been used yet.
```

- [ ] **Step 5: Expose the hook with stale-promise protection**

Use a monotonically increasing attempt token and mounted flag. Ignore all late provider/API results after cancel, reset, unmount, or a newer attempt. Disable every Start/Authorize action while a flow is active. Invoke `onStarted(start, normalizedWallet)` exactly once per successful start.

- [ ] **Step 6: Run coordinator tests and commit**

```bash
npx vitest run src/components/play/productStart.test.ts src/integrations/nimiq/nimiqClient.test.ts
git add src/components/play/productStart.ts src/components/play/productStart.test.ts src/components/play/useProductStart.ts
git commit -m "feat: coordinate deliberate product starts"
```

### Task 7: Wire the Start UI and Honest Attempt Status

**Files:**
- Create: `src/components/play/ProductStartPanel.tsx`
- Modify: `src/components/play/PlayShell.tsx`
- Modify: `src/components/play/MissionBrief.tsx`
- Modify: `src/components/play/HuntStatus.tsx`
- Modify: `src/components/play/huntStatusView.ts`
- Modify: `src/components/play/useDailyHuntStatus.ts`
- Modify: `src/components/play/PlayShell.module.css` only for states using existing design tokens
- Modify: associated UI tests

**Interfaces:**
- Consumes `useProductStart()` and the wallet-status source.
- Produces deliberate account selection, exact authorization display, explicit Practice offers, and a single navigation callback after `STARTED`.

- [ ] **Step 1: Add UI tests for wallet-free and active states**

Assert that rendering `/play` and opening a mission brief does not call `initializeNimiqProvider`, the brief does not display a fake `3 expeditions left`, and the Start button changes to the coordinator state only after it is clicked. Assert the exact `Authorize this expedition` label and canonical payload are visible before signing.

- [ ] **Step 2: Implement `ProductStartPanel`**

Use existing `PlayShell` classes and `44px` minimum controls. Render:

```text
REQUESTING_ACCOUNT       Requesting Nimiq account…
SELECTING_ACCOUNT        explicit buttons for each returned account
REQUESTING_CHALLENGE     Preparing this expedition…
AWAITING_START_SIGNATURE exact JSON + Authorize this expedition
SUBMITTING_START         Starting expedition…
RECOVERING_START         Connection interrupted. Retry the same authorization.
CANCELLED                Expedition start was cancelled. No daily expedition was used.
LIMIT_REACHED            You've used today's 3 reward-eligible expeditions.
BLUEPRINT_UNAVAILABLE    Today's reward expedition isn't available yet.
PROOF_UNAVAILABLE        Reward expeditions are temporarily unavailable.
REJECTED                 literal server/provider rejection and a fresh retry action
```

Account/selection/signature cancellation returns to the brief without a Practice offer. Limit/blueprint/proof states provide a separate deliberate `Start Practice Run` button.

- [ ] **Step 3: Navigate only after `STARTED`**

In `PlayShell`, keep the brief open while the coordinator runs. On the first `STARTED` result, close the sheet and navigate to:

```text
/play?run=<mission>&runId=<server-run-id>
```

Guard navigation with a ref keyed by `runId` so rerenders cannot navigate twice. Retain only the normalized wallet in an in-memory module value if needed for a later status refresh; never retain the session capability, signature, or challenge in storage.

- [ ] **Step 4: Remove fake wallet attempt values**

Represent wallet attempts as unknown until a deliberate account has successfully started an expedition. Keep public treasure slots wallet-free. After `STARTED`, fetch `fetchWalletDailyStatus(normalizedWallet)` and render authoritative values. The UI must never decrement attempts before the server response.

- [ ] **Step 5: Run UI/status tests and commit**

```bash
npx vitest run src/components/play/expeditionFlow.test.ts src/components/play/huntStatusView.test.ts
git add src/components/play/ProductStartPanel.tsx src/components/play/PlayShell.tsx src/components/play/MissionBrief.tsx src/components/play/HuntStatus.tsx src/components/play/huntStatusView.ts src/components/play/useDailyHuntStatus.ts src/components/play/PlayShell.module.css
git commit -m "feat: wire deliberate expedition start UI"
```

### Task 8: Add Strict Product Locators and the Pre-Mount Gate

**Files:**
- Create: `src/components/play/ProductExpeditionGate.tsx`
- Create: `src/components/play/productGate.test.ts`
- Modify: `src/components/play/expeditionFlow.ts`
- Modify: `src/components/play/expeditionFlow.test.ts`
- Modify: `src/routes/PlayPage.tsx`

**Interfaces:**
- Consumes `fetchActiveExpedition()` and `markGameplayStarted()`.
- Produces a product route that mounts Phaser only after both authenticated operations succeed.

- [ ] **Step 1: Test locator parsing first**

Update route tests so:

```ts
expect(resolvePlayRoute({ dev: null, run: 'gem-runner', runId: null, practice: null })).toEqual({ view: 'invalid-product', reason: 'RUN_ID_REQUIRED' })
expect(resolvePlayRoute({ dev: null, run: 'gem-runner', runId: 'run-1', practice: null })).toEqual({ view: 'product-expedition', mission: 'gem-runner', runId: 'run-1' })
expect(resolvePlayRoute({ dev: null, run: null, runId: null, practice: 'gem-runner' })).toEqual({ view: 'practice', mission: 'gem-runner' })
expect(resolvePlayRoute({ dev: 'nimiq', run: 'gem-runner', runId: 'run-1', practice: null })).toEqual({ view: 'nimiq' })
```

Unknown or malformed locators return the shell or a non-game status view. No route with a missing `runId` may render `ExpeditionView`.

- [ ] **Step 2: Implement the authenticated gate**

For a valid product locator, `ProductExpeditionGate` must:

1. Call `fetchActiveExpedition(runId)` once for the current route attempt.
2. Require `active.mission === urlMission`, supported versions, `gameplayStartedAt === null`, and a complete parsed blueprint/state.
3. Call `markGameplayStarted(active.runId)` with the same authenticated route attempt.
4. Accept `GAMEPLAY_STARTED` or exact retry `GAMEPLAY_ALREADY_STARTED` while the trusted active response remains in current SPA memory.
5. Render the product `ExpeditionView` exactly once with the active response.

It must never call start, initialize Nimiq, issue a replacement session, reset a run, or pass a URL mission into Phaser. Active/session failure shows a non-game error with Back to missions; it does not silently switch to Practice.

- [ ] **Step 3: Handle lost gameplay-start responses safely**

Retain the active response and exact `runId` in a ref while mounted. If the gameplay-start response is lost, retry the exact same `runId` operation and accept `GAMEPLAY_ALREADY_STARTED`; mount once. After a browser/WebView reload there is no active response in memory, so `/active` sees `gameplayStartedAt` and returns `ACTIVE_RUN_UNAVAILABLE`; do not call gameplay-start or remount.

- [ ] **Step 4: Add singleton and cleanup guards**

Use route-attempt and mount refs so duplicate effects, React rerenders, repeated active responses, or StrictMode cannot create two Phaser instances. On route exit, let the existing game hook destroy exactly once.

- [ ] **Step 5: Run route/gate tests and commit**

```bash
npx vitest run src/components/play/expeditionFlow.test.ts src/components/play/productGate.test.ts
git add src/components/play/ProductExpeditionGate.tsx src/components/play/productGate.test.ts src/components/play/expeditionFlow.ts src/components/play/expeditionFlow.test.ts src/routes/PlayPage.tsx
git commit -m "feat: gate product gameplay on active session"
```

### Task 9: Pass the Server Blueprint into Product Phaser

**Files:**
- Modify: `src/game/createNimHuntGame.ts`
- Modify: `src/game/config/createGameConfig.ts`
- Modify: `src/game/scenes/AngkorDevScene.ts`
- Modify: `src/game/events/gameEvents.ts`
- Modify: `src/game/world/room01.ts`
- Modify: `src/components/play/useAngkorRun.ts`
- Modify: `src/components/play/ExpeditionView.tsx`
- Modify: `src/components/play/GameDevView.tsx`
- Modify: `src/game/scenes/AngkorDevScene.test.ts`
- Create: `src/game/productBlueprint.ts`
- Test: `src/game/productBlueprint.test.ts`

**Interfaces:**
- Consumes `ProductActiveExpedition` from the gate.
- Produces a discriminated `createNimHuntGame()` option with the exact server blueprint and trusted initial state.

- [ ] **Step 1: Define the discriminated game options and write handoff tests**

Use this shape:

```ts
export type CreateGameOptions =
  | { readonly mode: 'dev'; readonly mission: MissionType }
  | {
      readonly mode: 'product'
      readonly mission: MissionType
      readonly blueprint: ExpeditionBlueprint
      readonly initialState: ReplayState
    }
```

Test that product construction requires a blueprint and initial state, that HUD targets/spawn derive from them, and that a blueprint with changed object coordinates is not replaced by `ROOM_01_*` constants.

- [ ] **Step 2: Add blueprint-to-runtime mapping without changing room geometry**

Keep `ANGKOR_ROOM_01` as stable local geometry for the supported room version. Implement `src/game/productBlueprint.ts` as the focused runtime mapping from an `ExpeditionBlueprint` to `RoomContents`, `PuzzleObjects`, goblin spawn/patrol, chest placements, sword, and potion. The product scene must read:

```text
spawn                 blueprint.spawn
goblins               blueprint.goblins
gems                  blueprint.gems
chests                blueprint.chests
sword/potion          blueprint.sword / blueprint.potion
hazards               blueprint.hazards
boulders              blueprint.boulders
key/gate/objective    blueprint.key / blueprint.gate / blueprint.objective
mission targets       blueprint.missionParameters
```

Stable renderer assets, tile geometry, and supported Room 01 version remain local. No product coordinate fallback is permitted when a blueprint field is absent or malformed; the API parser rejects it before mount.

- [ ] **Step 3: Hydrate the scene from trusted initial state**

`createNimHuntGame()` passes the product blueprint and initial replay state to `createGameConfig()` and `AngkorDevScene`. Initialize HUD, player, run, puzzle, items, chests, and goblin state from the trusted initial state. Keep the current local constructor path for `GameDevView` and Practice.

Update every `AngkorDevScene` reference currently using `ROOM_01_CONTENTS`, `ROOM_01_PUZZLE`, `ROOM_01_GOBLIN`, `ROOM_01_SWORD`, `ROOM_01_POTION`, or `ROOM_01_CHESTS` to use the selected runtime data. Pass the selected gate coordinate to goblin movement where the pure helper supports it. Preserve existing mechanics and tests.

- [ ] **Step 4: Separate product/practice proof behavior**

`ExpeditionView` receives an explicit mode. Product and Practice do not invoke `useVaultSeal`, `/api/expeditions/vault-seal`, checkpoint traffic, or any claim/reward path in this slice. Keep the existing Vault seal implementation and its tests isolated rather than refactoring it. Dev remains local and proof-free.

- [ ] **Step 5: Wire the hook and route modes**

Update `useAngkorRun()` to accept the discriminated options. `GameDevView` calls `{ mode: 'dev', mission }`; Practice calls the local constructor; the product gate calls `{ mode: 'product', mission: active.mission, blueprint: active.blueprint, initialState: active.state }`. Product HUD still uses `PRODUCT_HUD_MODE` and contains no debug/reset controls.

- [ ] **Step 6: Run game handoff tests**

```bash
npx vitest run src/game/scenes/AngkorDevScene.test.ts src/game/replay/engine.test.ts src/components/play/expeditionFlow.test.ts
```

Expected: existing Room 01 movement/puzzle behavior remains green and new blueprint handoff tests demonstrate server-owned coordinates.

- [ ] **Step 7: Commit the game handoff**

```bash
git add src/game/createNimHuntGame.ts src/game/config/createGameConfig.ts src/game/scenes/AngkorDevScene.ts src/game/events/gameEvents.ts src/game/world/room01.ts src/game/productBlueprint.ts src/game/productBlueprint.test.ts src/components/play/useAngkorRun.ts src/components/play/ExpeditionView.tsx src/components/play/GameDevView.tsx src/game/scenes/AngkorDevScene.test.ts
git commit -m "feat: launch product game from server blueprint"
```

### Task 10: Integrate, Verify, and Record the Checkpoint

**Files:**
- Modify: `.agent-state/project-state.md`
- Modify: `.agent-state/memory.md` only for durable new decisions
- Modify: `.agent-state/left-off.md`
- Verify: all changed application/test/config files

**Interfaces:**
- Consumes all previous task outputs.
- Produces verified authenticated product start behavior and a concise continuity checkpoint.

- [ ] **Step 1: Run the focused verification matrix**

```bash
npx vitest run server/expeditions server/ledger src/api src/components/play src/game
```

Confirm coverage for:

- deliberate-only provider initialization and one-account/multi-account selection;
- zero-attempt cancellation paths;
- duplicate Start suppression and exact signed-start retry;
- challenge expiry/day expiry/invalid binding handling;
- limit, blueprint unavailable, proof unavailable, and non-downgrade rejection paths;
- raw capability absence, cookie flags/expiry/path, session/run binding, cross-origin mutation rejection, and strict body/query parsing;
- preview/production memory fail-closed behavior;
- bare locator/missing cookie/mission mismatch/incomplete blueprint never mounting Phaser;
- pre-mount active recovery, gameplay-start idempotency, and post-marker reload rejection;
- one Phaser instance, route cleanup, exact blueprint-owned object values, Practice isolation, and unchanged Dev behavior.

- [ ] **Step 2: Run the required repository commands**

```bash
npm test
npm run lint
npx tsc -b
npm run build
git diff --check
```

Expected baseline is at least `229 passed, 1 skipped` plus the new focused tests. The existing large game-chunk warning may remain; no new warning or type error is acceptable.

- [ ] **Step 3: Run the final redacted security scan**

Repeat the Task 0 tracked-file/diff/history scan. Confirm `.env` remains ignored/untracked, `.env.example` has placeholders only, no `VITE_*` service-role variable exists, and no raw cookie/session capability, private key, seed phrase, bearer token, Nimiq private material, or replacement credential appears. Report paths/classifications only.

- [ ] **Step 4: Smoke the non-wallet routes**

With the explicit local proof environment configured, verify these routes load without console/API errors:

```text
/
/play
/play?dev=nimiq
/play?dev=game
/play?practice=gem-runner
```

Verify `/play` and mission brief opening do not initialize the provider. Verify a bare `/play?run=gem-runner` renders no Phaser instance.

- [ ] **Step 5: Perform manual Nimiq Pay verification if available**

Inside real Nimiq Pay, verify account approval, multi-account selection if available, exact start authorization, one durable attempt, account/signature cancellation, and an induced lost-response exact retry. Record the actual result. If the environment is unavailable, explicitly record `NOT RUN: real Nimiq Pay unavailable`; do not substitute a browser simulation for this manual gate.

- [ ] **Step 6: Update continuity files before ending**

Record the new phase, implementation commit(s), verification output, known manual/Postgres/device gates, and the next concrete milestone in `.agent-state/project-state.md`, `.agent-state/memory.md`, and `.agent-state/left-off.md`. Do not claim Postgres/device validation or reward completion.

- [ ] **Step 7: Commit only the completed feature and state updates**

Inspect `git status`, `git diff`, and `git diff --cached`; stage only the authenticated product-start implementation, its tests, safe `.env.example` remediation, and intentional continuity updates. Leave unrelated user files untouched.

```bash
git add .agent-state/project-state.md .agent-state/memory.md .agent-state/left-off.md
git commit -m "docs: record authenticated start checkpoint"
```

## Self-Review Checklist

- [ ] Every route in the approved design has a task: start challenge, signed start, active recovery, gameplay-start, and explicit Practice.
- [ ] Every security requirement has a task: secret remediation, explicit backend mode, strict HTTP parsing, origin policy, cookie flags/expiry, no-store headers, no raw capability, and fail-closed preview/production.
- [ ] Every coordinator state and cancellation/recovery behavior has a task and focused tests.
- [ ] The gameplay-start lost-response clarification is covered by an exact retry test and the post-reload `/active` rejection test.
- [ ] Product blueprint ownership is covered for every object field listed in the spec, while room geometry remains version-bound local data.
- [ ] No task adds a Postgres proof adapter, device validation, checkpoints, claims, payout, or mechanics.
- [ ] No task modifies `useNimiq` or the locked Nimiq dev panel behavior.
- [ ] No raw secret or credential value appears in this plan.
