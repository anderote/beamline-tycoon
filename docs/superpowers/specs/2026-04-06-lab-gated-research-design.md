# Lab-Gated Research System Design

Research trees are gated by lab investment. Players can always start research in any unlocked tree, but without the corresponding lab built out, research is significantly slower. Endgame research nodes require a minimum lab tier as a hard gate.

## Lab-to-Research-Tree Mapping

Six labs cover eight research trees. Three labs serve double duty.

| Lab | Research Trees | Notes |
|-----|---------------|-------|
| RF Lab | RF Systems | Existing lab, unchanged |
| Cooling Lab | Cryogenics | Existing lab, unchanged |
| Vacuum Lab | Vacuum | Existing lab, unchanged |
| Machine Shop | Machine Types | Existing zone, moved from concrete to lab floor, gains new furnishings |
| Optics Lab *(new)* | Beam Optics, Photon Science | Both involve beam manipulation and light |
| Diagnostics Lab *(new)* | Diagnostics, Data & Computing | Diagnostics hardware feeds into data systems |

## Research Tier Calculation

A lab's research tier is the minimum of its zone tile tier and its furnishing tier:

```
researchTier = min(zoneTileTier, furnishingTier)
```

### Zone Tile Tier (existing system, unchanged)

| Tiles | Tier |
|-------|------|
| 0-3 | 0 |
| 4-7 | 1 |
| 8-15 | 2 |
| 16+ | 3 |

### Furnishing Tier

| Furnishings Placed | Tier |
|---------------------|------|
| 0 | 0 |
| 1-2 | 1 |
| 3-4 | 2 |
| 5+ | 3 |

To reach research tier 3, a lab needs at least 16 tiles AND at least 5 furnishings. A big empty lab or a tiny packed one both cap out lower.

## Speed Multiplier Table

The multiplier is applied to research duration (higher = slower). Node depth is the position in the prerequisite chain (root node = depth 1).

| Node Depth | No Lab (T0) | Tier 1 | Tier 2 | Tier 3 |
|------------|-------------|--------|--------|--------|
| Early (1-2) | 4x | 2x | 1.5x | 1x |
| Mid (3-4) | 4x | 2.5x | 1.5x | 1x |
| Late (5+) | **Blocked** | 3x | 2x | 1x |
| Final (last node in tree) | **Blocked** | **Blocked** | 2.5x | 1x |

- Existing research durations represent the tier 3 (1x) baseline.
- "Blocked" means the player cannot start the research at all. The UI should show what lab tier is required.
- Tier 3 always gives normal speed.

## New Lab Definitions

### Machine Shop (existing zone, upgraded)

- Change `requiredFloor` from `'concrete'` to `'labFloor'`
- Keep existing furnishings: lathe, milling machine, drill press, tool cabinet
- Add new furnishings: welding station, CNC mill, assembly crane
- Total: 7 furnishings

### Optics Lab (new zone)

Furnishings (5):
- Optical table
- Laser alignment system
- Mirror mount station
- Beam profiler
- Interferometer

### Diagnostics Lab (new zone)

Furnishings (5):
- Scope station
- Wire scanner bench
- BPM test fixture
- DAQ rack
- Server cluster

## Research Node Changes

Each research node gets a `labType` field indicating which lab affects its speed:

```javascript
{
  // existing fields...
  labType: 'rfLab',  // which lab's research tier governs this node
}
```

The `labType` is uniform per research category:

| Research Category | labType |
|-------------------|---------|
| beamOptics | opticsLab |
| rf | rfLab |
| vacuum | vacuumLab |
| cryo | coolingLab |
| diagnostics | diagnosticsLab |
| photonScience | opticsLab |
| data | diagnosticsLab |
| machineTypes | machineShop |

Node depth is computed at runtime by walking the prerequisite graph. No hardcoded depth field needed.

## Integration Points

### startResearch(id) in game.js

Before starting research, check hard gates:

1. Compute node depth from prerequisite chain.
2. Look up the lab's research tier via the `labType` mapping.
3. If the node is late-tier (depth 5+) and lab research tier is 0, block with message: "Requires [Lab Name] (Tier 1+) to begin."
4. If the node is the final node in its tree and lab research tier < 2, block with message: "Requires [Lab Name] (Tier 2+) to begin."
5. Otherwise, allow research to start.

### Per-tick research progress in game.js

Current formula: `progress += 1 * (1 + scientists * 0.05)`

New formula: `progress += (1 / speedMultiplier) * (1 + scientists * 0.05)`

Where `speedMultiplier` is looked up from the speed multiplier table using the node's depth and the corresponding lab's research tier.

### UI changes

