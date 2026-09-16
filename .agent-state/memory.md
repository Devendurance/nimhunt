# NimHunt - Durable Memory

> Last reviewed: 2026-09-16

This file stores decisions and lessons that should survive future sessions. It is not a replacement for the canonical product or architecture documents.

## Verified live status

FULL LIVE E2E:
PASS

MAINNET PAYOUT:
PASS

REAL DEVICE PAYOUT RECOVERY:
PASS

PRODUCTION REWARD AMOUNT:
UNDECIDED

PAYOUT AUTOMATION:
NOT ENABLED

ANTI-BOT / SYBIL:
PENDING PRODUCTION GATE

## Canonical Sources

- [`docs/prd.md`](../docs/prd.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/projectplan.md`](../docs/projectplan.md)
- [`DESIGN.md`](../DESIGN.md)

## Phone restart payout restore — LAN host alias

- `NIMHUNT_APP_ORIGIN` is `http://localhost:5173`. The phone loads `/play` via LAN (`192.168.x.x:5173`).
- Wallet daily-status, recover-challenge, and other product proof paths already allow the authorized local-LAN host alias.
- Payout GET now reuses the same `isAuthorizedLocalHttpAlias` from expedition HTTP. Dev-only: `allowAuthorizedLocalHttpOrigins`, http, same port as expected host, loopback/private IPv4. Production/preview still require exact expected host/origin.
- Hunt recovery only starts `NIMHUNT_RECOVER_SESSION_V1` on `RUN_SESSION_INVALID`. LAN no-cookie payout GET must return 401, not 400 `MALFORMED_REQUEST`.
- Do not read payouts by wallet identity alone.

## /play wallet bootstrap

- Only `/play` initiates Nimiq `init()` + `listAccounts()`. Landing `/` still detects host only.
- Bootstrap is identity only: no run, no `NIMHUNT_START_EXPEDITION`, no attempt consume, no claim/payout send.
- Remembered wallet is module memory for the current WebView session (Hunt/Missions/Heroes + return from a run). True app restart clears it.
- Start still requires a separate signed `NIMHUNT_START_EXPEDITION`. If a wallet is already remembered, Start skips a second `listAccounts()` but still signs Start.

## Recover-session verify after signature

- Phone compact line after LAN restart: wallet ok, payout GET 401 `RUN_SESSION_INVALID`, challenge 200, signature approved, session missing. That is B: verify sent and rejected, not A/C/D/E.
- `asIso()` millisecond timestamps in the signed payload failed Postgres `issued_at`/`expires_at` exact equality (microseconds). Consume returned `RECOVERY_CHALLENGE_INVALID`; no Set-Cookie; payout retry never ran.
- Align consume timestamps to stored values when they match at millisecond precision. SQL `date_trunc('milliseconds')` on create/consume. Do not move recovery secrets into Web storage.
- Local HTTP wallet-session cookie must match run-session: HttpOnly, Path=/api, SameSite=Strict, Max-Age/Expires, no Domain, no Secure. Production keeps Secure.

## Wallet recovery session

- Nimiq Pay full close destroys the WebView cookie jar. Approved wallet + missing `nimhunt_run_session` must not read payouts by address alone.
- Separate cookie `nimhunt_wallet_session` (`Path=/api`, HttpOnly, SameSite=Strict, Max-Age/Expires, Secure except local-LAN HTTP). Do not overload `run_sessions` / run authority.
- Signed payload type `NIMHUNT_RECOVER_SESSION_V1` with canonical JSON field order: version, type, wallet, challenge, issuedAt, expiresAt, purpose=`reward/daily-state recovery`.
- Challenge is one-time, 5 minutes (capped at UTC reset). Wrong wallet / expired / replay rejected. Recovery session may read daily state, that wallet's RESERVED claim, and payout status. It cannot start a run, checkpoint, claim, or pay.
- Payout GET prefers a valid recovery session, then the run session. Wallet A cannot recover wallet B.
- Wallet identity from `listAccounts()` may load expeditions remaining. It is not enough to read claims/payouts.
- Hunt payout restore must not require sessionStorage `claimId`, runId, run-session cookie, `rewardAlreadyReserved`, or another expedition. Missing `nimhunt_wallet_session` after a true app restart must request `NIMHUNT_RECOVER_SESSION_V1`, then GET `/api/rewards/claim/payout` with `claimId: null`.

## Run-session cookie

- `nimhunt_run_session` remains the only post-start gameplay recovery authority. Raw capability never goes to JS, React, URLs, or Web storage. Server stores SHA-256 only.
- Set-Cookie must keep `Path=/api`, `HttpOnly`, `SameSite=Strict`, no `Domain`, `Max-Age` + `Expires` equal to the server session expiry (capped at 24h), and `Secure` except explicit local-LAN HTTP.
- Cookie must never outlive the server session. Expired/revoked server sessions fail closed even if a cookie is still sent.

## Landing in-app detection

- Detect Nimiq Pay from the injected host (`window.nimiqPay` or `window.nimiq`) via `detectNimiqPayHost()`. Do not use user-agent. Do not call `init()`, `listAccounts()`, or sign on `/`.
- Outside Nimiq Pay: CTA remains `Hunt in Nimiq Pay`. Inside: `Enter today's hunt` routes `/play`. Never deep-link/reopen Nimiq Pay from inside itself. Do not auto-redirect `/`.

## Payout Status Read Model

- Gameplay HTTP may only READ payout state through a run-session cookie or a wallet recovery session. No public send, acquire, sign, broadcast, or reconcile endpoint.
- Public fields only: `payoutId`, `claimId`, `status`, `amountLuna` (decimal string of integer Luna), `network`, `txHashSafe`, `submittedAt`, `confirmedAt`.
- Copy: PENDING/PROCESSING → TREASURE RESERVED; SUBMITTED → PAYOUT SUBMITTED; CONFIRMED → TREASURE DELIVERED + amount + shortened hash + Verified ✓. Never tell the player to replay.
- Live `004` already ran without `get_reserved_reward_claim_for_session`. Do not replay 004. Live `006_reward_claim_session_recovery.sql` and `007_wallet_recovery_session.sql` are applied. REST/service-role data APIs must not be used for DDL. This project uses raw SQL migrations, not Drizzle.

## Payout Decisions

- Reservation and payout are separate. `reward_claims` stays accounting-only. `reward_payouts` is one row per RESERVED claim.
- No canonical live NIM amount exists. Server-only `NIMHUNT_REWARD_AMOUNT_LUNA` (integer Luna). Creation stores that amount immutably. Do not invent a product amount.
- A one-off mainnet validation used 10,000 Luna (0.1 NIM). That is not the production reward amount and must not be adopted as economics.
- Network must be explicit: `NIMHUNT_PAYOUT_NETWORK=testnet|mainnet`. Mainnet also requires `NIMHUNT_ENABLE_MAINNET_PAYOUT=true`. Worker still refuses mainnet broadcast until explicit `GO MAINNET PAYOUT`.
- Treasury secret is server-only. NimHunt generates mnemonic only (`NIMHUNT_TREASURY_MNEMONIC`), never both secrets, never `VITE_*`, never browser, never logs, never Git.

## Claim / Reservation (still true)

- 3 expeditions / wallet / UTC day. 69 reserved rewards / UTC day. Max 1 reserved reward / wallet / UTC day.
- Signed product claims use `NIMHUNT_REWARD_CLAIM_V1`. Finalize is atomic in `finalize_reward_claim`.
- After today's reward is reserved, remaining expeditions may still be played. Completing another eligible mission returns TODAY'S REWARD ALREADY RESERVED. No second claim.

## Treasury Sweep

- Local-only maintenance: `npm run treasury:sweep`. Do not reuse the payout worker, `reward_payouts`, claims, or gameplay state.
- Without `--confirm`, preview only: no signing, no broadcast.
