# NimHunt — Project State

> **Last updated**: 2026-09-12
> **Phase**: Cycle 2 authenticated product start, checkpoint chain, and server final replay verification are in. Claims, Vault product seal, and Postgres proof adapter are not started.
> **Latest milestone**: Post-verify UX keeps `VERIFIED_ELIGIBLE` mounted as a terminal client session. `/active` still rejects completed/already-started runs on fresh reload. Claims, Vault product seal, and Postgres proof adapter are not started.

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
|-------|---------|--------|
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

---

## Room 01 Layout (12×10, 32px tiles)

```
############
#.P.....#..#      P = Potion (2,1)
#..##..##..#
#..S.......#      S = Player start (3,3), Spikes (5,3)
#..##...G..#      G = Goblin spawn (7,4), Gate (8,3), Shrine (9,3)
#..#....##.#
#W#B....##.#      W = Sword (1,6), B = Boulder (4,6), Poison (6,6)
#..#K...#..#      K = Key (3,7)
#.......#..#
############
```

**Gems**: (2,3), (1,1), (5,1), (9,1), (10,4), (10,8), (5,8), (1,8) — total 8
**Gem Runner target**: 6/8

**Chests** (deterministic, step-onto open):
- room01-chest-01 (1,2) GEMS → `Found 2 gems.`
- room01-chest-02 (6,3) POTION → `HP restored +N.` (clamped)
- room01-chest-03 (5,5) TRAP → `It was trapped! -30 HP`
- room01-chest-04 (10,3) SWORD → `Ancient Blade found.` (inner chamber, requires key→gate)
**Chest Hunter target**: 4/4 + HP > 0

---

## Gameplay Mechanics (ALL VERIFIED)

| Mechanic | Value | Status |
|----------|-------|--------|
| Max HP | 100 | ✅ |
| Spike damage | −25 HP | ✅ |
| Poison damage | −20 HP | ✅ |
| Goblin damage (no sword) | −20 HP | ✅ |
| Sword pickup | At (1,6), one-time | ✅ |
| Sword effect | Defeats goblin with 0 damage | ✅ |
| Potion healing | +25 HP, clamped to 100, not consumed at full HP | ✅ |
| Boulder push | 1 push in movement direction | ✅ |
| Key pickup | Opens gate | ✅ |
| Gate | Blocks until key collected | ✅ |
| Shrine interaction | Room completion | ✅ |
| MissionStatus | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' |
| Gem Runner mission | Collect ≥6 gems + stay alive | ✅ |
| Chest Hunter mission | Open 4 chests + stay alive (`CHEST_HUNTER_TARGET=4`) | ✅ |
| Chest loot | GEMS +2 / POTION +25 clamp / SWORD hasSword / TRAP −30 / EMPTY dust, deterministic, open-once | ✅ |
| Reset | Full state reset including chests to CLOSED | ✅ |
| Death | HP ≤ 0 → failure state | ✅ |
| Camera | 1.35× zoom, follow player | ✅ |
| Explorer sprite | ~29px (framed from source art) | ✅ |

### Goblin AI

- **Spawn**: (7,4)
- **Patrol**: ping-pong along (7,4)→(7,5)→(7,6)→(7,7)
- **Chase trigger**: Manhattan distance ≤ 3
- **Chase rule**: Move toward player on axis reducing distance most; ties broken horizontal-first
- **Blocked by**: walls, bounds, locked gate, boulders
- **Defeated state**: alpha 0.35, immobile

---

## Test Inventory

**46 test files passed + 1 skipped Postgres integration, 379 passing — verified 2026-09-11.**

| File | Tests |
|------|-------|
| `systems/movement.test.ts` | Movement validation |
| `systems/puzzle.test.ts` | Puzzle state machine |
| `systems/goblin.test.ts` | 13 — Goblin AI |
| `systems/items.test.ts` | 10 — Sword + Potion |
| `domain/runState.test.ts` | HP clamping |
| `world/grid.test.ts` | Grid parsing/bounds |
| `entities/Player.test.ts` | Player animation lifecycle |
| `entities/Goblin.test.ts` | 4 — Goblin entity |
| `events/gameEvents.test.ts` | Event bridge |
| `scenes/AngkorDevScene.test.ts` | Scene integration |
| `integrations/nimiq/nimiqState.test.ts` | Nimiq state transitions |
| `integrations/nimiq/nimiqErrors.test.ts` | Error normalization |
| _(3 more component/integration test files)_ | |

---

## Production Assets

### Source Art (in `src/assets/`)
- `NimHunt Character.png` — Explorer (1254×1254)
- `NimHunt Goblin.png` — Goblin (1254×1254)
- `NimHunt Logo.png`, `NimHunt World Poster.png`, etc.

