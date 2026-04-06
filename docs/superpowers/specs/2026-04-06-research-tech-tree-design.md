# Research Tech Tree Design

## Overview

Replace the current flat-list research overlay with a full-screen, pannable/zoomable tech tree. Research is organized into 8 independent category trees (trunks), each with its own progression from basic to advanced. Nodes either unlock new beamline/facility components or provide passive performance bonuses. Visual style inspired by Civilization/Factorio tech trees.

## Categories

Eight independent trees, displayed as columns left-to-right:

| Column | Category | Root concept | End-game payoff |
|--------|----------|-------------|-----------------|
| 1 | **Beam Optics** | Focusing & steering | SC magnets, advanced lattice, octupoles |
| 2 | **RF Systems** | Basic RF acceleration | High-gradient cavities, SRF gun |
| 3 | **Vacuum** | Basic pumps | UHV, bakeout techniques |
| 4 | **Cryogenics** | Cryo basics | High-Q SRF at 2K, cryo optimization |
| 5 | **Diagnostics** | Beam measurement | Machine protection, advanced instrumentation |
| 6 | **Photon Science** | Synchrotron light | FEL physics, Compton scattering |
| 7 | **Data & Computing** | Data analysis | Automation, passive funding |
| 8 | **Machine Types** | Cyclotron tech | Storage ring, plasma acceleration |

Each tree is fully independent — no cross-trunk prerequisites.

## Tree Structures

### Beam Optics
```
Beam Optics (collimator)
├── Bunch Compression (buncher, chicane, dogleg, harmonic linearizer)
├── SC Magnets (SC quad, SC dipole, cryocooler)
│   └── Lattice Design (combined function magnet)
│       └── Advanced Optics (sextupole, octupole)
│           └── High Luminosity [+2x luminosity]
│               └── Particle Discovery [+10% discovery chance]
└── Beam Transport (septum magnet)
    └── Fast Kickers (kicker magnet)
```

### RF Systems
```
RF Fundamentals [new — basic RF knowledge, minor efficiency boost]
├── CW RF Systems (CW klystron, IOT)
│   ├── Digital LLRF (LLRF controller, timing system)
│   │   └── Advanced RF (multi-beam klystron, high-power SSA)
│   └── SRF Technology (cryomodule, cryo plant, transfer lines)
│       ├── CW Linac Design (650 MHz SRF cavity)
│       └── Energy Recovery [-30% energy cost]
├── RF Photoinjectors (NC RF gun)
│   ├── High-Gradient RF (C-band, X-band cavities)
│   └── SRF Gun Technology (SRF gun)
└── Photocathodes (DC photo gun, laser system)
```

### Vacuum
```
Basic Vacuum [new — teaches vacuum concepts, small quality boost]
└── UHV Systems (ion pump, NEG pump, TSP, BA gauge, bakeout)
```

### Cryogenics
```
Cryo Fundamentals [new — basic cryo concepts]
└── SRF Cryogenics (He compressor, cold box 4K, LN2 precooler)
    └── High-Q SRF (2K cold box, He recovery)
        └── Cryo Optimization [-30% cryo losses]
```

### Diagnostics
```
Beam Diagnostics (wire scanner, bunch length monitor, energy spectrometer)
└── Machine Protection (MPS, beam loss monitor, emergency cooling)
```

### Photon Science
```
Synchrotron Light (undulator, wiggler, SR light monitor, photon port)
└── Advanced Undulators (helical undulator, APPLE-II)
    └── FEL Physics (laser heater)
        └── Photon Science (Compton IP)
```

### Data & Computing
```
Data Analysis [+2x data rate]
└── Automation [+$2/s passive funding]
```

### Machine Types
```
Cyclotron Technology (small cyclotron)
├── Isochronous Cyclotron (large cyclotron)
├── Proton Acceleration (ion source, RFQ, DTL, proton quad/dipole)
│   └── Synchrotron Technology (synchrotron booster)
│       └── Storage Ring Technology (storage ring)
└── Target Physics (fixed target)
    └── Advanced Target Physics (W/LH2 targets)
        └── Antimatter (positron target)
```

