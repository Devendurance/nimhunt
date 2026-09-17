# NimHunt payout operations runbook

## Architecture and rollout state

Scheduled orchestration uses the existing bounded `runPayoutWorker` cycle through the protected `POST /api/internal/payout-cycle` route. `GET` is also accepted for Vercel Cron compatibility (Vercel Cron issues `GET`). There is no resident worker and no active cron configuration (`vercel.json` does not exist in the repo; `vercel.json.example` is reference-only).

## Vercel CRON_SECRET behavior (confirmed)

When `CRON_SECRET=<secret>` is configured in the Vercel project environment, every scheduled Vercel Cron request to the configured cron path includes:

```text
Authorization: Bearer <secret>
```

Exact production behavior:

- The header is attached by Vercel's scheduler, not by application code.
- It applies only to cron-triggered requests to paths listed under `crons` in `vercel.json`.
- Manual browser visits, `curl` without the header, and forged requests do not carry it and must receive `401`.
- The route validates with a constant-time comparison (`sha256` + `timingSafeEqual` + length check). Missing → `401`, wrong → `401`, correct → accepted. Cookies are irrelevant.
- `CRON_SECRET` is the single canonical production secret. `NIMHUNT_PAYOUT_CRON_SECRET` is a local/dev alias only; production must not set both with identical values, and neither may ever use a `VITE_*` prefix.

## Scheduler secret resolution

`readPayoutSchedulerConfig` resolves, in order:

1. `CRON_SECRET` (canonical, Vercel-native) when non-empty.
2. Else `NIMHUNT_PAYOUT_CRON_SECRET` (local/dev alias) when non-empty.
3. Else `null` → the route returns `503 PAYOUT_UNAVAILABLE` and no cycle runs.

Values shorter than 32 chars or longer than 4096 chars throw `PAYOUT_SCHEDULER_SECRET_INVALID`. Any `VITE_CRON_SECRET` or `VITE_NIMHUNT_PAYOUT_CRON_SECRET` value throws `PAYOUT_SCHEDULER_SECRET_INVALID` (fail-closed, never ships to the client bundle).

## Auth matrix (deployed route, automation OFF)

| Request | Expected |
|---|---|
| No `Authorization` | `401 { ok:false, error:'UNAUTHORIZED' }` |
| Wrong `Bearer` | `401 { ok:false, error:'UNAUTHORIZED' }` |
| Cookie/session only | `401` (cookies irrelevant) |
| Correct `Bearer <CRON_SECRET>` + `GET` | `200 { authorized:true, automationEnabled:false, cycleRan:true, result:'DISABLED', signed:0, broadcast:0 }` |
| Query string (`?max=…`) | `400 MALFORMED_REQUEST` (never overrides server config) |
| Body `{ max, amountLuna, network, … }` | Ignored (server config only) |

Both controls remain mandatory:

- `NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=true`
- DB `payout_automation_control.automatic_payouts_enabled=true`

A scheduler credential never bypasses either control. Disabled cycles reconcile safe submitted state and recover ambiguous processing state when possible, but do not acquire, sign, or broadcast.

## Production deploy (route disabled, automation OFF)

Deploy `/api/internal/payout-cycle` through the normal Vercel deployment path with:

```text
NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=false
DB payout_automation_control.automatic_payouts_enabled=false
CRON_SECRET=<strong server-only value>
```

Do not print the value. Do not set `NIMHUNT_PAYOUT_CRON_SECRET` in production. Verify the deployed URL before any cron wiring:

- No `Authorization` → `401`
- Wrong `Bearer` → `401`
- Correct `Bearer <CRON_SECRET>` → `200` with `authorized=true, automationEnabled=false, cycleRan=true, signed=0, broadcast=0, result=DISABLED`

Invoke multiple times/cold starts: same disabled behavior, operations metadata updates safely, no payout duplication, no `PROCESSING` transition, no sign/broadcast, both kill switches stay OFF.

## Vercel Cron wiring (NOT activated by this slice)

Once the deployed endpoint passes the matrix above, the real `vercel.json` is:

```json
{
  "crons": [
    {
      "path": "/api/internal/payout-cycle",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

Cron may invoke the route while both kill switches are OFF; that must still produce `DISABLED` / zero sends.

> ⚠️ ACTIVATION WARNING: creating `vercel.json` with the `crons` block and deploying to production **immediately activates the native Vercel schedule** (every 10 minutes). That is why this slice does NOT create `vercel.json` in the repo. Create it only when a native cron disabled-cycle validation is explicitly approved, with both kill switches confirmed OFF first. Adding cron never enables payout execution by itself — execution still requires both kill switches — but it does start authenticated production invocations.

## Owner status

Run the read-only status command from an operator environment:

```text
npm run payout:status
```

It reports the environment and DB automation switches, treasury public address and balance, minimum reserve, execution-day committed Luna and remaining budget, PENDING/PROCESSING/SUBMITTED counts, CONFIRMED-today count, REVIEW/BLOCK counts, and the last recorded cycle result/errors. It never prints secrets.

## Enable procedure (not approved by this slice)

1. Fund the treasury.
2. Verify the reserve and balance with `npm run payout:status`.
3. Verify the 100 NIM reward amount, 69-slot economics, daily cap, and bounded cycle limit.
4. Apply the pending scheduler-operations migration to the production database.
5. Set the server-only `CRON_SECRET` in Vercel (never `VITE_*`, never in the repo) and verify it is not a `VITE_*` variable.
6. Enable the environment automation switch and deploy it.
7. Enable the DB switch only after observing the disabled scheduler path.
8. Add/deploy the reviewed Vercel Cron configuration and verify one cycle/status result.

## Emergency stop

1. Turn the DB automation switch **OFF first**.
2. Turn the environment switch **OFF** and deploy if required.
3. Allow read-only reconciliation to continue where credentials permit.
4. Inspect `SUBMITTED`, `PROCESSING`, and the last cycle result.
5. Never blindly resend a `SUBMITTED` or ambiguous `PROCESSING` payout; use reconciliation/manual review.

## Treasury low or daily cap reached

The cycle leaves payouts `PENDING` when the reserve cannot cover the next reward or the execution-day cap is reached. Fund the treasury or wait for the next execution day; do not manually force an acquire or alter the 100 NIM amount/69-slot economics.

## Failure and overlap behavior

Repeated or overlapping triggers are expected. Database row locks, the unique claim-to-payout binding, atomic automated acquire, execution-day accounting, and treasury outstanding checks provide correctness; scheduler-level singleton behavior is not required. `SUBMITTED` is reconciled only, and ambiguous processing follows the existing safe/manual-review path.

## Activation blockers

Production activation remains disabled until the migration is applied to the live DB, the serverless route is deployed, the scheduler secret is configured in the server environment, and an owner explicitly reviews/enables both kill switches and the cron configuration. No mainnet automation or production cron is enabled by this change.
