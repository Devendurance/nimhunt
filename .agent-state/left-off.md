# NimHunt - Left Off

> Updated: 2026-09-17 (production-deploy slice)

## Current Objective

Production deployment + native Vercel cron disabled-cycle validation. Automation stays OFF. No NIM sent; no payout switch enabled.

## Completed (this slice)

- Confirmed deployable unit: `api/internal/payout-cycle.ts` present, existing route only, no second scheduler endpoint.
- Confirmed `vercel.json` does NOT exist (correct — creation gated on deployed-route auth PASS; `vercel.json.example` reference-only with `*/10 * * * *`).
- Local env: `NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED=false`; scheduler resolves `source=CRON_SECRET`, `maxPerCycle=5`; reward `10000000` Luna / cap `690000000` unchanged.
- Local auth dispatch proof (fake cycle, real config): no-auth 401, wrong-bearer 401, cookie-only 401, query-string 400. True-positive 200 DISABLED covered by `scheduler.test.ts` with generated secrets (no real secret used/printed).
- Client-bundle scan: zero `VITE_(CRON_SECRET|NIMHUNT_PAYOUT_CRON_SECRET)` hits in `dist/`; zero `CRON_SECRET` value strings in client chunks.
- Full suite: npm test 605 pass / 69 skipped, lint 0, `tsc -b --force` 0, `npm run build` ok, `git diff --check` 0.
- Did NOT create `vercel.json`, did NOT enable either kill switch, sent no NIM, changed no reward/cap, funded nothing.
- Updated `project-state.md` + `memory.md` with deploy-readiness + blocker.

## NOT completed (blocked — needs owner/Vercel access)

1. Production deployment of current app (no Vercel CLI, no `.vercel` linkage, no Vercel token in sandbox).
2. Production env `CRON_SECRET` configuration + deployed-route auth matrix (401/401/401/200-DISABLED).
3. Cold-start repeat test against production URL.
4. Fresh live payout-status re-query (`npm run payout:status` timed out in sandbox; last verified 2026-09-17 stands: env OFF, DB OFF, PENDING/PROCESSING/SUBMITTED 0, CONFIRMED-today 1, execution-day committed 10,000,000 Luna, remaining 680,000,000, lastCycle DISABLED).
5. `vercel.json` creation + cron-config deploy (correctly deferred — gated on deployed-route auth PASS).
6. First/second native cron DISABLED observations.

## Next Session

Owner (or Vercel-connected session): `vercel link` + `vercel --prod` WITHOUT `vercel.json`; set production `CRON_SECRET` (server-only, never `VITE_*`); run deployed auth matrix + cold-start repeat; only then create/review/deploy `vercel.json` and observe native DISABLED invocations. Do not enable switches, send NIM, or spoof native-cron proof.
