# Final verification results

Branch: feat/angkor-v2-production-integration
Base:81bdb84c8bc11fd801563457912dab7da47d14a2

| Gate | Result |
| --- | --- |
| npm run test:release | PASS —168 test files;1298 passed,69 existing opt-in skipped;151.46s |
| npm test | Initial standard run exposed stale V2 isolation/mock assertions; corrected. Final full release command uses the same complete suite, bounded to two workers. |
| New deterministic model/session tests | PASS —all three approved full envelopes, malformed ordering/state assertions, tick-bank rejection, checkpoint retries/backpressure |
| Signed memory server harness | PASS —all three complete missions, one attempt, resume, server verification, Vault Seal, existing signed claim reservation |
| Ephemeral PostgreSQL harness | PASS —all001–020 migrations, old/new publication coexistence, full three-mission durable replay, mid-run service restart, claim reservation, zero payouts, unprivileged RPC denial |
| npm run build | PASS —includes tsc -b; retains large chunk warning |
| npm run lint | PASS |
| Root typecheck / npx tsc -b | PASS —also rerun as part of final build |
| npm run typecheck:server | PASS |
| git diff --check (task paths) | PASS |
| Mobile /play Practice | All three V2 missions load without wallet/profile; no gameplay errors, proof traffic or reward authorization. Held input moved(3,20)→(7,20) sequentially in700ms. |

Skipped suites retain their existing live Supabase/Docker opt-in requirements. Docker was unavailable; always-on PGlite executes real PostgreSQL/PLpgSQL and the new migration without production credentials. No test was deleted, and the default15s legacy timeout was not increased. A new full PostgreSQL WASM replay test has an explicit180s budget due to thousands of serial eight-action RPCs; reducing redundant retry checks kept the release command stable. The old solver timeouts did not reproduce.

Security rejection coverage: skipped/reordered stages, forged result/carry/HP/boss fields, recomputed forged snapshot/result hashes, malformed sequence/direction, frozen/banked/future ticks, transcript action mutation, wrong-version actions/transcripts, duplicate terminal completion and forged acknowledgement. Existing reducer tests cover duplicate collectibles/chests, carry/local reset, and all mission/boss conditions.

Economics, Reward Week claim-time policy, attempt limits, reservation limits, payout execution, treasury and wallet authorization remain unchanged. Vault Breaker retains the signed seal. No payout worker ran and no NIM was sent.

QA screenshots:
- output/playwright/angkor-v2-practice-gem-mobile.png
- output/playwright/angkor-v2-practice-chest-mobile.png
- output/playwright/angkor-v2-practice-vault-mobile.png

Owner release action: apply020 transactionally through the existing migration workflow, review privileges/legacy fixtures in the approved staging harness, then perform the final separately authorized merge/deployment gate described in README. No new environment variables.

ANGKOR_V2_PRODUCTION_INTEGRATION = READY (code/test milestone; production release remains owner-gated)
