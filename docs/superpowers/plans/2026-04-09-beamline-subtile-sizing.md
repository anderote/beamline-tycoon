# Beamline Component Sub-tile Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the whole-tile `trackLength`/`trackWidth`/`length` system with sub-unit dimensions (`subL`/`subW`) for beamline components, where 1 sub-unit = 50cm, and physics length derives directly from visual size.

**Architecture:** Add `subL`/`subW` to every component definition, remove `trackLength`/`trackWidth`/`length`. Update Beamline.js tile calculation to work in sub-units. Update physics bridge (gameplay.py) to derive length from `subL * 0.5`. Update all renderers and UI that reference the old fields. Update lattice.py to sample at 1000 fixed points. Update asset pipeline for sub-unit sprite dimensions.

**Tech Stack:** Vanilla JS (ES modules), Python (beam physics), PIXI.js

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/data/components.js` | Modify | Replace `trackLength`/`trackWidth`/`length` with `subL`/`subW` on all 109 components |
| `src/data/units.js` | Modify | Replace `trackLength`/`trackWidth` unit labels with `subL`/`subW` |
| `src/beamline/Beamline.js` | Modify | Update `_calcTiles` to compute tile occupancy from `subL`/`subW` |
| `beam_physics/gameplay.py` | Modify | Derive physics length from `subL * 0.5` instead of `length * LENGTH_SCALE` |
| `beam_physics/lattice.py` | Modify | Add 1000-point fixed sampling mode |
| `src/renderer/beamline-renderer.js` | Modify | Use `subL`/`subW` for sprite sizing and cursor markers |
| `src/renderer/designer-renderer.js` | Modify | Replace `comp.length` references with `subL`-derived length |
| `src/ui/BeamlineDesigner.js` | Modify | Replace `comp.length * LENGTH_SCALE` with `comp.subL * 0.5` |
| `src/ui/DesignPlacer.js` | Modify | Replace `trackLength`/`trackWidth` with `subL`/`subW` |
| `src/input/InputHandler.js` | Modify | Update tooltip `comp.length` reference |
| `src/renderer/hud.js` | Modify | Update stats display `comp.length` reference |
| `src/renderer/overlays.js` | Modify | Update overlay `comp.length` reference |
| `tools/asset-gen/server.cjs` | Modify | Compute sprite pixel dimensions from `subL`/`subW` |

---

### Task 1: Add `subL` and `subW` to all components

**Files:**
- Modify: `src/data/components.js`

- [ ] **Step 1: Add `subL` and `subW` to every component**

For each of the 109 components, add `subL` and `subW` fields based on the sizing table in the spec. The general rule: `subL = physicalLengthInMeters / 0.5`. For width, beam pipe elements are 2, magnets are 2-3, RF structures are 3-4, large machines are 4-6, source is 4.

Conversion from current `length` field: `subL = length * 2` (since current `length` is in tile units at 2m/tile, and we want sub-units at 0.5m each; `length * 2m / 0.5m = length * 4`). Wait — actually current `length` is in "game units" where 1 = 1 tile = 2m when multiplied by LENGTH_SCALE. So a drift with `length: 5` = 5 tiles = 10m = 20 sub-units. But that's too long — the spec says drift should be `subL: 4` (2m). The `length` field was not tile count; it was a scaling factor used differently per component.

Actually, looking at the data: `drift` has `length: 5, trackLength: 1`. The physics uses `length * LENGTH_SCALE = 5 * 2 = 10m`. But `trackLength: 1` means it occupies 1 tile visually. The spec unifies these: `subL: 4` means 2m physical AND 4 sub-units visual. So we're choosing the visual size to match real physics lengths.

Here are the `subL` and `subW` values for ALL components. Apply these by replacing the `length`, `trackLength`, and `trackWidth` fields on each component. **Do not remove these fields yet** — that happens in Task 2 after all references are updated.

**Source category:**
```
source:            subL: 4,  subW: 4    // 2m source, full tile wide
dcPhotoGun:        subL: 4,  subW: 4
ncRfGun:           subL: 4,  subW: 4
srfGun:            subL: 6,  subW: 4    // 3m, larger gun
drift:             subL: 4,  subW: 2    // 2m beam pipe
driftVert:         subL: 4,  subW: 2
bellows:           subL: 1,  subW: 2    // 0.5m flex joint
```

**Focusing category:**
```
dipole:            subL: 6,  subW: 3    // 3m bending magnet
quadrupole:        subL: 2,  subW: 2    // 1m quad
solenoid:          subL: 3,  subW: 3    // 1.5m solenoid
corrector:         subL: 1,  subW: 2    // 0.5m corrector
sextupole:         subL: 2,  subW: 2    // 1m sextupole
octupole:          subL: 2,  subW: 2    // 1m octupole
scQuad:            subL: 2,  subW: 3    // 1m SC quad (wider cryostat)
scDipole:          subL: 8,  subW: 4    // 4m SC dipole
combinedFunctionMagnet: subL: 3, subW: 3  // 1.5m
```

**RF / Acceleration category:**
```
rfCavity:          subL: 6,  subW: 4    // 3m normal conducting
cryomodule:        subL: 16, subW: 6    // 8m, wide cryostat
buncher:           subL: 2,  subW: 3    // 1m buncher
harmonicLinearizer: subL: 4, subW: 3    // 2m
cbandCavity:       subL: 4,  subW: 3    // 2m C-band
xbandCavity:       subL: 4,  subW: 3    // 2m X-band
srf650Cavity:      subL: 8,  subW: 4    // 4m SRF
```

**Diagnostics category (all narrow, short):**
```
bpm:               subL: 1,  subW: 2    // 0.5m
screen:            subL: 1,  subW: 2
ict:               subL: 1,  subW: 2
wireScanner:       subL: 1,  subW: 2
bunchLengthMonitor: subL: 1, subW: 2
energySpectrometer: subL: 4, subW: 3    // 2m, wider
beamLossMonitor:   subL: 1,  subW: 2
srLightMonitor:    subL: 1,  subW: 2
```

**Insertion devices:**
```
undulator:         subL: 10, subW: 3    // 5m
helicalUndulator:  subL: 10, subW: 3
wiggler:           subL: 10, subW: 3
apple2Undulator:   subL: 10, subW: 3
```

**Beam manipulation:**
```
collimator:        subL: 2,  subW: 2    // 1m
kickerMagnet:      subL: 2,  subW: 2
septumMagnet:      subL: 2,  subW: 2
chicane:           subL: 8,  subW: 3    // 4m
dogleg:            subL: 6,  subW: 3    // 3m
stripperFoil:      subL: 1,  subW: 2    // 0.5m
```

**Targets & endpoints:**
```
target:            subL: 4,  subW: 3    // 2m
fixedTargetAdv:    subL: 6,  subW: 4    // 3m
detector:          subL: 12, subW: 6    // 6m, very wide
photonPort:        subL: 4,  subW: 3    // 2m
positronTarget:    subL: 6,  subW: 4    // 3m
comptonIP:         subL: 6,  subW: 4    // 3m
splitter:          subL: 4,  subW: 3    // 2m
beamDump:          subL: 4,  subW: 3    // 2m
```

For any remaining components not listed above (proton-specific magnets, synchrotron components, etc.), follow these rules:
- Diagnostics: `subL: 1, subW: 2`
- Small magnets: `subL: 2, subW: 2`
- Medium magnets/cavities: `subL: 4-6, subW: 3`
- Large structures: `subL: 8-16, subW: 4-6`
- Sources: `subL: 4, subW: 4`

Read through ALL components in the file and add `subL`/`subW` to every one. Keep the old `length`, `trackLength`, `trackWidth` fields for now.

- [ ] **Step 2: Verify no syntax errors**

Open the game in the browser, check console for errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/components.js
git commit -m "feat: add subL/subW to all beamline components"
```

