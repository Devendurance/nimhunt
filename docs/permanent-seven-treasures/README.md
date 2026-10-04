# Permanent seven-treasure economy

Branch: `feat/permanent-7-treasure-economy`, based on approved HP-meter `b31eb587bdb7ce5bd7755a9f34929851c0648c56`. This slice does not deploy or activate production.

## Policy and authority

- New-policy UTC days have exactly seven first-come reservations, each worth **100,000,000 Luna / 1,000 NIM**. Maximum new daily reward liability is **700,000,000 Luna / 7,000 NIM**.
- Three expedition attempts/day and one reservation/wallet/day remain unchanged. Practice, failed and unverified runs never reserve a reward.
- Signed claims, verification, risk checks and wallet authorization remain intact. Neither the client nor a payout animation chooses economics or slots.
- Database `daily_reward_pools.total_slots` is authoritative for each persisted day. Memory defaults use seven; explicit historical Reward Week policy continues to use69.
- SQL pool/wallet/claim locks plus `reserved_slots < total_slots` enforce atomic capacity. Reservation numbers are persisted for new claims and remain stable on retries. Eight or more concurrent eligible claims cannot create an eighth reservation.
- Existing payout worker, automation flags, reserve safeguards, treasury credentials, scheduler and execution architecture remain unchanged. Only economics resolution/validation changes.

## Migration021 and historical compatibility

`server/ledger/sql/021_permanent_seven_treasures.sql` is forward-only, transactional SQL in the existing approved migration workflow. It has **not** been applied to production.

It installs a singleton UTC cutover, sets the new default to7, assigns pool policy at insertion, allows stored7/69 pools, bounds reservations against stored capacity and forbids pool policy changes. It replaces the existing status/claim/reservation/risk RPC definitions without changing their signatures. New claims freeze100,000,000 Luna at preparation. The migration also stores immutable reservation numbers.

It updates no historical pool/claim rows and leaves migrations001–020 unchanged. Previously RESERVED amounts remain immutable. Legacy claims with NULL amounts retain the immutable-day policy fallback introduced in018; retain the exact historical Reward Week configuration, including its enabled flag and UTC window. Permanent policy overrides the event only for new-policy days. Pre-cutover baseline remains the repository's historical10,000,000 Luna amount.

Claims expire at the next UTC reset. A pre-cutover PREPARED claim cannot finalize after that reset and cannot turn into a new1,000-NIM claim. Existing RESERVED claims remain readable/payable at their stored historical amounts. Retired event support is retained for historical records, without Reward Week public advertising.

App/DB policy mismatch rejects new claims with REWARD_UNAVAILABLE. Incorrect permanent amount/cap configuration fails closed, including a cap even one Luna above/below700,000,000.

## Public presentation

Hunt displays `7 DAILY TREASURES`, `1,000 NIM EACH`, `7,000 NIM SHARED DAILY`, `FIRST COME, FIRST SERVED`, remaining treasures and UTC countdown. Zero remaining shows SOLD OUT. Historical pools display their real stored counts, without falsely advertising new economics. Reservation copy no longer hardcodes69. API parsers accept both supported stored capacities7/69.

Screenshots use the real local `/play` Hunt component at390×844 with read-only seven-slot API fixtures; no wallet/start/claim writes:

- `output/playwright/seven-treasures-available-390.png`
- `output/playwright/seven-treasures-sold-out-390.png`

`mobile-qa.txt` reproduces the captures, blocks all non-GET API requests and asserts no horizontal overflow. Local anonymous payout-status GET400 is an existing authorization/malformed boundary, not payout execution.

## Owner-only activation sequence