Note: `Plasma Acceleration` moves under FEL Physics in the Photon Science tree (thematically it's laser-driven). `Antimatter` moves to Machine Types under Target Physics (needs high-energy targets).

## Node Types

Two visual types within every tree:

1. **Unlock nodes** — unlock new beamline or facility components. Displayed with a component icon and the name(s) of what they unlock.
2. **Boost nodes** — provide passive multipliers/bonuses (data rate, energy cost, luminosity, etc.). Displayed with an upward arrow icon and a short description of the effect.

Both types share the same research mechanics (cost, duration, prerequisites).

## Node States

| State | Visual | Interaction |
|-------|--------|-------------|
| **Locked** | Grey/dimmed, dashed connector lines | Hover shows name + "Requires: X" |
| **Available** | Bright border (green glow), solid connectors | Click opens research confirmation |
| **In Progress** | Animated pulsing border + progress bar | Click shows progress, cancel button |
| **Completed** | Solid filled background, checkmark | Hover shows what was unlocked |

All nodes are always visible (even locked ones), so the player can see the full tree and plan ahead.

## Data Model Changes

### RESEARCH object

Each research item gains a `category` field. The `tier` field is removed (tree depth replaces it). New root nodes are added for trunks that currently lack one.

```js
const RESEARCH_CATEGORIES = {
  beamOptics:    { name: 'Beam Optics',     color: '#4ac' },
  rf:            { name: 'RF Systems',      color: '#c44' },
  vacuum:        { name: 'Vacuum',          color: '#999' },
  cryo:          { name: 'Cryogenics',      color: '#48c' },
  diagnostics:   { name: 'Diagnostics',     color: '#eee' },
  photonScience: { name: 'Photon Science',  color: '#c8c' },
  data:          { name: 'Data & Computing', color: '#8c8' },
  machineTypes:  { name: 'Machine Types',   color: '#ca4' },
};
```

Each `RESEARCH` entry adds:
```js
{
  ...existing fields,
  category: 'rf',       // which trunk
  // tier: removed
  // requires: unchanged — still references other research IDs within same category
}
```

### New root nodes

These are cheap/fast introductory researches at the top of trunks that currently start mid-tree:

- `rfFundamentals` — category: rf, cost: {data: 5, funding: 200}, duration: 15, effect: {energyCostMult: 0.95}
- `basicVacuum` — category: vacuum, cost: {data: 5, funding: 200}, duration: 15, effect: {qualityBoost: 0.02}
- `cryoFundamentals` — category: cryo, cost: {data: 8, funding: 400}, duration: 20

### Prerequisite rewiring

Some existing `requires` fields change to keep trees independent:

- `srfTechnology`: currently requires `cwRfSystems`. Stays in RF tree, unchanged.
- `cryomodule` unlock: currently on `srfTechnology`. Split — RF tree's `srfTechnology` unlocks the cryomodule component. Cryo tree's `srfCryogenics` (new) unlocks the cryo plant/transfer line infrastructure.
- `rfPhotoinjectors`: currently requires `[photocathodes, digitalLlrf]`. Both are in the RF tree, so this stays.
- `felPhysics`: currently requires `[advancedUndulators, bunchCompression]`. Since we don't want cross-trunk deps, `felPhysics` only requires `advancedUndulators` within the Photon Science tree. Bunch compression is a separate tree benefit the player will naturally have by that point.
- `antimatter`: currently requires `[highGradientRf, targetPhysics]`. Moves to Machine Types tree, only requires `targetPhysicsAdv`.
- `plasmaAcceleration`: currently requires `felPhysics`. Moves to Photon Science tree under FEL Physics.

### Save compatibility

The `completedResearch` array stores string IDs. All existing IDs are preserved. New root nodes are simply new IDs. Old `tier` field is ignored on load. The `hidden` flag on `superconducting` (legacy) remains for save compat.

## UI Layout

### Full-screen overlay

```
┌─────────────────────────────────────────────────────────────┐
│  [X]  ◄ Beam Optics | RF | Vacuum | Cryo | Diag | ...  ►  │  ← fixed header with category tabs
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌───┐       ┌───┐    ┌───┐                               │
│   │ A │───────│ B │    │ C │    ...                         │
│   └───┘       └─┬─┘    └───┘                               │
│                 │                                            │
│              ┌──┴──┐                                         │  ← pannable/zoomable canvas
│              │  D  │                                         │
│              └─────┘                                         │
│                                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Dimensions

- Canvas: large virtual area (e.g., 3000x2000px), containing all 8 columns
- Each column: ~300px wide, separated by 50px gutters
- Nodes: 160x70px cards
- Vertical spacing between nodes: 40px
- Connector lines: 2px, colored by category

### Pan & Zoom

- **Click-drag on background**: pans the canvas (CSS `transform: translate()`)
- **Scroll wheel**: zooms in/out (CSS `transform: scale()`, clamped 0.5x–1.5x)
- **Category tab click**: smoothly scrolls to center that column
- **Touch support**: pinch-to-zoom, drag-to-pan (stretch goal)

### Research confirmation

Clicking an available node shows a small popover anchored to the node:

```
┌──────────────────────────┐
│  CW RF Systems           │
│  Continuous-wave RF power │
│                          │
│  Unlocks: CW Klystron,  │
│           IOT            │
│                          │
│  Cost: 25 data, $3,000  │
│  Duration: 60s           │
│                          │
│  [ Research ]  [ Cancel ] │
└──────────────────────────┘
```

### Active research indicator

When research is in progress, the node shows a progress bar filling left-to-right. A small fixed indicator in the overlay header also shows current research name + progress percentage, so you can see it regardless of pan position.

## Rendering Approach

**DOM-based with CSS transforms.** Each node is a `<div>` positioned absolutely within a container `<div>`. Connector lines are drawn with SVG overlaid on the same container. Pan/zoom applies `transform: translate(x, y) scale(z)` to the container.

### Layout algorithm

Each category tree is laid out independently:

1. Find root nodes (no `requires` within this category)
2. Build adjacency from `requires` fields
3. Assign depth (y-position) by longest path from root
4. Assign horizontal offset within the column to avoid overlaps (simple left-to-right assignment at each depth level)
5. Position: `x = columnStart + horizontalOffset * nodeSpacing`, `y = depth * verticalSpacing`

### Connector drawing

For each node with a `requires` field pointing to a parent in the same category, draw an SVG path from parent's bottom-center to child's top-center. Use simple straight lines or single-bend paths (vertical down from parent, horizontal to align, vertical down to child).

## Files to Change

| File | Changes |
|------|---------|
| `data.js` | Add `RESEARCH_CATEGORIES`, add `category` field to all RESEARCH items, add new root nodes, remove `tier` fields, rewire cross-trunk prerequisites |
| `renderer.js` | Replace `_renderResearchOverlay()` with full tech-tree renderer, add pan/zoom handlers, add connector SVG drawing, add category tab navigation |
| `index.html` | Replace `#research-overlay` content with new structure (canvas container, category header bar, SVG layer) |
| `style.css` | New styles for tech-tree overlay, node cards, state classes, connectors, animations, popover |
| `game.js` | No logic changes needed — `isResearchAvailable`, `startResearch`, `getEffect` all work as-is since they operate on the same `requires`/`completedResearch` model |

## Out of Scope

- Per-component upgrades (buying upgrades directly on placed components)
- Cross-trunk prerequisites (each tree is independent)
- Minimap for the tech tree canvas
- Undo/respec of completed research
- Touch gesture support (stretch goal for later)