---

### Task 2: Update Beamline.js tile calculation

**Files:**
- Modify: `src/beamline/Beamline.js`

- [ ] **Step 1: Update `_calcTiles` to use `subL`/`subW`**

The current `_calcTiles(col, row, dir, trackLength, trackWidth)` computes tiles from tile counts. Replace it to compute tiles from sub-unit counts. A component with `subL: 12` starting at sub-unit offset 2 within a tile spans 3 tiles. A component with `subW: 6` (3m) centered on beam needs 2 tile rows (tiles are 4 sub-units = 2m wide).

```js
_calcTiles(col, row, dir, subL, subW) {
  const tiles = [];
  const delta = DIR_DELTA[dir];
  
  // How many tiles does this component span along beam?
  // subL sub-units / 4 sub-units per tile, ceiling
  const tilesAlong = Math.ceil(subL / 4);
  
  // How many tile rows perpendicular to beam?
  // subW sub-units / 4 sub-units per tile, ceiling, centered
  const tilesAcross = Math.ceil(subW / 4);
  
  const perpDir = turnLeft(dir);
  const perpDelta = DIR_DELTA[perpDir];
  
  const widthOffsets = [];
  for (let j = 0; j < tilesAcross; j++) {
    widthOffsets.push(j - (tilesAcross - 1) / 2);
  }
  
  for (let i = 0; i < tilesAlong; i++) {
    for (const wOff of widthOffsets) {
      tiles.push({
        col: col + delta.dc * i + perpDelta.dc * wOff,
        row: row + delta.dr * i + perpDelta.dr * wOff,
      });
    }
  }
  return tiles;
}
```

