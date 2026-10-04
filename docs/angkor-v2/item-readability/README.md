# Angkor V2 gameplay-item readability

Branch `feat/angkor-v2-item-readability`, based on approved Chest Hunter V2 `e3e92179cbec9408a0f44351fff89649a47befde`. Presentation-only slice across all current V2 missions. No merge, production integration or Vault Breaker work.

## Review

- [Actual phone-scale before/after room comparison](compare.html). Run the existing Vite server and open `/docs/angkor-v2/item-readability/compare.html`, or view this standalone HTML with its sibling QA files.
- Gem Runner: `/dev/angkor-v2-gem-runner.html` (all three stages share the V2 item renderer).
- Chest Hunter: `/dev/angkor-v2-chest-hunter.html` (Lost Courtyard → Forgotten Galleries → Royal Treasury).
- Debug remains OFF. Compare at native390px phone width; horizontal scrolling in the comparison keeps each room at actual scale rather than shrinking it.

## Changed assets / scale

No PNG regenerated or overwritten. Original filenames, alpha, source dimensions, outlines, paired-state registration, anchors and logical footprints remain byte-for-byte unchanged. The shared renderer caches scene-owned RGB-graded copies only for the following interactive sprites. The manifest centralizes adjusted display sizes; wildlife, architecture and floor styles are not graded.

Dimensions below are configured canvas display sizes; transparent padding means the visible object is smaller. All logical footprints remain unchanged.

| Art | Before display | After display | Visible after / change |
|---|---|---|---|
| bronze-temple-key-v2 | 18×24 | 28×34 | ~25.1px high /22.5px wide, bright warm bronze-gold |
| silver-archive-key-v2 | 18×24 | 26×30 | ~25.7px high /24.4px wide, bright cool silver |
| royal-seal-key-v2 | 18×24 | 26×30 | ~25.7px high /24.4px wide, richer gold and retained seal accent |
| blue-gem-v2 | 18×24 | 20×26 | ~24.1px high, restrained cyan facet separation |
| potion-v2 | 18×24 | 22×24 | 24px high, saturated ruby liquid and glass separation |
| chest-closed/open-v2 | 32×36 | 40×42 | Closed body~31.3px wide; brighter treasure wood/metal |
| royal-cache-closed/open-v2 | 36×40 | 44×46 | Closed body~34.7px wide; richer high-value gold |
| pressure-plate-v2 | 30×30 | 30×30 | Stronger inset contrast; held state materially brighter |
| side-gate-locked/open-v2 | 64×64 | 64×64 | Warm sealed fitting vs steady jade open threshold |
| temple-passage-closed/open-height-v2 | 96×80 | 96×80 | Closed bronze seal vs lit cool opening/threshold |
| provisional temple-passage-closed/open-v2 | 112×96 | 112×96 | Same state-emphasis treatment when used in V2 previews |

V2 currently has **no standalone sword pickup/sword PNG**. Sword ownership resolves immediately as authored chest loot and carries in the HUD/domain state. That behavior/art scope is retained; no new pickup or sword mechanic invented. The V1 sword file is untouched.

## Saturation / silhouette

Item RGB grading leaves source alpha and all pixels at luminance≤35 unchanged, protecting the dark silhouette and contact edges. Midtones/highlights receive a bounded brightness gain and saturation around their original luminance; upper-left shading, engravings, object shapes and original identity remain. Warm keys/wood receive a small warm bias; silver a cool bias. No floor/world-wide brightening, shader wash, massive neon halo or icon layer.

Profile brightness/saturation parameters: bronze .34/1.32; silver .38/1.12; royal key .36/1.40; Gem .07/1.12; potion .18/1.38; ordinary closed/open chest .24/1.22 and .16/1.18; Royal Cache .30/1.28 and .22/1.24; plate .18/1.16; gates .08/1.12. These are curve parameters, not flat percentage boosts across every source pixel. Passage artwork RGB is unchanged; only its physical opening/seal emphasis differs.

One Royal Treasury foreground root moved from x304→280 (same y127) along neighboring carved masonry, exposing the Royal Seal Key's head. This is decorative placement only; map rows, collision, key cell, puzzle geometry and all authoritative state are unchanged. No environment assets regenerated.

## Reusable emphasis

`InteractableEmphasis` is owned by `AngkorV2Environment`. Every eligible modular sprite automatically receives its item profile, including all Gem Runner stages and all Chest Hunter stages. No per-stage duplicated glint loops remain.