- Research panel should display the current speed multiplier for each available node.
- Blocked nodes should show the lab tier requirement and which lab to build/upgrade.
- Lab info panel should show its current research tier and what it enables.

## Data Definitions

### New zone entries in ZONES

```javascript
opticsLab:      { id: 'opticsLab',      name: 'Optics Lab',      requiredFloor: 'labFloor', gatesCategory: null, subsection: 'laboratories' },
diagnosticsLab: { id: 'diagnosticsLab', name: 'Diagnostics Lab', requiredFloor: 'labFloor', gatesCategory: null, subsection: 'laboratories' },
// gatesCategory is null for both — they don't gate facility equipment placement, only research speed.
```

### Machine Shop zone change

```javascript
machineShop: { id: 'machineShop', name: 'Machine Shop', requiredFloor: 'labFloor', gatesCategory: 'beamline', subsection: 'industrial' },
```

### New furnishing entries in ZONE_FURNISHINGS

```javascript
// Machine Shop additions
weldingStation:   { id: 'weldingStation',   name: 'Welding Station',      zoneType: 'machineShop',    cost: 200, spriteColor: 0xcc7744 },
cncMill:          { id: 'cncMill',          name: 'CNC Mill',             zoneType: 'machineShop',    cost: 350, spriteColor: 0x998877 },
assemblyCrane:    { id: 'assemblyCrane',    name: 'Assembly Crane',       zoneType: 'machineShop',    cost: 400, spriteColor: 0xddaa44 },

// Optics Lab
opticalTable:     { id: 'opticalTable',     name: 'Optical Table',        zoneType: 'opticsLab',      cost: 250, spriteColor: 0x44aacc },
laserAlignment:   { id: 'laserAlignment',   name: 'Laser Alignment System', zoneType: 'opticsLab',   cost: 400, spriteColor: 0xcc4444 },
mirrorMount:      { id: 'mirrorMount',      name: 'Mirror Mount Station', zoneType: 'opticsLab',      cost: 150, spriteColor: 0xaaaacc },
beamProfiler:     { id: 'beamProfiler',     name: 'Beam Profiler',        zoneType: 'opticsLab',      cost: 300, spriteColor: 0x44cc88 },
interferometer:   { id: 'interferometer',   name: 'Interferometer',       zoneType: 'opticsLab',      cost: 500, spriteColor: 0x8844cc },

// Diagnostics Lab
scopeStation:     { id: 'scopeStation',     name: 'Scope Station',        zoneType: 'diagnosticsLab', cost: 100, spriteColor: 0x44aa44 },
wireScannerBench: { id: 'wireScannerBench', name: 'Wire Scanner Bench',   zoneType: 'diagnosticsLab', cost: 200, spriteColor: 0x888888 },
bpmTestFixture:   { id: 'bpmTestFixture',   name: 'BPM Test Fixture',     zoneType: 'diagnosticsLab', cost: 300, spriteColor: 0xcccc44 },
daqRack:          { id: 'daqRack',          name: 'DAQ Rack',             zoneType: 'diagnosticsLab', cost: 250, spriteColor: 0x44cc44 },
serverCluster:    { id: 'serverCluster',    name: 'Server Cluster',       zoneType: 'diagnosticsLab', cost: 500, spriteColor: 0x448844 },
```

### Category-to-labType mapping constant

```javascript
const RESEARCH_LAB_MAP = {
  beamOptics:    'opticsLab',
  rf:            'rfLab',
  vacuum:        'vacuumLab',
  cryo:          'coolingLab',
  diagnostics:   'diagnosticsLab',
  photonScience: 'opticsLab',
  data:          'diagnosticsLab',
  machineTypes:  'machineShop',
};
```

### Speed multiplier lookup constant

```javascript
const RESEARCH_SPEED_TABLE = {
  //            T0    T1    T2    T3
  early:     [ 4.0,  2.0,  1.5,  1.0 ],  // depth 1-2
  mid:       [ 4.0,  2.5,  1.5,  1.0 ],  // depth 3-4
  late:      [ null, 3.0,  2.0,  1.0 ],  // depth 5+  (null = blocked)
  final:     [ null, null, 2.5,  1.0 ],  // last node (null = blocked)
};
```

### Node depth computation

```javascript
function computeNodeDepth(researchId) {
  const node = RESEARCH[researchId];
  if (!node.requires) return 1;
  const reqs = Array.isArray(node.requires) ? node.requires : [node.requires];
  return 1 + Math.max(...reqs.map(computeNodeDepth));
}
```

### Determining if a node is "final"

A node is "final" if no other node in the same category lists it as a prerequisite. Computed once at startup.
