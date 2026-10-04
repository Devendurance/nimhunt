# Angkor V2 production integration

Branch: `feat/angkor-v2-production-integration`. Base: `81bdb84c8bc11fd801563457912dab7da47d14a2`.

The real expedition start/checkpoint/verification/claim pipeline now supports all three completed Angkor V2 missions. No merge, deployment, production migration, treasury access or NIM transfer was performed.

## Version and authority

V2 uses rules `nimhunt-angkor-v2-rules-v1`, room `angkor-nine-stages-v1`, blueprint `angkor-expedition-blueprint-v1`, and transcript2. The official daily blueprint binds the compiled nine-stage content hashes. Changing authored rules/content requires a new version; historical V2 content must remain available to verify its runs.

Actions are strictly shaped `V2_MOVE`, `V2_TICK`, and `V2_CONTINUE`, each bound to the current stage and contiguous expedition sequence. They contain no results, carry, HP, collectible totals or boss assertions. The shared Phaser-free adapters execute all nine existing reducers on the server. Stage reports/carry are generated internally. Continue requires a reducer-earned transition and advances exactly one stage. Final eligibility requires all three legitimate results and the mission's final objective/boss/escape.

Full reducer state, local puzzle/boss state and cumulative results are hashed. Verification reconstructs persisted ordered batches from the initial blueprint and compares replay/state/transcript hashes. V2 permits30000 actions with unchanged eight-action HTTP batches and body limits; legacy remains256. Moves cannot indefinitely omit simulation ticks or bank idle ticks to freeze hazards. A separate server-clock admission guard rejects manufactured future movement/ticks. MOVE and TICK overlap on one timeline, so the V2 speed bound uses their maximum duration rather than adding both. Legacy timing and hazard deadlines are unchanged.

Shared hashing uses synchronous SHA-256 (`@noble/hashes`) without loading blockchain WASM on Practice. Domain strings and canonical legacy bytes are unchanged; existing proof/claim tests and independent SHA-256 vectors verify compatibility.

## Persistence and compatibility

Existing JSON snapshots and checkpoint-batch tables persist the exact current stage, local state, cumulative progress, carry and ordered boundaries. V2 `/active` replays and audits these before returning them. Reload restores the last server-acknowledged checkpoint, including player position, consumed items, opened treasure/gates and mechanisms; it never consumes another attempt or resets to Stage I. Up to12 predicted unacknowledged actions may be rolled back by an abrupt browser kill. Save-and-leave/blur flush; connection backpressure pauses movement/ticks together. Retry resends the identical batch.

The existing wallet session/recovery/expiry rules remain in effect, including UTC attempt expiry. Historical blueprint-v1/v2, transcript1, verifier, claims and initial-only legacy resume behavior are preserved. Legacy active runs render with the original scene. Outstanding unsigned legacy start challenges should be restarted after cutover; existing authorized/completed/claimable runs stay bound to their stored blueprint.

Migration `server/ledger/sql/020_angkor_v2_expeditions.sql` is forward-only and transactional. It allows one published blueprint per day/mission/rules family, keeps the old publication lookup legacy-only, adds a service-role-only V2 lookup, and scopes the larger append limit to the exact V2 version triple. It rewrites no historical run, proof or claim JSON. This repository uses numbered SQL migrations and has no Drizzle schema/scripts; no Drizzle tooling or production migration was introduced/run.

## UI and Practice

`/play` Reward Run uses the existing deliberate wallet/start authorization, gameplay-start marker and authenticated gate. V2 mounts the approved scrolling renderer,145ms traversal, held Dpad/buffer, camera/depth/occlusion and item emphasis. It shows stage objectives, exact HP, cumulative counters, carried items, stage transitions and final results. Completion first flushes checkpoints, then requests server verification; the existing claim UI only enables from the verified response. Vault Breaker retains its additional signed Vault Seal requirement.

