# NimHunt character delivery slots

The marketing page currently uses the approved artwork in `src/assets/` through named React asset components. When final delivery art is approved, replace the manifest entries in `src/data/assets.ts` with optimized files using these filenames:

- `hero-explorer.webp`
- `hero-goblin.webp`
- `hero-golem.webp`
- `hero-nim-treasure.webp`
- `explorer.webp`
- `goblin.webp`
- `golem.webp`
- `nim-treasure.webp`
- `nimhunt-wordmark.png`

The hero and cast layout contracts do not change when these files are replaced. Do not use the existing `NimHunt Logo.png` as the current wordmark; it is labeled “Nimiq Treasure Hunt.”

The active header wordmark is `src/assets/nimhunt-wordmark.png`, wired through `src/data/assets.ts`. The original `src/assets/NimHunt Logo.png` remains preserved as the full-name artwork reference and is not used in the header.
