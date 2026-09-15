# NimHunt — Project State

> **Last updated**: 2026-09-15
> **Phase**: Cycle 2 authenticated product start, checkpoint chain, final replay, run-bound Vault seal, and Postgres proof adapter are in. Signed reward claim and 69-slot reservation are the next slice. NIM payout is not started.
> **Latest milestone**: Live Supabase `001`/`002`/`003` schema, RLS/RPC privileges, signed Start, checkpoint races, Gem/Chest/Vault persistence, and real-device postgres-backed Gem Runner, Chest Hunter, and Vault Breaker + `NIMHUNT_VAULT_SEAL_V1` are verified.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 8 |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Routing | React Router v7 |
| Game engine | Phaser 4 (WebGL, embedded in React) |
| Testing | Vitest (Node environment) |
| Linting | ESLint 10 (flat config) |
| Package manager | npm |

---

## Routes

| Route | Purpose | Status |
|-------|--------|--------|
| `/` | Marketing landing page | ✅ LOCKED — do not modify |
| `/play` | Mini App shell (Hunt Home, World Select, Mission Brief) | ✅ Wallet-free board/brief; deliberate Start only |
| `/play?run=<mission>&runId=<id>` | Authenticated product expedition | ✅ Active/gameplay-start gate precedes Phaser |
| `/play?run=<mission>` | Bare product locator | ✅ Invalid product route; no Phaser mount |
| `/play?practice=<mission>` | Explicit local Practice expedition | ✅ Local Room 01, no proof traffic |
| `/play?dev=nimiq` | Nimiq Pay account/signature/verifier spike | ✅ LOCKED |
| `/play?dev=game` | Phaser gameplay dev scene (Room 01) | ✅ Active development |

---

## Architecture

```
src/
├── routes/            # HomePage.tsx, PlayPage.tsx
├── components/
│   ├── marketing/     # 14 landing-page section components
│   └── play/          # PlayShell, GameDevView, HuntHeader, MissionBrief, etc.
├── game/
│   ├── assets/        # angkorAssets.ts (texture manifest)
│   ├── config/        # createGameConfig.ts (Phaser config factory)
│   ├── domain/        # runState.ts (HP, PlayerRunState), mission.ts
│   ├── entities/      # Player.ts, Goblin.ts (Phaser display objects)
│   ├── events/        # gameEvents.ts (React↔Phaser bridge via EventTarget)
│   ├── rendering/     # frameArtwork.ts, puzzleArtwork.ts
│   ├── scenes/        # BootScene.ts, AngkorDevScene.ts
│   ├── systems/       # Pure logic: movement, puzzle, hazards, collectibles,
│   │                  #   tileEntry, goblin, items
│   ├── replay/        # canonical proof data, deterministic replay, blueprint validation
│   └── world/         # grid.ts, room01.ts (tile parsing, room data)
├── api/               # typed product proof API boundary
├── integrations/
│   └── nimiq/         # nimiqState, nimiqErrors, NimiqProvider
├── data/              # Static data (worlds, missions, heroes)
├── hooks/             # useNimiqStatus, etc.
├── types/             # Shared TypeScript types
└── assets/            # Source art (NimHunt Character.png, NimHunt Goblin.png, etc.)
```

### Key Patterns

1. **Pure domain logic** in `src/game/systems/` — testable without Phaser, zero rendering.
2. **Phaser rendering** in `src/game/scenes/` and `src/game/entities/`.
3. **React↔Phaser bridge**: `gameEvents.ts` uses a custom `EventTarget` to emit `PlayerHUDState` from Phaser to React (`GameDevView.tsx`).
4. **Turn-based gameplay**: player moves → items check → goblin AI evaluates → combat resolution → HUD emit.
5. **Deterministic movement**: 4-direction grid, validated by `isWalkable()` checks.
6. **Asset pipeline**: Production PNGs in `public/assets/game/angkor/` + source art in `src/assets/`, framed at runtime via `frameArtwork()`.
7. **Replay proof boundary**: Server-issued blueprints feed pure deterministic replay; canonical hashing stays server/test-side so the client bundle does not import the Nimiq WASM worker.
8. **Product start boundary**: Explicit Nimiq authorization creates the run; authenticated `/active` and idempotent gameplay-start gate product Phaser, while Dev and Practice remain local.
9. **Wallet status boundary**: Public hunt slots are wallet-free; wallet attempts remain unknown until a successful product start and are refreshed only with normalized in-memory wallet context.
10. **Proof backends**: Memory is development/test only. Postgres is the durable adapter (`NIMHUNT_PROOF_BACKEND=postgres`) using SECURITY DEFINER RPCs. Product HTTP does not branch on backend business behavior.

---

## Verified Product Proof

| Capability | Status |
|------------|--------|
| Live Supabase/Postgres proof backend | ✅ PASS |
| Real-device Postgres Gem Runner | ✅ PASS |
| Real-device Postgres Chest Hunter | ✅ PASS |
| Real-device Postgres Vault Breaker + `NIMHUNT_VAULT_SEAL_V1` | ✅ PASS |
| Attempt accounting (3/day, consumed at Start) | ✅ PASS |
| Daily reward pool (69 slots/day) | ✅ exists |
| One reward reservation max per wallet/day | ✅ schema/accounting exists |
| Signed reward claim | ❌ not started |
| NIM payout | ❌ not started |

---

## Next Milestone

Signed `NIMHUNT_REWARD_CLAIM_V1` prepare/finalize and atomic 69-slot reservation. Do not implement NIM transfer, treasury, payout, or payout worker.

## Canonical References

- [`docs/prd.md`](../docs/prd.md) — product requirements and acceptance criteria
- [`docs/architecture.md`](../docs/architecture.md) — runtime boundaries, security, data model, and testing strategy
- [`docs/projectplan.md`](../docs/projectplan.md) — Cycle 2 phases, gates, and cut order
- [`DESIGN.md`](../DESIGN.md) — visual system and UI constraints