Practice routes are `/play?practice=gem-runner`, `/play?practice=chest-hunter`, and `/play?practice=vault-breaker`. Their local session has no proof transport, reward/start/claim/recovery hooks, wallet requirement or attempt consumption. All three render V2 without wallet/profile setup. Browser QA observed no mission start/authorization/checkpoint/claim traffic. A700ms held-input check moved Outer Ruins from(3,20) to(7,20), with five sequential simulation ticks and100HP. No dev debug controls are shown.

Mobile390×844 screenshots:

- `output/playwright/angkor-v2-practice-gem-mobile.png`
- `output/playwright/angkor-v2-practice-chest-mobile.png`
- `output/playwright/angkor-v2-practice-vault-mobile.png`

## Reward and security validation

Signed Nimiq test-key starts consume one attempt for the entire expedition. Full recorded three-stage actions for every mission pass both the memory service and ephemeral PostgreSQL/PLpgSQL RPC harness. PostgreSQL tests apply all numbered SQL migrations to a fresh local WASM database, resume after service restart, verify final HP/results, enforce the Vault Seal, reserve through the existing signed claim pipeline and assert zero payout rows. No production URL/credentials or payout workers enter that harness.

Malformed/security coverage includes skipped stages, premature/reordered Continue, forged result/carry/HP/boss fields, snapshot/result mutation even with recomputed snapshot hashes, invalid sequence/direction, omitted/banked/future ticks, action mutation, terminal duplicate completion, wrong-version actions/transcripts, acknowledgement mismatch and atomic rejection without another attempt. Existing stage tests cover open-once collectibles/chests, carry reset and boss/access requirements. Existing wallet/proof/risk/Reward Week/claim/reservation/payout tests remain release gates. No economics, caps, reservation policy, payout automation or treasury settings changed.

## Reproducible checks

Run `npm ci`, then `npm run test:release`, `npm run build`, `npm run lint`, `npx tsc -b`, and `npm run typecheck:server`.

`test:release` runs the complete suite with two workers. Earlier reported legacy solver timeouts did not reproduce in the standard first run or the bounded release run. No tests were removed and no global timeout was inflated. The new PostgreSQL WASM harness explicitly allows180s per full-mission persistence test: thousands of eight-action RPCs are substantially slower in WASM. Redundant retry checks were reduced to representative first/beyond256/final batches; memory tests retain retries throughout. Legacy default15s timeouts are untouched.

Final counts and exit results are recorded in `RESULTS.md`. Build retains the existing large Phaser/main chunk warning. Live Supabase/Docker suites require their existing opt-in harness and are reported as skipped, not passed. Docker was unavailable here; the always-on ephemeral PostgreSQL engine exercises the new SQL instead.

## Production release checklist — owner gate

1. Review the branch and final results; complete the normal human production/mobile acceptance gate. Do not merge/deploy as part of this milestone.
2. Confirm production already has migrations001–019 and take the normal backup. Apply020 transactionally through the existing owner SQL workflow before releasing V2 application code. No new environment variables are required.
3. Confirm the V2 publication RPC is executable only by service_role; old lookup returns legacy content; both publication families coexist. Inspect action admission:256 legacy /30000 exact V2.
4. Run the existing opt-in proof integration harness against an approved isolated/staging database, including legacy claimable-run fixtures and migration privileges. Do not run payout execution or transfer NIM.
5. Re-run the exact release commands above on the immutable release commit. Verify wallet-authorized start/resume, all three mission completions, Vault Seal and existing claim reservation in the supported test environment.
6. Confirm current Reward Week policy remains configured through existing claim-time rules and existing env. Make no economics or payout configuration edits.
7. Only after the final owner release gate, perform separately authorized merge/deployment. Monitor start/checkpoint/verify failures and legacy claim compatibility. Application rollback may select the legacy code;020 keeps its lookup/limit intact and must not be destructively rolled back or delete V2 rows.

Integration readiness does not authorize production migration, merge, deployment or payouts.
