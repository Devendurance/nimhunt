# NimHunt — Angkor Production Asset Pack

Extracted and cleaned from the approved Angkor source sheets.

## Folders
- environment/ — 256×256 floor and wall sources
- overlays/ — 256×256 transparent overlays
- props/ — transparent gameplay objects
- hazards/ — transparent hazard assets

## Phaser notes
- The game uses a 32×32 logical grid.
- Scale 1×1 source textures to the desired 32px gameplay footprint in Phaser.
- Gate states share an identical 512×512 canvas and bottom-center alignment.
- Chest states share an identical 384×384 canvas and bottom-center alignment.
- inner-shrine.png uses a 384×384 source canvas with bottom-center placement.
- For transparent props, use the documented logical footprint rather than the full source canvas as collision geometry.

## State pairs
- temple-gate-locked.png ↔ temple-gate-open.png
- chest-closed.png ↔ chest-open.png