- [ ] **Step 2: Update `placeSource` call**

Change line ~67:
```js
// Old:
const tiles = this._calcTiles(col, row, dir, comp.trackLength, comp.trackWidth);
// New:
const tiles = this._calcTiles(col, row, dir, comp.subL || 4, comp.subW || 4);
```

- [ ] **Step 3: Update `placeAt` call**

Change line ~112:
```js
// Old:
const tiles = this._calcTiles(col, row, exitDir, comp.trackLength, comp.trackWidth);
// New:
const tiles = this._calcTiles(col, row, exitDir, comp.subL || 4, comp.subW || 2);
```

- [ ] **Step 4: Verify placement still works**

Open the game, try placing a source and a few components. They should occupy the correct number of tiles.

- [ ] **Step 5: Commit**

```bash
git add src/beamline/Beamline.js
git commit -m "feat: Beamline tile calc uses subL/subW"
```

---

### Task 3: Update physics bridge (gameplay.py)

**Files:**
- Modify: `beam_physics/gameplay.py`

- [ ] **Step 1: Update `beamline_config_from_game` to derive length from `subL`**

Find line ~153:
```python
# Old:
el["length"] = comp.get("length", defaults.get("length", 1.0)) * LENGTH_SCALE
```

Replace with:
```python
# New: subL sub-units × 0.5m per sub-unit
sub_l = comp.get("subL", None)
if sub_l is not None:
    el["length"] = sub_l * 0.5
else:
    # Fallback for components not yet migrated
    el["length"] = comp.get("length", defaults.get("length", 1.0)) * LENGTH_SCALE
```

- [ ] **Step 2: Update COMPONENT_DEFAULTS lengths to match new subL values**

The defaults table is used as fallback. Update each entry's `"length"` to match the new physics length (`subL * 0.5`):