1. Review this branch and approve a separate production release. No merge/deploy was performed here.
2. Confirm the historical baseline is10,000,000 Luna and preserve all historical Reward Week values for NULL-amount legacy claims. Inspect pending/submitted liabilities and treasury reserve before enabling the higher amount.
3. Choose a future UTC midnight with enough deployment time. Run021 once through the approved Supabase SQL workflow with database-owner privileges. Its default boundary is the next UTC midnight when run. If more lead time is needed, set the migration's initial `starts_at` INSERT to the chosen later UTC midnight **before running it**, rather than changing policy after activation.
4. Record the final `SELECT starts_at FROM public.permanent_reward_policy WHERE singleton` output. Use precisely that ISO UTC midnight in the server env below. Do not apply SQL from this harness, rewrite existing pools, or remove historical rows.
5. Read-only check for pre-existing69-slot pools on/after the chosen boundary. If any exist, do not rewrite them: choose a later untouched boundary before migration/activation. A mismatch deliberately blocks claims rather than increasing liability.
6. Set production server-only variables together: `NIMHUNT_REWARD_AMOUNT_LUNA=100000000`, `NIMHUNT_MAX_DAILY_REWARD_LUNA=700000000`, `NIMHUNT_PERMANENT_REWARDS_STARTS_AT=<exact recorded UTC midnight>`. No VITE reward variables. Preserve treasury minimum reserve, secrets, payout flags, automation control and historical Reward Week settings.
7. Release approved code through the normal main/Vercel flow **before the boundary**. Before that date the old day's stored69-slot policy and historical economics continue. After it, new days use7/100,000,000. If rollout misses the boundary, the old app fails closed against new-policy SQL; do not work around this by editing claims/pools.
8. At reset, read daily status and confirm7/7; verify protected endpoint auth boundaries and historical claim lookup. Do not create test financial records, execute payout or send NIM during release smoke. Monitor claims/config mismatch errors and ordinary automation through existing owner procedures.

Do not roll back only the app after activation: the old app must not finalize new-policy claims at an old amount. Use a reviewed forward fix; database guards intentionally fail closed.

## Treasury preflight

Minimum unencumbered coverage is **7,000 NIM daily maximum + configured minimum reserve + outstanding historical/pending/submitted liabilities not already covered + fees**. Avoid counting already-debited submitted funds twice when reconciling on-chain balance.

The harness's existing local reserve is10,000,000 Luna =100 NIM, so its known floor is **710,000,000 Luna / 7,100 NIM plus outstanding liabilities and fees**. This is not proof of the production reserve or balance. Production pending/submitted liabilities were not accessed and must not be assumed zero. Existing per-transaction fee constant is0 Luna; retain additional funding if the configured network/owner fee policy requires it.

Owner read-only inventory should include unpaid RESERVED claims not yet in reward_payouts, and PENDING/PROCESSING/SUBMITTED/FAILED_RETRYABLE payouts, deduplicated by claim ID. Retain stored payout/claim amounts; resolve legacy NULL claims by historical day. No treasury funding or payout execution occurred in this slice.

## Verification

Final gates: `npm run test:release` **1322 passed / 69 existing opt-in skips**,172 test files passed /5 skipped,144.05s. `npm run build`, `npm run lint`, `npx tsc -b`, `npm run typecheck:server` and `git diff --check` passed. The build retains its existing large-chunk warning. No tests were removed or timeouts increased.

Focused reward/ledger/risk/claim/payout-config/Reward Week/Hunt-view tests:63 passed; subsequent historical PostgreSQL + full V2 proof integration checks:8 passed. Initial release runs caught stale69-slot/10,000,000-Luna expectations; these were corrected for new-policy fixtures while historical tests remain.

Focused PostgreSQL tests apply001–021 in an isolated PGlite database and prove preserved pre-migration event claims/69-slot pools, UTC reset, prepared amount freezing, expiry across policy boundary, one wallet/day, stable numbers, seven atomic reservations and700,000,000 Luna liability. Historical Reward Week, claim/risk/payout safety and full three-mission replay tests remain in the suite. Opt-in live database tests remain opt-in and were not run against production. Concurrent promise submissions in embedded PostgreSQL exercise the atomic SQL; the existing multi-connection Supabase test remains opt-in.

No production SQL/env/deploy/treasury action occurred. No real payout execution, funding or NIM transfer occurred. Existing payout tests use mocked adapters.
