# NimHunt - Left Off

> Updated: 2026-09-18 (production deployment-gap fix + final predeploy audit PASS locally; NOT deployed/pushed, no mechanics/economics changes)

## Current Objective

Fix production routing + expose existing production backend handlers + replace landing mock hunt status with live status. No gameplay/reward/payout/DB changes, no real payouts, no attempt consumption during verification. Do not deploy automatically.

## Completed (this slice)

- **SPA /play routing**: vercel.json rewrites /play -> /index.html (query strings preserved, no /api/* rewrite, cron unchanged 0 14 * * *).
- **In-app CTA**: HuntCTA in-app now Link to=/play (client navigation); deep-link stays <a href=nimiq://...>; updated landingHuntCta.test.ts.
- **Production API adapter**: new server/expeditions/proofRuntime.ts (shared, vite-free, .js) + server/vercel/productAdapter.ts (dispatch routing, Vercel host/proto via x-forwarded-*, 16k body, payout-cycle fails closed) + api/[...nimhunt].ts catch-all (dedicated payout-cycle wins). Exposes 16 required product paths + 3 legacy ledger paths; unknown fails closed JSON 404.
- **Serverless compat**: converted product graph (.ts->.js specifiers, 64 files, logic unchanged); vitePlugin refactored to import from proofRuntime (re-exports preserved); tsconfig.server.json expanded to product adapter.
- **Live landing**: new useLandingHuntStatus (fetchDailyHuntStatus only, 45s poll, visibility refetch, reset-timeout refetch) + LandingHuntStatus (loading/unavailable —, live real remaining/total + per-second countdown from nextResetAt, no wallet, no preview strings); HomePage no longer imports huntPreviewFixture; LiveHuntStatus loading label neutralized.
- **Regression tests**: server/vercel/productAdapter.test.ts (16 paths, unknown fails closed, payout-cycle separate, invalid expedition JSON not NOT_FOUND, origin checks, Secure cookies, forwarded proto) + server/vercel/productionRouting.test.ts (rewrite, no /api rewrite, cron, Link, no fixture) + src/productionLanding.test.ts (69-slot mapping, countdown decrement, deep-link/in-app resolve).

## Changed paths

- vercel.json, tsconfig.server.json
- src/components/marketing/HuntCTA.tsx, LiveHuntStatus.tsx, LandingHuntStatus.tsx (new), useLandingHuntStatus.ts (new)
- src/routes/HomePage.tsx, src/components/marketing/landingHuntCta.test.ts, src/productionLanding.test.ts (new)
- server/expeditions/proofRuntime.ts (new), vitePlugin.ts (refactor), server/vercel/productAdapter.ts (new), api/[...nimhunt].ts (new)
- server/vercel/productAdapter.test.ts (new), productionRouting.test.ts (new)
- 64-file .js import conversion (server/src/domain/src/game, logic unchanged)

## Verification results

- FINAL PREDEPLOY AUDIT 2026-09-18: IMPORT CONVERSION PASS (62 mechanical .ts->.js proven via normalized diff, 0 semantic; +2 vitePlugin mechanical+refactor with re-exports preserved; rateLimit phantom cleared, 0 content diff) / CLIENT API COVERAGE PASS (16 product +3 legacy in adapter, all client-called paths covered, dev-verify excluded) / VERCEL ROUTING PASS (/play->/index.html, no /api rewrite, cron 0 14 * * * unchanged, payout-cycle dedicated) / SERVERLESS SECURITY PASS (GET no-body, parsed/stream body, 16k cap 413, malformed 400, x-forwarded-host/proto, Secure/HttpOnly/SameSite=Strict Path=/api) / LIVE LANDING PASS (no fixture, no fake numbers, per-second tick, 45s poll+visibility+reset-timeout all clean up) / PAYOUT ISOLATION PASS (payout files .js-only, economics/scheduler untouched) / READY TO PUSH PASS.
- npm test: 84 passed / 5 skipped / 682 passed initially with 1 timeout flake in dailyAngkorLayouts (BFS slow); rerun with --testTimeout=90000 => 15/15 PASS; dedicated productAdapter+routing+landing 22/22 PASS; audit rawbody/proxy 6/6 PASS (temp, removed).
- npm run lint: 0 errors.
- npm run typecheck:server: 0 errors.
- npx tsc -b --force: 0 errors.
- npm run build: built in ~2.0s (pre-existing chunk-size warning only); dist contains no node:/service-role/CRON_SECRET leaks.
- git diff --check: 0 whitespace errors (LF/CRLF warnings only).
- Safe verification: invalid expedition requests return JSON 400/401/503 (not NOT_FOUND) via dispatchProductHttp with mocked env; no real runs created, no attempts consumed, no payouts invoked, no DB migrations, no secrets exposed.

## Next action

- Owner reviews diff, deploys manually (no auto-deploy), then verifies live: GET /play 200 HTML; GET /api/daily-hunt-status 200 JSON ok/totalSlots=69/remaining/nextResetAt; invalid expedition API JSON error (not NOT_FOUND); GET /api/internal/payout-cycle no-auth 401 unchanged.
