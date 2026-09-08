# Design System Inspired by NimHunt
### (Structure: Rockstar Games GTA VI Landing Page × Palette: Temple-Jungle Direction)

**How to read this doc:** The layout skeleton — promo bar, collage-grid hero, release block, timeline pills, footer newsletter module — is lifted structurally from the Rockstar GTA VI page. Every color has been replaced per the jungle-temple direction (no purple, no neon pink). Every image slot that held GTA character/vehicle art now holds a labeled placeholder describing what NimHunt asset (mascot or scene) belongs there — **this system expects your mascot packs and scene packs to fill those slots**; it does not invent placeholder art for them. Where the source used Rockstar's own proprietary logotype, this doc describes the structural container only (diamond-frame lockup) and defers the actual "NimHunt" wordmark/mark to your existing brand assets.

## 1. Visual Theme & Atmosphere

This system trades GTA VI's nightlife-neon-Miami energy for something older and stiller: a forgotten temple world, lit by treasure-glow rather than streetlight. The structural bones stay — a poster-collage hero built around a central glowing title lockup, a bold release-date block, a repeating timeline of date pills, a bordered newsletter module in the footer — but the entire color language shifts from deep purple + hot pink to deep jungle-teal + warm gold. Per the brand direction: the world (jungle, stone, shadow, mist) should never compete visually with the treasure/NIM presence (gold) — gold is reserved for value and reward moments, not painted across the whole site.