```python
COMPONENT_DEFAULTS = {
    # === Electron Sources ===
    "source":       {"length": 2.0},           # subL: 4
    "dcPhotoGun":   {"length": 2.0, "emittance": 1e-6},
    "ncRfGun":      {"length": 2.0, "emittance": 0.5e-6},
    "srfGun":       {"length": 3.0, "emittance": 0.3e-6},  # subL: 6
    # === Beam Pipe ===
    "drift":        {"length": 2.0},           # subL: 4
    "driftVert":    {"length": 2.0},
    "bellows":      {"length": 0.5},           # subL: 1
    # === RF Cavities ===
    "rfCavity":     {"length": 3.0, "energyGain": 0.5},    # subL: 6
    "cryomodule":   {"length": 8.0, "energyGain": 2.0},    # subL: 16
    "buncher":      {"length": 1.0, "energyGain": 0.05},   # subL: 2
    "harmonicLinearizer": {"length": 2.0, "energyGain": 0.02},
    "cbandCavity":  {"length": 2.0, "energyGain": 0.8},
    "xbandCavity":  {"length": 2.0, "energyGain": 1.2},
    "srf650Cavity": {"length": 4.0, "energyGain": 1.5},    # subL: 8
    # === Magnets ===
    "dipole":       {"length": 3.0, "bendAngle": 90.0},    # subL: 6
    "quadrupole":   {"length": 1.0, "focusStrength": 1.0}, # subL: 2
    "solenoid":     {"length": 1.5, "field": 0.2},         # subL: 3
    "corrector":    {"length": 0.5},                        # subL: 1
    "sextupole":    {"length": 1.0, "focusStrength": 0.5, "beamQuality": 0.3},
    "octupole":     {"length": 1.0},
    "scQuad":       {"length": 1.0, "focusStrength": 2.0},
    "scDipole":     {"length": 4.0, "bendAngle": 90.0},    # subL: 8
    "combinedFunctionMagnet": {"length": 1.5, "focusStrength": 0.5, "bendAngle": 45.0},
    # === Diagnostics ===
    "bpm":          {"length": 0.5},           # subL: 1
    "screen":       {"length": 0.5},
    "ict":          {"length": 0.5},
    "wireScanner":  {"length": 0.5},
    "bunchLengthMonitor": {"length": 0.5},
    "energySpectrometer": {"length": 2.0},     # subL: 4
    "beamLossMonitor": {"length": 0.5},
    "srLightMonitor": {"length": 0.5},
    # === Insertion Devices ===
    "undulator":    {"length": 5.0, "photonRate": 1.0},    # subL: 10
    "helicalUndulator": {"length": 5.0, "photonRate": 1.2},
    "wiggler":      {"length": 5.0, "photonRate": 2.0},
    "apple2Undulator": {"length": 5.0, "photonRate": 1.5},
    # === Beam Manipulation ===
    "collimator":   {"length": 1.0, "beamQuality": 0.2},
    "kickerMagnet": {"length": 1.0},
    "septumMagnet": {"length": 1.0},
    "chicane":      {"length": 4.0, "r56": -0.05},
    "dogleg":       {"length": 3.0},
    "stripperFoil": {"length": 0.5},
    # === Targets & Endpoints ===
    "detector":     {"length": 6.0, "dataRate": 1.0},
    "target":       {"length": 2.0, "collisionRate": 2.0},
    "fixedTargetAdv": {"length": 3.0, "collisionRate": 5.0},
    "photonPort":   {"length": 2.0, "photonRate": 0.5},
    "positronTarget": {"length": 3.0, "collisionRate": 3.0},
    "comptonIP":    {"length": 3.0, "photonRate": 1.0},
    "splitter":     {"length": 2.0},
    # === Infrastructure ===
    "beamDump":     {"length": 2.0},
}
```

- [ ] **Step 3: Commit**

```bash
git add beam_physics/gameplay.py
git commit -m "feat: physics bridge derives length from subL"
```

---

### Task 4: Update beamline renderer

**Files:**
- Modify: `src/renderer/beamline-renderer.js`

- [ ] **Step 1: Update cursor marker tile calculation**

Find the two locations where `trackLength` and `trackWidth` are read (lines ~250 and ~439). Replace both with:

```js
// Old:
const trackLength = comp ? (comp.trackLength || 1) : 1;
const trackWidth = comp ? (comp.trackWidth || 1) : 1;

// New:
const trackLength = comp ? Math.ceil((comp.subL || 4) / 4) : 1;
const trackWidth = comp ? Math.ceil((comp.subW || 2) / 4) : 1;
```

This converts sub-units to tile counts for the cursor marker (which draws per-tile diamonds). The cursor still uses tile-level rendering for now.

- [ ] **Step 2: Verify cursor markers show correct size**

Open the game. Select a source (should show 1×1 tile cursor). Select a cryomodule (should show 4×2 tile cursor). Select a BPM (should show 1×1).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/beamline-renderer.js
git commit -m "feat: beamline cursor uses subL/subW for tile counts"
```

---

### Task 5: Update designer and UI references

**Files:**
- Modify: `src/ui/BeamlineDesigner.js`
- Modify: `src/renderer/designer-renderer.js`
- Modify: `src/ui/DesignPlacer.js`
- Modify: `src/input/InputHandler.js`
- Modify: `src/renderer/hud.js`
- Modify: `src/renderer/overlays.js`
- Modify: `src/data/units.js`

- [ ] **Step 1: Update BeamlineDesigner.js**

Replace all `comp.length * LENGTH_SCALE` with `comp.subL * 0.5` (or `(comp.subL || 4) * 0.5` for safety).

Find `const LENGTH_SCALE = 2.0;` (line 11) — keep it for now but add a comment that it's deprecated.

Line ~1271:
```js
// Old:
if (comp) this.totalLength += comp.length * LENGTH_SCALE;
// New:
if (comp) this.totalLength += (comp.subL || 4) * 0.5;
```

Line ~1321:
```js
// Old:
length: comp.length,
// New:
subL: comp.subL || 4,
```

Line ~1379:
```js
// Old:
const compLen = (comp ? comp.length : 1) * LENGTH_SCALE;
// New:
const compLen = (comp ? (comp.subL || 4) : 4) * 0.5;
```

Line ~1416:
```js
// Old:
accS += (comp ? comp.length : 1) * LENGTH_SCALE;
// New:
accS += (comp ? (comp.subL || 4) : 4) * 0.5;
```

- [ ] **Step 2: Update designer-renderer.js**

Replace all `comp.length` references (lines ~53, ~78, ~232, ~295, ~454, ~900).

For schematic width calculation (lines ~53, ~78, ~232, ~295) — these control the visual width of blocks in the schematic view. The spec says schematic stays equal-width, so keep using a fixed width:
```js
// Old:
const len = comp ? comp.length : 1;
// New: schematic view uses fixed width per component, not proportional
const len = 1;
```

For the stats display (line ~454):
```js
// Old:
statsHtml += `...${(comp.length * LENGTH_SCALE).toFixed(1)} <span class="ts-unit">m</span>...`;
// New:
statsHtml += `...${((comp.subL || 4) * 0.5).toFixed(1)} <span class="ts-unit">m</span>...`;
```

For the cost line (line ~900):
```js
// Old:
cost.textContent = `${costs}  ·  ${comp.energyCost}kW  ·  ${comp.length}m`;
// New:
cost.textContent = `${costs}  ·  ${comp.energyCost}kW  ·  ${((comp.subL || 4) * 0.5).toFixed(1)}m`;
```

- [ ] **Step 3: Update DesignPlacer.js**

Find `trackLength` references (lines ~88, ~89, ~194). Replace:
```js
// Old:
const trackLen = comp.trackLength || 1;
const trackW = comp.trackWidth || 1;
// New:
const trackLen = Math.ceil((comp.subL || 4) / 4);
const trackW = Math.ceil((comp.subW || 2) / 4);
```

- [ ] **Step 4: Update InputHandler.js tooltip**

Line ~1850:
```js
// Old:
['Length', `${comp.length} m`],
// New:
['Length', `${((comp.subL || 4) * 0.5).toFixed(1)} m`],
```

- [ ] **Step 5: Update hud.js stats**

Line ~1165:
```js
// Old:
html += statRow('Length', `${comp.length} m`);
// New:
html += statRow('Length', `${((comp.subL || 4) * 0.5).toFixed(1)} m`);
```

- [ ] **Step 6: Update overlays.js**

Line ~56:
```js
// Old:
html += row('Length', comp.length, 'm');
// New:
html += row('Length', ((comp.subL || 4) * 0.5).toFixed(1), 'm');
```

- [ ] **Step 7: Update units.js**

Lines ~26-27:
```js
// Old:
trackLength:     'tiles',
trackWidth:      'tiles',
// New:
subL:            'sub-units',
subW:            'sub-units',
```

- [ ] **Step 8: Update `_recalcDraft` physics bridge call**

In BeamlineDesigner.js line ~1321, the physics element is built. Update it:
```js
// Old:
const el = {
  type: node.type,
  length: comp.length,
  stats: effectiveStats,
  params: node.params || {},
};