- Key: one restrained750ms first-viewport discovery glint; periodic glint thereafter.
- Closed chest/key/Gem/potion:6px cross highlight,240ms every5.6s, staggered by presentation-only index. Royal Cache uses4.4s and a slightly stronger glint. Open chests stop glinting.
- Gems/keys/potion: ±.75px bob only; fixed contact shadow stays on the floor. Logical cells, foot/depth authority, input, collection and collisions do not move.
- Hidden/collected sprites draw no glint or shadow. Rendering remains at local object depth, never a global overlay above all ruins.
- Reduced motion: bob/discovery/periodic glints disabled. Static colour/size and steady mechanism state cues remain.
- Chest potion receipt: a small actual potion sprite appears for650ms then fades250ms after existing loot resolution. It is presentation feedback, not a new pickup; healing/item consumption is already complete in the unchanged reducer.
- Textures are graded once per scene/state variant, reused across instances and released with the environment; original source textures remain immutable. Runtime copies preserve every alpha byte and source canvas extent.

## State readability

Chest/Cache paired files use identical manifest display size and anchor and keep their original matched canvas. Open lid state swaps at the same contact point. Gates preserve their source transparent opening and anchored state swap. No footprint or gate collision changes.

Inactive plate: bronze inset/perimeter. Active plate: brighter RGB inset and steady jade/chalk engagement trim visible around the held stone. Moving the boulder off restores the inactive appearance using the existing presentation tint flag; no authority comes from overlap or pixels.

Locked side gate: visible warm central fitting. Open gate: physical jade threshold line. Closed passage: small bronze seal. Open passage: cool inset light and short doorway-edge highlights. These are diegetic details with no floating arrows, text markers or aggressive pulses.

## Mobile QA

Before/after screenshots are390×844, real gameplay at unchanged square32px grid scale. They cover Gem Runner, all three Chest Hunter stages, each key **before** pickup, ordinary chest, resolved potion, both gate states, inactive/active/released plate, dual seals, Royal Cache closed/open and closed/open final passage. Debug remains off; no object labels were added.

The complete Chest Hunter route was played before and after through real touch/keyboard inputs, including the reversible mechanisms and final completion. Gem Runner entry was separately checked at matching phone size. Existing full replay fixtures still pass unchanged through every model. First polished pass exposed the occluding root; the final capture repeats the route after that one decorative correction.

Curated evidence:
- [Gem Runner](qa/after-mobile-gem-runner.png)
- [Bronze key](qa/after-mobile-bronze-key-visible.png), [ordinary chest](qa/after-mobile-ordinary-chest-closed.png), [potion feedback](qa/after-mobile-potion-loot.png)
- [Silver key](qa/after-mobile-silver-key-visible.png), [inactive plate](qa/after-mobile-pressure-before.png), [held plate](qa/after-mobile-pressure-active.png), [released plate](qa/after-mobile-pressure-released.png)
- [Royal key](qa/after-mobile-royal-key-visible.png), [twin seals](qa/after-mobile-both-seals-held.png)
- [Closed Royal Cache/exit](qa/after-mobile-royal-cache-closed.png), [open Royal Cache/exit](qa/after-mobile-royal-cache-open.png)
- [Complete expedition](qa/after-mobile-expedition-complete.png)

## Verification / boundaries

- Targeted visual/manifest + Chest Hunter/Gem Runner/stage models: **131 pass across13files**.
- Full `npm test -- --testTimeout=120000`: **1,231 pass /69 existing skips;153 passing /5 skipped files**.
- `npm run build`: pass (existing large-chunk warning only).
- `npm run lint`: pass.
- Root `npx tsc -b`: pass.
- `npm run typecheck:server`: pass.

Tests cover alpha/source preservation, untouched environment eligibility, warm/cool palette separation, active-plate value, discovery/reduced-motion/hidden/open suppression, state-pair alignment, cache ownership/reuse/cleanup and unchanged depth. Existing full expedition replay tests prove identical authoritative results for identical actions. No reducer, action/event contract, replay envelope, mission rule, damage constant, gameplay map geometry, V1 or production/economics path changed.

Changed paths: manifest display dimensions; shared V2 environment integration; new item profile/emphasis helper and focused tests; three Chest Hunter presentation scenes (shared glints/potion receipt); one Royal Treasury decorative root; this report/comparison/screenshots. .agent-state and videos are preserved and excluded from the commit.

**ANGKOR_V2_ITEM_READABILITY READY_FOR_REVIEW** Technical checks and mobile visual QA pass. Human visual approval remains the next step; no Vault Breaker work begins here.
