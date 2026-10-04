# Angkor V2 segmented health meter

Base main: `4219e805569368dbbd4ade9de75667a480d0fa96`. Branch: `feat/angkor-v2-hp-meter`. Presentation only; no production deployment.

## Implementation

`AngkorV2HealthMeter` is shared by the production `AngkorV2Gameplay` Stage header for every mission, stage, boss, Practice and Reward Run. It consumes expedition HP as a prop; the display never writes authority. `healthPresentation` contains the pure display mapping. No reducer, damage, healing, carry, movement, proof, checkpoint or reward code changed.

Four independently recessed segments represent 25HP each. Fill for segment index i (0–3) is `clamp((HP - i * 25) / 25, 0, 1)`. Thus87HP=[1,1,1,.48],63=[1,1,.52,0],38=[1,.52,0,0]. Actual HP is never rounded. All fills inherit the same current tone:

| Actual HP | Tone |
| --- | --- |
|76–100|Green|
|51–75|Yellow|
|26–50|Orange|
|1–25|Red|
|0|Empty, red danger frame/text|

The meter is99×18CSSpx (60×18frame +5gap +34numeric area). Its four chunky blocks, dark recessed cells, muted sandstone border and small exact `HP n` text fit the Angkor header. Empty cells remain visible; quantity and numeric text communicate health without relying only on color. It has `role=meter`, min0/max100/current value and `aria-label="Health n of 100"`.

Damage and healing update immediately with no trailing value or tween. No nonessential animation is introduced, including under reduced-motion preference. The stage title may wrap at320px; controls retain their reserved centered dock,60px buttons/56px narrow fallback and safe-area clearance. At390px the Stage III header stays one line and the HUD height is unchanged.

## QA

The existing dev mobile-layout page mounts the actual production shell with dev-only HP and boss fixtures. Parameters: `?scenario=stage3&hp=75&reward=1&safe=34`; `boss=1` places the player inside the real Anaconda Sanctum and allows its normal ticks/presentation to activate. Fixtures never submit reward transport or create a production shortcut. A0HP fixture starts from valid living carry-in, then applies0HP to the HUD/local state to inspect the failure display.

`qa.txt` captures100/75/50/25/0HP at320×568,360×640,390×844,430×932 and asserts exact ARIA/text, tones, meter containment, button centering/visibility, nonzero34px safe-area simulation and no horizontal overflow. It also checks same-mounted damage76→75→42 and healing42→67, identical Practice/Reward meter markup, transition67HP preservation and reduced-motion behavior. Metrics are in `qa-results.json`; screenshots in `output/playwright/v2-hp-*`, including a real active Anaconda scene.

The automated stage-boundary and HP-carry regression suites remain unchanged and pass. Presentation fixtures are not new authoritative HP changes or fake stage results.

## Verification

- Targeted health/viewport tests:16passed, covering100,99,76,75,74,51,50,49,26,25,24,1,0 and accurate partial fills/healing.
- `npm run test:release`:170files passed/5existing opt-in files skipped;1314tests passed/69existing skips;158.63s.
- Build, lint, root/server typechecks and diff check passed. Existing large-chunk warning remains. An initial lint finding was fixed by moving the pure mapper to its own module; dev-fixture typing was corrected without relaxing domain types.
- No deployment, financial action, gameplay changes or unrelated staging.

ANGKOR_V2_HP_METER = READY_FOR_REVIEW