// New:
const el = {
  type: node.type,
  subL: comp.subL || 4,
  stats: effectiveStats,
  params: node.params || {},
};
```

- [ ] **Step 9: Verify designer works**

Open the game, open the beamline designer. Verify:
- Component stats show correct lengths in meters
- Schematic view renders components (equal width blocks)
- Envelope plot x-axis shows reasonable meter values

- [ ] **Step 10: Commit**

```bash
git add src/ui/BeamlineDesigner.js src/renderer/designer-renderer.js src/ui/DesignPlacer.js src/input/InputHandler.js src/renderer/hud.js src/renderer/overlays.js src/data/units.js
git commit -m "feat: all UI/renderer references use subL/subW"
```

---

### Task 6: Update Game.js beamline recalc

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Update `_recalcSingleBeamline` total length calculation**

Find line ~1606:
```js
// Old:
tLen += t.length;
// New:
tLen += (t.subL || 4) * 0.5;
```

- [ ] **Step 2: Update physics beamline element**

Find line ~1633:
```js
// Old:
length: t.length,
// New:
subL: t.subL || 4,
```

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: Game.js recalc uses subL for length"
```

---

### Task 7: Update DesignLibrary.js

**Files:**
- Modify: `src/ui/DesignLibrary.js`

- [ ] **Step 1: Update total length calculation**

Find line ~122:
```js
// Old:
return sum + (comp ? comp.length : 0);
// New:
return sum + (comp ? (comp.subL || 4) * 0.5 : 0);
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/DesignLibrary.js
git commit -m "feat: DesignLibrary uses subL for length calc"
```

---

### Task 8: Remove old fields from components

**Files:**
- Modify: `src/data/components.js`

- [ ] **Step 1: Remove `length`, `trackLength`, `trackWidth` from all components**

Search and remove all three fields from every component entry. The `subL` and `subW` fields added in Task 1 are now the sole size definition.

- [ ] **Step 2: Verify no remaining references**

```bash
grep -rn "trackLength\|trackWidth\|comp\.length" src/ | grep -v node_modules | grep -v ".pyc"
```

Expected: zero matches (or only comments). If any remain, update them.

- [ ] **Step 3: Remove LENGTH_SCALE from designer files**

In `src/ui/BeamlineDesigner.js` and `src/renderer/designer-renderer.js`, remove the `const LENGTH_SCALE = 2.0;` lines and their comments. They should no longer be referenced.

- [ ] **Step 4: Verify the game runs end-to-end**

Open the game:
1. Place a source + components, verify tile occupancy
2. Open designer, verify envelope plots
3. Check component stats in tooltips show correct meter lengths

- [ ] **Step 5: Commit**

```bash
git add src/data/components.js src/ui/BeamlineDesigner.js src/renderer/designer-renderer.js
git commit -m "chore: remove deprecated length/trackLength/trackWidth fields"
```

---

### Task 9: Update asset-gen pipeline

**Files:**
- Modify: `tools/asset-gen/server.cjs`

- [ ] **Step 1: Update component catalog parsing**