### Game Tiles (in `public/assets/game/angkor/`)
- `terrain/` — floor, wall variants (9-patch), decorative tiles
- `props/` — boulder, key, gate, shrine, chest, sword.png, potion.png
- `hazards/` — spikes, poison
- `collectibles/` — gems
- `overlays/` — moss, vines, shadows, cracks

### Marketing (in `public/assets/`)
- Hero images, world posters, character poses, icons

---

## Important Decisions Made

1. **Angkor visual polish pass** — camera zoom 1.35×, wall autotiling (9-patch), layer depths, overlays. Explorer scaled to 29px for immersive "inside the ruin" feel rather than top-down board view.
2. **Pure/render separation** — All game logic is pure TypeScript functions testable without Phaser. Phaser is only for rendering.
3. **Turn-based combat** — Goblin moves once per player turn. Combat resolution runs twice (after player move, after goblin move).
4. **Conditional potion** — Potion is NOT consumed at full HP to prevent waste.
5. **No Phaser physics** — Grid-based, no continuous physics. Movement is tile-to-tile with tween animation.
6. **HUD in React** — Game state emitted to React via EventTarget for HUD rendering in CSS (not Phaser text).

---

## Known Issues / Tech Debt

| Issue | Severity | Notes |
|-------|----------|-------|
| Headless screenshots show blank initial frame | Low | Phaser WebGL init timing in headless Edge; runtime is fine |
| No pickup particle effects | Low | Visual polish only |
| No sound effects | Medium | Planned for P7 polish phase |
| Goblin death animation basic | Low | Alpha fade only, could add dissolve |
| Single room only | Expected | Per project plan, more rooms deferred |
| Large `GameDevView` build chunk | Low | Vite warns about the current 1.4 MB minified game chunk; optimize when gameplay scope stabilizes |

---

## File Quick Reference

### Core Game Loop
- [`AngkorDevScene.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/scenes/AngkorDevScene.ts) — Main Phaser scene (~670 lines)
- [`BootScene.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/scenes/BootScene.ts) — Asset preloading
- [`GameDevView.tsx`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/components/play/GameDevView.tsx) — React HUD wrapper

### Pure Systems
- [`movement.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/systems/movement.ts) — Direction validation
- [`puzzle.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/systems/puzzle.ts) — Boulder/key/gate/shrine state machine
- [`goblin.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/systems/goblin.ts) — Goblin AI
- [`items.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/systems/items.ts) — Sword/potion logic
- [`hazards.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/systems/hazards.ts) — Spike/poison damage
- [`collectibles.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/systems/collectibles.ts) — Gem collection
- [`tileEntry.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/systems/tileEntry.ts) — Tile entry resolution

### World Data
- [`room01.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/world/room01.ts) — Room layout, gem/hazard/item positions
- [`grid.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/world/grid.ts) — Tile parsing, walkability, coordinate math

### Replay Proof
- [`replay/canonical.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/replay/canonical.ts) — Canonical proof serializers and hashes
- [`replay/engine.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/replay/engine.ts) — Pure deterministic replay transitions
- [`replay/validator.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/replay/validator.ts) — Rules and positive solvability validation

### Durable Proof Start
- [`server/expeditions/memoryProofStore.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/server/expeditions/memoryProofStore.ts) — Blueprint lifecycle, challenge binding, atomic memory start, initial proof, and session binding
- [`server/expeditions/canonical.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/server/expeditions/canonical.ts) — Strict signed-start payload parser/serializer
- [`server/expeditions/session.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/server/expeditions/session.ts) — Hash-only capability and secure cookie primitive
- [`server/ledger/sql/002_expedition_proof.sql`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/server/ledger/sql/002_expedition_proof.sql) — Durable blueprint/challenge/session/run/checkpoint schema and atomic start RPC

### Bridge
- [`gameEvents.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/events/gameEvents.ts) — PlayerHUDState, React↔Phaser EventTarget

### Config / Assets
- [`angkorAssets.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/assets/angkorAssets.ts) — Texture manifest
- [`createGameConfig.ts`](file:///c:/Users/USER/Documents/ideas/nimhunt/nimiq-treasure-hunt/src/game/config/createGameConfig.ts) — Phaser config factory

## Next Milestone

Server final replay verification is in. Do not implement vault product seal, claims, 69-slot reservation, NIM transfer, payout, Postgres proof integration, or new gameplay mechanics until explicitly requested.

## Canonical References

- [`docs/prd.md`](../docs/prd.md) — product requirements and acceptance criteria
- [`docs/architecture.md`](../docs/architecture.md) — runtime boundaries, security, data model, and testing strategy
- [`docs/projectplan.md`](../docs/projectplan.md) — Cycle 2 phases, gates, and cut order
- [`DESIGN.md`](../DESIGN.md) — visual system and UI constraints
