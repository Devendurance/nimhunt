# Anaconda vertical pit presentation

Visual-only slice from `b041f8b` on `feat/angkor-v2-anaconda-rework`. The Stage III reducer, level geometry, runtime/adapters, transcript semantics, Stage I/II, production routes/proof and economics are unchanged. Old Anaconda files remain available; the active encounter no longer draws floor coils or loose body traces.

## Assets

Built-in GPT Image generated six consistent head/upper-neck poses, using the approved olive/gold diamond-scaled Anaconda as identity reference. Sources were transparent 1024x1536 portraits. Delivery uniformly scales and aligns them on 512x768 RGBA canvases with bottom-center anchor (256,752); no reference-board crops or artistic pixel edits.

| Added file in `public/assets/game/angkor-v2/wildlife/anaconda/` | Bytes |
|---|---:|
| anaconda-pit-peek-v3.png | 121612 |
| anaconda-emerge-v3.png | 204878 |
| anaconda-upright-v3.png | 274828 |
| anaconda-attack-v3.png | 215004 |
| anaconda-hit-v3.png | 223659 |
| anaconda-retract-v3.png | 162114 |

All draw on a 64x112 canvas. Upright opaque height is 108.5px before the lip; about100.5px rises above the mouth. The Explorer remains about28px tall. Manifest adds six noncollidable visual poses with shared anchors; only the existing logical pit cells determine collision. The six source prompts preserve identity/colors, top-down3/4 camera, upper-left light and transparent exterior, and request respectively: head/tiny neck peeking; partial vertical emergence; fully upright long neck; upper-neck forward attack bend; backward head recoil; shortened neck sinking. They prohibit floor coils, tails, pit art/backgrounds, baked effects and text. Exact source paths, export bounds/dimensions and sizes are in `asset-metadata.json`.

Rejected: first portrait draft placed the head far right of the neck, so a centered upright master replaced it. First room pass let the parked boulder obscure that head. Existing pillar cradles now hold rocks above it, with alpha-aware player readability. No new art style or other asset family was generated.

## Pit/depth implementation

`anacondaPresentation.ts` is Phaser-free presentation geometry reading existing state/ticks/events. It cannot dispatch gameplay actions. One serpent image follows the active pit only. No pose scales down or fades out to simulate disappearing: it translates below a fixed mouth mask.

Rear/interior: full existing `serpent-pit-v2`,64x40, floor-overlay depth. Serpent: common bottom anchor8px inside the opening, stable architecture depth at pit floor Y432. Foreground lip: the same texture cropped below sourceY192, registered at the identical pit position, depth one increment above serpent. It covers the neck base; the mouth mask also clips pixels underneath the opening. Other architecture still interleaves by approved Y-depth. Cached real alpha samples apply the shared readability fade when the moving Explorer's head is covered. Consumed stones are excluded from dynamic readability; static cradles use existing environment occlusion.

| Domain state | Derived presentation |
|---|---|
| DORMANT | Empty pits; serpent hidden |
| EMERGING | First2 ticks shake/dust; remaining10 ticks peek → partial neck → upright |
| VULNERABLE | Upright, rooted to that pit |
| RETALIATING | Hit recoil for4 ticks if hit; upright tell, then forward attack pose for last5 ticks |
| RECOVERING | Attack → retract, physically sinks over8 ticks; stays hidden while replacement resolves |
| DEFEATED | Hit recoil4 ticks, then full sink through same lip during remaining10 ticks; stays gone |

Golden replay verifies full retraction before each pit change. Raised rocks roll out of their cradles on the existing one-cell release and fall to the calibrated head point at the existing4-tick impact. Rock/dust effects and camera shake occur there, with a larger final impact. Replacements visibly land back on the same raised cradle. These are visual offsets; logical cells, damage and readiness remain unchanged. Reduced motion suppresses shake/rock-roll effects; the essential readable rise/sink remains.

## Mechanics confirmation

CENTER → LEFT → RIGHT; exactly3 environmental hits. Vulnerability80/64/48 ticks, tell16/16/18, emergence12, drop4, defeat14; tick150ms/traversal145ms. Retaliation26 and replacement24 damage, existing immunity, Gem requirement8/12 available, carry/failure/exit rules and event payloads are unchanged. No new authoritative visual substates, wall-clock outcomes or replay actions.

## QA

Route: `/dev/angkor-v2-gem-runner.html`. Real keyboard plus touch release inputs played I → II → III normally. Fresh navigation avoids transient Vite hot-reload React-root warnings seen while editing; final run adds no runtime errors. Debug stays off in review captures.

`qa/full-boss.mp4` is a54.04s boss-only phone recording,278x600 after removing the recorder's unused gray padding. It includes initial empty center pit, vertical rise, a missed window/retry, all three pit phases, head impacts, rooted retaliation, replacement drops, final full sink and open Escape Passage. No Stage I/II footage. Source recording is archived outside the repository.

Selected screenshots: `mobile-left-emerging.png`, `mobile-upright.png`, `mobile-rock-impact-frame.png`, `mobile-final-retracting.png`. Also retained: empty center, falling rock, attack, settled/unlocked pits, open passage and an upright room crop. Phone viewport390x844 CSS pixels; immediate captures retain device pixels (488x1055), with no artificial zoom. Impact image is an unmodified frame from the third-hit recording (~43.5s,278x600); capture latency otherwise missed the short dust burst. Earlier mis-timed/duplicate captures are archived outside the repository. `visual-proof.json` preserves raw pre-capture state observations; capture names are observational, not gameplay assertions.

`qa/full-expedition-envelope.json` contains the complete recorded run: Stage I7 Gems → II10 → III9 =26 total, HP64, all3 results and3 boss hits. Tests replay it to an identical envelope. The earlier approved rework fixture still replays to HP52/Gems29 and identical boss events/boulders; it remains untouched.

## Verification

- Focused boss/presentation/manifest tests:31 passed before the final recorded-run assertion; Stage I/II/runtime focused coverage also passed.
- Full `npm test -- --testTimeout=120000`:1180 passed /69 skipped;148 files passed /5 skipped.
- `npm run build`, `npm run lint`, `npx tsc -b`, `npm run typecheck:server`: passed. Existing >500KB bundle warning remains.
- No Stage I/II/domain/level/runtime or production changes. Unrelated `.agent-state` and videos preserved.

Human visual approval is still the next step. This slice does not integrate production.