Find the component parsing section in `buildCatalog()` (around line 50-75). Add `subL` and `subW` extraction alongside the existing fields:

```js
const subLRe = /subL:\s*(\d+)/;
const subWRe = /subW:\s*(\d+)/;
```

In the per-component block parsing:
```js
const subL = parseInt((block.match(subLRe) || [])[1]) || 4;
const subW = parseInt((block.match(subWRe) || [])[1]) || 2;
const TILE_W = 64;
const TILE_H = 32;
const floorW = (TILE_W / 4) * subL;
const floorH = (TILE_H / 4) * subW;
const heightAllowance = 16;
```

Add to the catalog entry:
```js
catalog.components[spriteKey] = {
  spriteKey, name, category, color, ids: [id],
  subL, subW,
  spritePixelW: Math.max(floorW, 16),
  spritePixelH: floorH + heightAllowance,
};
```

- [ ] **Step 2: Commit**

```bash
git add tools/asset-gen/server.cjs
git commit -m "feat: asset-gen computes component sprite sizes from subL/subW"
```

---

### Task 10: Add 1000-point fixed sampling to physics

**Files:**
- Modify: `beam_physics/lattice.py`

- [ ] **Step 1: Add fixed-point sampling option**

Add a `SAMPLE_POINTS = 1000` constant near the top of lattice.py (around line 17):

```python
SAMPLE_POINTS = 1000
```

In the `propagate` function, after the main propagation loop completes and before the return statement, add interpolation to produce exactly 1000 evenly-spaced snapshots:

```python
# Resample snapshots to fixed 1000-point grid
if context.snapshots and len(context.snapshots) > 1:
    total_s = context.snapshots[-1].get("s", 0)
    if total_s > 0:
        sample_positions = [i * total_s / (SAMPLE_POINTS - 1) for i in range(SAMPLE_POINTS)]
        resampled = []
        snap_idx = 0
        for target_s in sample_positions:
            # Advance snap_idx to bracket target_s
            while snap_idx < len(context.snapshots) - 1 and context.snapshots[snap_idx + 1].get("s", 0) <= target_s:
                snap_idx += 1
            resampled.append(context.snapshots[snap_idx])
        context.snapshots = resampled
```

This nearest-neighbor resampling gives 1000 evenly spaced points. The designer cursor indexes into this array.

- [ ] **Step 2: Commit**

```bash
git add beam_physics/lattice.py
git commit -m "feat: resample physics snapshots to 1000 fixed points"
```

---

### Task 11: Integration test and cleanup

- [ ] **Step 1: Full manual integration test**

1. **Placement:** Place source + drift + quad + drift + dipole. Verify tile occupancy matches expected `subL`/`subW` (source = 1 tile, drift = 1 tile, quad = 1 tile, dipole = 2 tiles wide if `subW: 3`).

2. **Designer:** Open beamline designer. Verify:
   - Schematic shows components as equal-width blocks
   - Envelope plot x-axis shows correct total length in meters
   - Cursor position maps to beam position
   - Stats show correct lengths (quad = 1.0m, drift = 2.0m, etc.)

3. **Physics:** Run a beamline. Verify beam state computes correctly — energy gain, focusing, etc. should work with the new lengths.

4. **Tooltips:** Hover over placed components on the map. Verify length shows in meters.

5. **Asset-gen:** Start asset-gen server, verify `/api/catalog` shows `subL`, `subW`, and correct `spritePixelW`/`spritePixelH` for components.

- [ ] **Step 2: Search for any remaining old field references**

```bash
grep -rn "trackLength\|trackWidth\|comp\.length\b\|LENGTH_SCALE" src/ beam_physics/ tools/ | grep -v node_modules | grep -v ".pyc" | grep -v __pycache__ | grep -v "\.md"
```

Fix any remaining references.

- [ ] **Step 3: Commit cleanup**

```bash
git add -A
git commit -m "chore: clean up remaining old field references"
```
