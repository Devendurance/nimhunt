# Vault Breaker II — Ancient Mechanism

Dev-only, 32×26 logical tiles (1024×832 world). Uses the approved 32px grid,
145ms traversal, held inputs, camera, depth/cutaway renderer and item emphasis.
No production route, proof, reward or other mission changes. Inner Vault remains
a definition/contract; there is no Stage III map or Golem gameplay.

## Play

`npm run dev -- --port 5174`, then `/dev/angkor-v2-vault-breaker.html`.
Start Temple Approach, finish it, and Continue into Ancient Mechanism.
Arrows/WASD or the existing held D-pad move one tile at a time. Entering the
Rotary Seal tile cycles it once; standing still never rotates it. Debug is off
by default. Reset creates a new expedition, not a puzzle recovery shortcut.

Six connected areas: monumental Mechanism Foyer; reversible Counterweight Hall;
Rotary Gallery with an optional archive recess; enclosed Relay Chamber and Core;
three-lane Guardian Run; framed Inner Lock. Solids and gate cells come from
explicit tile truth, independently of the rendered wall/prop alpha.

## Mechanism truth

| Mechanism/gate | Logical cell | Open condition |
|---|---|---|
| Counterweight plate | (6,17) | Authored stone occupies plate |
| Counterweight A | (11,14) | Plate occupied |
| Counterweight B | (11,18) | Plate released |
| Rotary Seal interaction | (16,13) | A → B → C → A on entry |
| Archive recess | (20,11) | Seal A |
| Relay | (20,15) | Plate occupied AND Seal B |
| Northern approach | (16,9) | Seal C |
| Inner Lock | (27,3) | Core awakened AND plate occupied AND Seal C |

The stone is constrained to x6, y16–18; both ends have walkable push positions
and side access. A standing Explorer does not count as weight. The lower service
recess is optional and accessed while the plate is released. Weighting the plate
opens the upper progression route and closes that recess. Gate state changes are
serialized, with separate historical objective milestones.

Enter the Relay with B + weight, then awaken the Core at (27,16) once. Return to
the seal and set C while leaving the stone on its plate. Reach (28,2) through
the final open lock. A, B and C can always be revisited; neither a missed turn
nor pushing the stone to either end permanently traps the player. The finite
recovery test explores every reachable player/stone/seal/Core/objective state
using the actual MOVE reducer and proves a completion path from every node.
Hazard timing and safe lanes are verified separately.

## Defense, optional loot and carry

Exactly two fixed-lane Dart Guardians: horizontal y4, x15–22; vertical x28,
y4–6. Warning 8 ticks, flight 2, recovery 16; ticks are explicit 150ms actions.
Darts deal 16 HP. Adjacent legal cells remain safe. One ordinary snake inhabits
the optional archive recess, with the established 12 HP contact pattern.
No monkey, extra spikes or falling rubble in Stage II.

Optional Gems: (17,20), (24,11), (28,18). One potion at (14,21) uses the existing
immediate +25 HP, capped at 100, owned/consumed semantics. No Gem quota.
Damage uses the established six-tick immunity. Exact HP and sword/potion state
carry; keys, stones, wildlife and mechanisms do not. The Core is an objective,
never expedition inventory. Zero HP ends the attempt and blocks continuation.

Completion stores exact HP/items, objective milestones, ending counterweight
and rotary state, optional Gem count, tick and action count. Continue reaches
`INNER VAULT / READY_FOR_STAGE_3 / NOT BUILT YET`, preserving both stage results.

## Art and implementation

Only two new transparent originals were generated:

| Asset | Source | Display canvas | Bytes |
|---|---|---|---:|
| rotary-seal-v2 | 1254×1254 | 40×40 | 2,152,416 |
| mechanism-core-v2 | 1254×1254 | 34×36 | 1,265,174 |

Seal anchor (.5,.5); Core anchor (.5,1147/1254). Both retain 1×1 noncollidable
footprints. Active seal sockets are small amber/cyan/jade state indicators.
The Core uses the shared first-viewport glint and subpixel pickup bob. Existing
gate pairs, plate engagement and passage contrast are reused without asset
replacement. No environment or wildlife art was regenerated.

Stage II files live in `src/game/vaultBreaker/stage2/`, with its dev UI in
`src/dev/vaultBreakerStage2.tsx`. Vault contracts/runtime now validate ordered
stage-specific objectives/results. Stage I's reducer changes only its result
type; its behavior and old recorded envelope remain identical. The v1 isolated
envelope namespace/boundary format remains unchanged. Legacy contract-only
boundary snapshots retain their empty objective placeholder; real Stage II
reports supply its own local objectives.

## QA and verification

[Full real-input Stage I → II recording](qa/ancient-mechanism-complete.webm):
390×844 browser viewport, 25fps. Touch hold and buffered turn checked in Stage I;
Stage II demonstrates plate activation/release/recovery, every seal state,
archive snake, all three optional Gems, potion, Relay/Core, both guardians,
Inner Lock and Stage III contract. No state injection, teleports or fake stages.

Final captured carry: Stage I 78 HP → Stage II 78 HP; potion heals 22 to 100;
two dart hits leave 68 HP. Both stages collect 3 optional Gems. The exported
[MOVE/TICK envelope](qa/vault-breaker-stage2-replay.json) contains 1,083 ordered
entries. It replays identically through both real adapters, including complete
Stage II gate/Core/wildlife/event state and every result/carry boundary.
Real-input automation is retained in [playthrough.txt](qa/playthrough.txt).

Actual 32px-scale screenshots in `qa/`: entry, inactive/active/released plate,
seal A/B/C, visible Core, both guardian tells, open Inner Lock, both stage
transitions and mobile/desktop Stage III contract. Debug labels are off.

Checks: focused model/runtime/manifest/readability tests 45 passed; full suite
1,268 passed / 69 existing skipped; final recording replay test passed; build,
lint, root `tsc -b`, server typecheck and diff whitespace check passed. Build
retains the existing large-chunk warning. The newly captured envelope was
rechecked after capture; broad verification was not repeated.

**VAULT_BREAKER_STAGE_2: READY_FOR_HUMAN_PLAYTEST.** Human review should focus on
seal-state discovery, inverse gate reasoning and guardian timing on a handset.
Stop here; no Inner Vault/Golem or production integration.
