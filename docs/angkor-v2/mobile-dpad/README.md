# Angkor V2 mobile controls

Base: main `3b841592631f34fcb3308b3a0b4d93e32df8a72b`. Branch: `fix/angkor-v2-mobile-dpad`. No production deployment in this slice.

## Cause and fix

The previous minimum-height document-flow layout stacked variable HUD text, a fixed-height canvas and controls. Taller Stage III copy pushed DOWN outside the phone viewport. The shared D-pad grid had no horizontal centering owner. D-pad selection protection alone did not protect adjacent gameplay text from iOS long-press selection.

The active V2 component now owns a viewport-contained grid: compact complete HUD, `minmax(0,1fr)` room, and a reserved centered control dock. The shell uses visualViewport height/offset with a 100dvh fallback. Bottom padding is `max(12px, env(safe-area-inset-bottom))`; QA simulates a nonzero 34px inset. All four buttons retain 60px squares and the existing 56px narrow fallback. Short landscape viewports use a separate side dock.

The playfield retains the existing 352/384 logical pixel width and unchanged zoom/grid. Available room height determines logical canvas height, bounded to 96–320px. CSS dimensions share one scale, preserving square tiles. A ResizeObserver and visualViewport resize/scroll events coalesce measurements into one animation frame. Phaser resizes in place using the stable shared viewport object; browser chrome/orientation changes do not recreate the scene or reset state. Terminal summaries and claim content scroll inside the room instead of increasing page height.

Selection/callout suppression and contextmenu prevention are scoped to mounted V2 gameplay. The document overflow lock restores prior values on unmount. Touch and overscroll protections preserve existing Pointer Events; focus outlines and keyboard operation remain available. Movement, 145ms timing, buffering, reducers, proof/checkpoints, mission content and reward systems are unchanged.

## QA

Dev-only route: `/dev/angkor-v2-mobile-layout.html?scenario=stage3&reward=1&safe=34`. Scenarios: `stage1`, `stage3`, `transition`. It mounts the real production component with local presentation fixtures and no reward transport. It is not a production stage shortcut.

Chromium and Windows WebKit iPhone 14 Pro emulation cover all three scenarios at every size below. Screenshots use CSS-pixel scale, with debug labels off. Measurements and repeatable browser scripts are alongside this report. Screenshot files are in `output/playwright/v2-dpad-*`.

| Viewport | D-pad center (WebKit) | DOWN bottom | Bottom clearance | Button size |
| --- | ---: | ---: | ---: | ---: |
| 320×568 | 160 | 464 | 104 | 56×56 |
| 360×640 | 180 | 536 | 104 | 60×60 |
| 390×844 | 195 | 740 | 104 | 60×60 |
| 430×932 | 215 | 828 | 104 | 60×60 |

All directions are fully visible, the playfield remains visible, and document horizontal overflow is absent. Chromium fractional centers differ by at most 0.2px. Stage III's objective wraps over two lines without moving the dock. The shortest Stage III canvas fits into approximately 119px of displayed height; normal 390px phones retain approximately 304px. Real local `/play?practice=gem-runner` was also captured with the App styles, showing centered reachable controls.

Held-input checks exercise a 1.8-second press, release, browser-height change and landscape rotation. No selection, page jump or contextmenu survives; the same canvas and stage persist. A legal in-flight one-tile MOVE may finish after release; the resize assertion accepts only a continuous unit-grid MOVE chain, never a reset or teleport. Chromium repeats legal moves to x=8; WebKit's final cold emulation run advances one tile, while a warmed native touch/pointer check advances to x=8. Windows WebKit is not physical iOS Safari and does not expose its native Copy/Look Up UI: real iPhone retesting remains recommended before deployment.

Run the fixture checks with Playwright CLI `run-code --filename=docs/angkor-v2/mobile-dpad/layout-qa.txt` (or `webkit-layout-qa.txt`, `interaction-qa.txt`) against local Vite port 5174. WebKit screenshots have a `-webkit` suffix.

## Verification

- Focused viewport, directional input and traversal tests: 3 files, 12 tests passed.
- `npm run test:release`: 169 files passed, 5 opt-in files skipped; 1300 tests passed, 69 existing opt-in tests skipped; 170.50 seconds.
- `npm run build`, `npm run lint`, `npx tsc -b`, `npm run typecheck:server`, and `git diff --check`: passed. Build retains its existing large-chunk warning.
- No timeout changes, removed tests, production deployment, migration or financial action.

MOBILE_DPAD_FIX = READY_FOR_PRODUCTION