**Key Characteristics**
- Deep, near-black jungle-teal base (Temple Night) replacing GTA's deep purple as the dominant dark field
- Warm NIM gold and treasure-glow reserved specifically for value/reward moments — CTAs, logo glow, key highlights — never used as a general background wash
- A poster-collage hero grid built from mascot and scene pack imagery, arranged around a central glowing diamond-shaped title lockup, structurally identical to the GTA VI collage-and-logo hero
- Supporting environment tones (sandstone, moss, jungle jade, ruin brown) that give the world texture without competing with the gold accent
- Gem-colored accents (blue, violet) reserved for playful/game-energy moments — UI highlights, secondary states — distinct from the "serious" gold-for-treasure role
- A repeating date-pill timeline component (structurally borrowed from GTA VI's announcement rows) repurposed as a world/chapter reveal timeline
- A bordered, icon-led newsletter signup module in the footer, structurally identical to "Get Rockstar Propaganda"

## 2. Color Palette & Roles

### Core
- **Temple Night** (`#132A26`): Primary dark base — replaces GTA VI's deep purple everywhere it appeared (backgrounds, nav, panel gaps, footer)
- **Chalk Mist** (`#F3EAD7`): Primary light/text color on dark backgrounds — soft warm off-white, never a cold pure white

### Treasure/NIM Accent (reserved — see governance note below)
- **NIM Gold** (`#F2C14E`): Primary CTA fill, key highlight color
- **Ancient Gold** (`#D89B2B`): Deeper gold, used for gradient shading and hover states
- **Treasure Glow** (`#FFD86A`): Brightest gold, used for glow effects and the hottest point of any gradient (logo lockup, button hover)

### Environment Support
- **Ancient Sandstone** (`#A56C43`): Secondary UI surfaces, environment-adjacent accents
- **Ruin Brown** (`#6E4B34`): Deep secondary surfaces, borders on environment-themed cards
- **Moss Green** (`#5E7C52`): Muted foliage accent, used sparingly in illustrative contexts
- **Jungle Jade** (`#2D8C73`): Slightly brighter green accent, promo-bar silhouettes, secondary buttons

### Gem/Game-Energy Accents
- **Gem Blue** (`#3E88F7`): Playful UI highlight, secondary interactive states
- **Gem Violet** (`#7B61D9`): Playful UI highlight, alternates with Gem Blue for variety in gem/reward iconography

**Governance note (important):** Gold (NIM Gold / Ancient Gold / Treasure Glow) is a *reserved* color, not a general accent. It should appear only where real value or reward is being communicated: the title lockup glow, primary CTA, treasure/reward UI moments, and small logo details. It should never become the dominant color of a full section — that role belongs to Temple Night, with sandstone/moss/jade providing texture. If a component needs "brand energy" but isn't a value/reward moment, reach for Jungle Jade or a Gem color instead of gold.

## 3. Typography Rules

### Font Family
**Primary (Display):** Jungle Fever — bold, jagged, torn-edge adventure display face; carries headlines, buttons, timeline dates, and section headings. Chosen over the other adventure-font options because its "ruins/jungle title-card" character is the most specific match for NimHunt's ancient-temple register — closer to an Indiana Jones/Jumanji title treatment than a generic playful game font
Fallback: 'Trade Winds', Impact, sans-serif

**Ornamental Accent:** Trade Winds — decorative pirate/treasure-map swash face; reserved specifically for the promo bar and other rare, short-phrase flourishes. Excellent thematic fit for "ancient treasure" but genuinely hard to read below headline size, so it's scoped tightly rather than used as a workhorse font
Fallback: 'Castle Chunk', cursive

**Secondary (Body/Legibility):** Inter, sans-serif — kept unchanged from the original system; carries nav menu items, body copy, forms, and legal text. This is the one font kept for visibility, per your note — none of the adventure display faces are legible enough for anything read at length or scanned quickly
Fallback: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif

**Title Lockup:** *Not typeset from a system font* — the "NimHunt" wordmark inside the diamond frame is treated as a supplied brand asset (your existing logo art), not something rebuilt in CSS type, consistent with how GTA VI's own logotype is a custom piece of brand art rather than a system font

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|-----------------|-------|
| Release Headline | Jungle Fever | 40px | Regular (face is inherently bold) | 42px | 0px | "COMING [DATE]" style block |
| Section Heading | Jungle Fever | 26px | Regular | 30px | 0px | Newsletter module heading, timeline section labels |
| Nav Label | Inter | 15px | 500 | 20px | 0.25px | Menu/dropdown items — kept in the legible font since users need to scan multiple options quickly |
| Button | Jungle Fever | 16px | Regular | 20px | 0.5px | CTA pill text, uppercase — short strings hold up fine in the display face |
| Promo Bar Label | Trade Winds | 16px | Regular | 22px | 0.5px | Top announcement strip — ornamental, one short phrase only; sized up slightly from a typical label size since the swash face needs the extra room to stay legible |
| Body Regular | Inter | 15px | 400 | 24px | 0px | Newsletter description, legal text |
| Timeline Date | Jungle Fever | 18px | Regular | 22px | 0px | Date-pill timeline entries |

### Principles
- Jungle Fever is the display workhorse — headlines, buttons, timeline dates, section headings — anywhere text is short, bold, and meant to feel like game title-card copy
- Trade Winds is reserved for exactly one role (the promo bar) and shouldn't spread further; it's the most thematically evocative face here but the least legible, so scope discipline matters more with this one than any other
- Inter stays the legibility font — nav menu items and anything read at length (body copy, forms, legal text) — never swap these to a display face no matter how tempting the adventure fonts look
- Keep the title lockup as supplied brand art, never rebuilt as live text — this preserves whatever custom logotype treatment your mascot/scene pack assets already establish

## 4. Component Stylings

### Hero Collage Grid — Asset Slots 🎨 (signature component, expects your mascot/scene packs)

Structurally identical to the GTA VI hero: 8 rectangular panels arranged in two rows around a central diamond-shaped title lockup, thin Temple Night gaps between panels. **Each slot below is a placeholder describing the expected asset type and role — fill with the corresponding pack art, not generic stock imagery:**

| Slot | Position | Expected Asset Type | Suggested Content |
|------|----------|---------------------|---------------------|
| 1 | Top-left | Scene pack | Angkor ruins / temple exterior establishing shot |
| 2 | Top-center-left | Mascot pack | Explorer character, running/action pose |
| 3 | Top-center-right | Scene pack | Gem chamber or glowing vault interior |
| 4 | Top-right | Mascot pack | Golem awakening or a guardian-type character |
| 5 | Bottom-left | Scene pack | Torchlit corridor or trap-filled passage |
| 6 | Bottom-center-left | Mascot pack | Goblin stealing treasure, mid-action |
| 7 | Bottom-center-right | Scene pack | Glowing NIM relic close-up |
| 8 | Bottom-right | Mascot/scene pack | Vault door or a second explorer/creature moment |

- **Panel Aspect Ratio:** Roughly 3:4 to 4:5 per panel (portrait-leaning), matching the GTA VI reference's panel proportions
- **Panel Gap:** `4-6px` Temple Night background showing between panels, mimicking the reference's mosaic-grid seams
- **Color Grading:** All panel art should be graded toward the same warm-dark palette (deep teals/browns with gold highlights) so the collage reads as one cohesive world, even if individual pack pieces were generated separately
- **Central Lockup:** The "NimHunt" title art sits inside a diamond/V-shaped frame overlapping the center of the grid, with a soft Treasure Glow outline/glow effect — gradient direction should run Ancient Gold → NIM Gold → Treasure Glow (replacing GTA's pink-purple-orange gradient)

### Buttons

**Primary Button (Pre-Order / Primary CTA)**
- **Background:** Gradient `#F2C14E` → `#FFD86A`
- **Text Color:** `#132A26` (Temple Night — dark text on the light gold fill, inverse of the source's dark-bg/light-text pattern)
- **Padding:** `14px 32px`
- **Border Radius:** `9999px` (full pill)
- **Border:** none
- **Font:** Jungle Fever, 16px, uppercase
- **Height:** `48px`
- **Glow Effect:** Soft `#FFD86A` glow bleeding outward from the pill edge, echoing the source's pink glow treatment
- **Hover State:** Glow intensifies, gradient shifts slightly warmer

**Secondary Button**
- **Background:** transparent
- **Text Color:** `#F3EAD7`
- **Border:** `1.5px solid #F3EAD7`
- **Border Radius:** `9999px`
- **Padding:** `12px 28px`

### Cards & Containers

**Promo Announcement Bar**
- **Background:** `#132A26`
- **Silhouette Art:** Jungle canopy or temple-ruin silhouette (replacing GTA's palm trees) in `#2D8C73` at low opacity, running along the bottom edge of the strip
- **Text:** Promo Bar Label role, `#F3EAD7`, centered
- **Icon:** A small emblematic icon (parrot, torch, or relic glyph — replacing GTA's bird) inline with the text

**Timeline Date Pill** (repurposed from GTA VI's repeating announcement rows)
- **Background:** `#1B3833` (a lighter step above Temple Night, for layering)
- **Border Radius:** `16px`
- **Padding:** `24px 32px`
- **Contents:** Date in Timeline Date role, plus space for a short reveal/chapter title beneath it
- **Layout:** 3-across row on desktop, matching the reference's 3-pill layout

**Newsletter Signup Module** (structurally identical to "Get Rockstar Propaganda")
- **Background:** `#132A26`
- **Border:** `1px solid rgba(243,234,215,0.15)`
- **Border Radius:** `20px`
- **Padding:** `32px`
- **Layout:** Icon + bold heading on the left, descriptive body copy on the right
- **Icon:** Your logo mark, small, paired with a heading like "GET NIMHUNT DISPATCHES" (placeholder — swap for real brand copy)

### Inputs & Forms (extrapolated — not directly visible in the source, styled consistently with the pill/component language)

**Text Input**
- **Background:** `#1B3833`
- **Border:** `1px solid rgba(243,234,215,0.2)`
- **Border Radius:** `9999px`
- **Height:** `44px`
- **Padding:** `0px 20px`
- **Focus State:** Border shifts to `#F2C14E`

### Navigation

**Primary Navigation**
- **Background:** transparent, sits directly on the Temple Night hero
- **Layout:** Logo mark left, primary CTA pill + hamburger menu icon right — no visible text nav links in the source, just icon/button affordances
- **Padding:** `24px 40px`
- **Sticky Behavior:** Nav persists in the same position as the user scrolls, consistent with the reference

## 5. Layout Principles

### Spacing System
**Base Unit:** `4px`
**Scale:** `4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px`

**Usage Context:**
- `4-6px`: Hero collage panel gaps
- `16-24px`: Timeline pill padding, nav padding
- `32px`: Newsletter module padding
- `48-96px`: Section-to-section spacing

### Grid & Container
**Max Width:** `1600px` for the hero collage (near full-bleed, matching the reference's large-format poster feel); `1100px` centered for footer/newsletter content
**Hero Arrangement:** 8-panel collage grid with the diamond lockup overlapping the center, release-info block directly beneath

### Whitespace Philosophy
The hero is meant to feel dense and immersive — a wall of world/character imagery, the way a game key-art poster is dense — while the footer and newsletter areas open up into more conventional, breathable spacing. That contrast (dense poster hero → calm structural footer) is itself borrowed from the source and should be preserved.

### Border Radius Scale
- `9999px` – Buttons, inputs, promo/timeline pills
- `16-20px` – Timeline pills, newsletter module
- `0-4px` – Hero collage panels (near-sharp, mosaic-tile feel)

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Nav, footer links, body text |
| Glow | Soft colored glow (gold, not pink) | Primary CTA, title lockup |
| Layered Surface | Slightly lighter fill than base (`#1B3833` over `#132A26`) | Timeline pills, newsletter module |

**Shadow Philosophy:** Like the source, this system doesn't lean on conventional drop shadows — depth comes from layering slightly lighter dark surfaces on top of Temple Night, and from the one deliberate glow effect reserved for gold/value moments. Keeping shadows out of the system keeps the gold glow feeling special rather than competing with generic UI elevation.

## 7. Do's and Don'ts

### Do
- Reserve gold (NIM Gold / Ancient Gold / Treasure Glow) for value and reward moments only — CTA, logo glow, key highlights
- Fill the 8 hero collage slots with actual mascot-pack and scene-pack art per the Asset Slot Guide — never with generic stock imagery or invented placeholder art
- Color-grade all collage panel art toward the same warm-dark palette so the mosaic reads as one cohesive world
- Keep the promo bar, timeline pills, and newsletter module structurally identical to the GTA VI reference — only the color and iconography change
- Use Gem Blue/Violet for playful, secondary UI moments — keep them clearly distinct from the gold "value" role

### Don't
- Don't let gold become a general background or section color — that's the one rule most likely to accidentally undo the "ownable, not just GTA-with-different-pictures" identity this palette is meant to build
- Don't reintroduce purple or hot pink anywhere in the system
- Don't leave hero collage slots as flat color placeholders in a shipped build — they're meant to be filled with real pack art, and the system should visibly expect that
- Don't apply the same glow effect to non-value UI elements; the glow should read as special specifically because it's rare
- Don't typeset the "NimHunt" title lockup as live text — treat it as supplied brand art, matching how the reference's own logotype is custom art, not a system font

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|--------------|
| Mobile | 375px–599px | Hero collage reduces from 8 panels to 4-5, prioritizing the strongest mascot/scene pieces; nav collapses further; timeline pills stack to 1 column |
| Tablet | 600px–1023px | 6 collage panels, timeline pills at 2-across |
| Desktop | 1024px–1439px | Full 8-panel collage, 3-across timeline |
| Wide | 1440px+ | Collage scales up, max-width 1600px |

### Touch Targets
- **Minimum Size:** `44px × 44px`

### Collapsing Strategy
- **Hero Collage:** Drop panels in this priority order when space is constrained: keep the central lockup and at least 2 mascot slots and 2 scene slots first, dropping supporting/secondary slots before primary ones
- **Timeline Pills:** 3-across → 2-across → 1-column as viewport narrows
- **Nav:** Logo and CTA pill remain visible at every breakpoint; only the hamburger menu behavior changes

## 9. Agent Prompt Guide

### Quick Color Reference
- **Base:** Temple Night (`#132A26`) | **Text:** Chalk Mist (`#F3EAD7`)
- **Reserved Value Accent:** NIM Gold (`#F2C14E`) → Ancient Gold (`#D89B2B`) → Treasure Glow (`#FFD86A`)
- **Environment:** Sandstone (`#A56C43`), Ruin Brown (`#6E4B34`), Moss Green (`#5E7C52`), Jungle Jade (`#2D8C73`)
- **Game Energy:** Gem Blue (`#3E88F7`), Gem Violet (`#7B61D9`)

### Iteration Guide
1. **This system expects mascot-pack and scene-pack imagery in the 8 hero collage slots** — build the grid structure and treat each slot per the Asset Slot Guide in Section 4; don't fabricate placeholder art to fill gaps.
2. **Gold is reserved for value/reward moments only** — CTA, logo glow, treasure UI. If you're reaching for gold and it's not one of those, use Jungle Jade or a Gem color instead.
3. **Temple Night is the dominant field color everywhere** — this replaces every instance of GTA VI's purple, including nav, panel gaps, and footer.
4. **The title lockup is supplied brand art, not live type** — build the diamond-frame container and glow effect, but drop in the actual NimHunt logo/wordmark asset rather than setting text.
5. **Color-grade all collage panel art consistently** toward the warm-dark jungle-temple palette so mixed-source pack art reads as one cohesive poster.
6. **Timeline pills and the newsletter module are structurally copied from the reference** — same layout, only recolored; don't redesign their structure.
7. **No purple, no hot pink, anywhere in the system** — this is the single most important deviation from the structural reference.
8. **Buttons and pills are always full-radius (`9999px`)** — matches the reference's pill language throughout.
9. **Gem Blue and Gem Violet are for playful/secondary UI only** — keep them visually distinct from the gold "value" role so the two accent systems don't blur together.
10. **The promo bar's silhouette art should read as jungle/temple, not palm trees or nightlife** — swap the illustrative motif, keep the structural placement and treatment.
