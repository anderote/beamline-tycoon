# Beamline Types — Design Spec

## Overview

Expand Beamline Tycoon from a single electron linac builder into a facility with multiple machine types, inspired by RollerCoaster Tycoon's ride categories. Players build custom linacs component-by-component, place self-contained ring accelerators like flat rides, and drop small "stall" machines for steady income. Each machine type generates different ratios of funding ($) and research data (D).

### Design Principles

- **RCT ride analogy:** Custom linacs = roller coasters (player designs layout). Ring machines = flat rides (place as unit, tune settings). Stall machines = food stalls (plop and earn).
- **Unified grid:** All machines share the same placement grid and occupancy system. No parallel placement logic.
- **Interior view for depth:** Ring machines open an overlay panel showing internals and upgrade slots when clicked. Not a second grid — a themed settings panel.
- **No UI changes in this spec:** All work is data layer (data.js) and game engine (game.js). The renderer consumes `state.machines` when ready.
- **Two outputs only:** Every machine produces some ratio of $ and research data. No other currencies.

---

## 1. Grid Expansion

Expand from 40x24 to **80x48** cells. `CELL_SIZE` remains 32px. The viewport pans/scrolls over the larger area.

Update in `data.js`:
```javascript
const GRID_COLS = 80;
const GRID_ROWS = 48;
```

---

## 2. Machine Categories

### 2.1 Custom Linacs (Component-by-Component)

Built using the existing beamline system. Player places individual sources, cavities, magnets, etc.

| Machine | Particle | Unlocked | Key Use |
|---------|----------|----------|---------|
| **Electron Linac** | e- (0.511 MeV) | Start | FEL, light source, user facility |
| **Proton Linac** | p+ (938 MeV) | Research: Proton Acceleration | Nuclear physics, spallation, therapy research |

The proton linac uses the same placement system but with proton-specific components added to COMPONENTS:

| Component | Category | Cost | Size | energyCost | Stats | Requires |
|-----------|----------|------|------|------------|-------|----------|
| `ionSource` | source | $300 | 2x2 | 8 | beamCurrent: 0.5 | protonAcceleration |
| `rfq` | rf | $800 | 3x1 | 15 | energyGain: 0.003 | protonAcceleration |
| `dtlCavity` | rf | $1200 | 4x1 | 20 | energyGain: 0.05 | protonAcceleration |
| `protonQuad` | magnet | $300 | 1x1 | 8 | focusStrength: 0.8 | protonAcceleration |
| `protonDipole` | dipole | $500 | 2x2 | 12 | bendAngle: 90 | protonAcceleration |

The physics engine already supports `PROTON_MASS` in constants.py. The ion source sets `particle_mass = 0.938` in the beam state. Proton magnets need higher fields for same bending (rigidity scales with mass), reflected in higher energyCost.

### 2.2 Ring Machines (Ploppable, Interior View)

Placed as a single large grid object. Clicking opens an interior overlay showing subsystems and upgrade slots. Each has an internal self-contained simulation — no beam propagation, just formulas.

| Machine | ID | Size | Cost | Unlock | Base $/tick | Base D/tick | Base E/tick |
|---------|-----|------|------|--------|-------------|-------------|-------------|
| Small Cyclotron | `smallCyclotron` | 5x5 | $2,000 | cyclotronTech | 3 | 0.5 | 10 |
| Large Cyclotron | `largeCyclotron` | 7x7 | $8,000 | isochronousCyclotron | 8 | 2 | 25 |
| Synchrotron Booster | `synchrotronBooster` | 6x6 | $12,000 | synchrotronTech | 15 | 5 | 35 |
| Storage Ring / Light Source | `storageRing` | 10x10 | $30,000 | storageRingTech | 25 | 10 | 50 |

### 2.3 Stall Machines (Simple Plop-and-Earn)

Small, cheap, simple upgrade panel. No interior schematic needed — just a settings popup.

| Machine | ID | Size | Cost | Unlock | Base $/tick | Base D/tick | Base E/tick |
|---------|-----|------|------|--------|-------------|-------------|-------------|
| Van de Graaff Generator | `vanDeGraaff` | 2x2 | $200 | Start | 0.5 | 0.2 | 2 |
| Cockcroft-Walton Generator | `cockcroftWalton` | 3x2 | $500 | Start | 1 | 0.5 | 4 |
| Tabletop Laser Plasma | `tabletopLaser` | 3x3 | $15,000 | plasmaAcceleration | 5 | 8 | 15 |

---

## 3. MACHINES Data Structure

New `MACHINES` constant in `data.js`, parallel to `COMPONENTS`:

```javascript
const MACHINES = {
  smallCyclotron: {
    id: 'smallCyclotron',
    name: 'Small Cyclotron',
    icon: '🌀',
    desc: 'A compact cyclotron for isotope production and basic research.',
    category: 'ring',
    cost: { funding: 2000 },
    w: 5, h: 5,
    baseFunding: 3,
    baseData: 0.5,
    energyCost: 10,
    requires: 'cyclotronTech',
    maxCount: null,
    canLink: false,  // can't accept injector
    operatingModes: ['isotopes', 'research'],
    modeMultipliers: {
      isotopes: { fundingMult: 1.5, dataMult: 0.5 },
      research: { fundingMult: 0.3, dataMult: 2.0 },
    },
    upgrades: {
      magneticField: {
        name: 'Magnetic Field',
        levels: [
          { label: '1.2 T / 12 MeV', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '1.5 T / 18 MeV', cost: { funding: 1500, data: 10 }, fundingMult: 1.4, dataMult: 1.3, energyMult: 1.3 },
          { label: '1.8 T / 25 MeV', cost: { funding: 4000, data: 30 }, fundingMult: 1.8, dataMult: 1.6, energyMult: 1.6 },
        ],
      },
      rfSystem: {
        name: 'RF System',
        levels: [
          { label: 'Single dee', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Dual dee, 2x current', cost: { funding: 1000, data: 8 }, fundingMult: 1.5, dataMult: 1.3, energyMult: 1.2 },
          { label: 'High-Q resonator', cost: { funding: 3000, data: 20 }, fundingMult: 2.0, dataMult: 1.5, energyMult: 1.4 },
        ],
      },
      extraction: {
        name: 'Extraction',
        levels: [
          { label: '40% efficiency', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '60% efficiency', cost: { funding: 800, data: 5 }, fundingMult: 1.5, dataMult: 1.2, energyMult: 1.0 },
          { label: '85% efficiency', cost: { funding: 2500, data: 15 }, fundingMult: 2.0, dataMult: 1.4, energyMult: 1.0 },
        ],
      },
      shielding: {
        name: 'Shielding',
        levels: [
          { label: 'Basic', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Improved', cost: { funding: 600, data: 5 }, fundingMult: 1.0, dataMult: 1.5, energyMult: 1.0 },
          { label: 'Full containment', cost: { funding: 2000, data: 12 }, fundingMult: 1.0, dataMult: 2.0, energyMult: 1.0 },
        ],
      },
    },
  },
  // ... (other machines follow same pattern, see Section 3.1-3.6 below)
};
```

### 3.1 Small Cyclotron

As shown above. Operating modes:
- **Isotopes:** fundingMult 1.5x, dataMult 0.5x
- **Research:** fundingMult 0.3x, dataMult 2.0x

### 3.2 Large Cyclotron

Same structure as small but larger multipliers, more upgrade levels, and can switch between 3 modes:
- **Isotopes:** fundingMult 1.5x, dataMult 0.5x
- **Research:** fundingMult 0.3x, dataMult 2.0x
- **Therapy Research:** fundingMult 1.0x, dataMult 1.0x (balanced, unlocks therapy-related objectives)

Upgrades: Sector Magnets (3 levels), RF System (3 levels), Ion Source (3 levels), Extraction Ports (3 levels — more ports = more simultaneous output).

### 3.3 Synchrotron Booster

Ring that accelerates particles to higher energies than a cyclotron. `canLink: true` — accepts injector from adjacent linac.

Upgrades: Dipole Field (3 levels — max energy), RF Voltage (3 levels — ramp rate / current), Injection System (3 levels — capture efficiency), Extraction Kickers (3 levels — extraction efficiency).

Operating modes:
- **Production:** fundingMult 1.0x, dataMult 1.0x
- **Machine Studies:** fundingMult 0.0x, dataMult 3.0x (offline for users, but generates lots of research)

### 3.4 Storage Ring / Light Source

The premium late-game machine. `canLink: true`. Highest reputation generation.

Upgrades: Lattice (3 levels — beam lifetime, emittance), Insertion Devices (3 levels — number of beamline ports, directly multiplies funding), Vacuum System (3 levels — beam lifetime), Top-up Injection (3 levels — stability, uptime).

Operating modes:
- **User Operations:** fundingMult 2.0x, dataMult 0.5x (premium beam hours)
- **Machine Studies:** fundingMult 0.0x, dataMult 3.0x

Reputation bonus: +0.01 per tick when active in User Operations mode (the prestige machine).

### 3.5 Van de Graaff Generator

Stall machine. 2 upgrades only:
- **Voltage:** 3 levels (1 MV, 3 MV, 5 MV)
- **Belt Material:** 3 levels (rubber, silk, pelletron chain)

No operating modes. Always produces both $ and data.

### 3.6 Cockcroft-Walton Generator

Stall machine. 2 upgrades only:
- **Stage Count:** 3 levels (2-stage, 4-stage, 8-stage)
- **Voltage:** 3 levels (200 kV, 500 kV, 1 MV)

No operating modes.

### 3.7 Tabletop Laser Plasma Accelerator

Late-game stall machine. 3 upgrades:
- **Laser Power:** 3 levels (10 TW, 100 TW, 1 PW)
- **Plasma Density:** 3 levels (low, medium, high)
- **Staging:** 3 levels (single, double, triple — multiplies energy reach)

No operating modes. High data output for its size, representing cutting-edge research.

---

## 4. Research Unlocks

New research projects added to RESEARCH in data.js:

| ID | Name | Tier | Cost | Duration | Unlocks | Requires |
|----|------|------|------|----------|---------|----------|
| `cyclotronTech` | Cyclotron Technology | 1 | 15D, $1K | 40s | smallCyclotron | — |
| `protonAcceleration` | Proton Acceleration | 2 | 25D, $3K | 60s | ionSource, rfq, dtlCavity, protonQuad, protonDipole | cyclotronTech |
| `isochronousCyclotron` | Isochronous Cyclotron | 3 | 40D, $8K, 5R | 80s | largeCyclotron | cyclotronTech |
| `synchrotronTech` | Synchrotron Technology | 3 | 50D, $10K, 5R | 90s | synchrotronBooster | srfTechnology |
| `storageRingTech` | Storage Ring Technology | 4 | 60D, $15K, 10R | 100s | storageRing | synchrotronTech |
| `plasmaAcceleration` | Plasma Acceleration | 4 | 70D, $20K, 10R | 110s | tabletopLaser | felPhysics |

Van de Graaff and Cockcroft-Walton are unlocked at game start (no research needed).

---

## 5. Game Engine Changes (game.js)

### 5.1 New State Fields

```javascript
state.machines = [];           // array of machine instances
state.machineGrid = {};        // "col,row" -> machineId (separate from beamline grid)
```

### 5.2 Machine Instance Shape

```javascript
{
  type: 'smallCyclotron',      // key into MACHINES
  id: 'smallCyclotron-17170...',
  col: 15, row: 10,           // grid anchor (top-left)
  upgrades: {                  // subsystem -> current level index (0-based)
    magneticField: 0,
    rfSystem: 0,
    extraction: 0,
    shielding: 0,
  },
  operatingMode: 'isotopes',   // current mode key
  health: 100,                 // 0-100
  active: true,                // is machine running
  injectorQuality: null,       // set if linked to a linac
}
```

### 5.3 New Methods on Game Class

```javascript
// Placement
canPlaceMachine(machineId, col, row)  // bounds check + grid occupancy (both beamline grid and machine grid)
placeMachine(machineId, col, row)     // cost check, place, occupy grid, check injector link
removeMachine(instanceId)             // 50% refund, free grid cells

// Upgrades
upgradeMachine(instanceId, subsystem) // cost check, increment level
setMachineMode(instanceId, mode)      // switch operating mode

// Per-tick
tickMachines()                        // called from tick(), iterates active machines, generates $/data, applies wear
checkInjectorLinks()                  // called on beamline recalc, updates injectorQuality on linked rings

// Query
getMachineAt(col, row)                // check machineGrid
getMachinePerformance(instance)       // compute current multipliers from upgrades + mode + injector
```

### 5.4 Machine Tick Logic

Called once per game tick for each active machine:

```javascript
tickMachines() {
  for (const machine of this.state.machines) {
    if (!machine.active) continue;
    const def = MACHINES[machine.type];
    const perf = this.getMachinePerformance(machine);

    // Energy cost
    const eCost = def.energyCost * perf.energyMult;
    if (this.state.resources.energy < eCost) {
      machine.active = false;
      this.log(`${def.name} shut down: no energy!`, 'bad');
      continue;
    }
    this.state.resources.energy -= eCost;

    // Generate revenue and data
    this.state.resources.funding += def.baseFunding * perf.fundingMult;
    const dataGain = def.baseData * perf.dataMult;
    this.state.resources.data += dataGain;
    this.state.totalDataCollected += dataGain;

    // Reputation from storage ring in user mode
    if (machine.type === 'storageRing' && machine.operatingMode === 'userOps') {
      this.state.resources.reputation += 0.01;
    }

    // Wear (every 10 ticks)
    if (this.state.tick % 10 === 0) {
      const wearRate = 0.01 + eCost * 0.001;
      machine.health = Math.max(0, machine.health - wearRate);
      if (machine.health < 20 && Math.random() < 0.05) {
        machine.health = 0;
        machine.active = false;
        this.log(`${def.name} BROKE DOWN!`, 'bad');
      }
    }
  }
}
```

### 5.5 Performance Calculation

```javascript
getMachinePerformance(machine) {
  const def = MACHINES[machine.type];
  let fundingMult = 1, dataMult = 1, energyMult = 1;

  // Apply upgrade multipliers (multiplicative)
  for (const [subsystem, levelIdx] of Object.entries(machine.upgrades)) {
    const upgDef = def.upgrades[subsystem];
    if (!upgDef) continue;
    const level = upgDef.levels[levelIdx];
    fundingMult *= level.fundingMult;
    dataMult *= level.dataMult;
    energyMult *= level.energyMult;
  }

  // Apply operating mode
  const mode = def.operatingModes?.find(m => m === machine.operatingMode);
  // Mode multipliers defined in MACHINES data
  const modeDef = def.modeMultipliers?.[machine.operatingMode];
  if (modeDef) {
    fundingMult *= modeDef.fundingMult;
    dataMult *= modeDef.dataMult;
  }

  // Injector bonus
  if (def.canLink && machine.injectorQuality != null) {
    const bonus = 0.5 + 0.5 * machine.injectorQuality;
    fundingMult *= bonus;
    dataMult *= bonus;
  } else if (def.canLink) {
    // No injector: 50% performance
    fundingMult *= 0.5;
    dataMult *= 0.5;
  }

  // Health penalty below 50%
  if (machine.health < 50) {
    const healthFactor = machine.health / 50;
    fundingMult *= healthFactor;
    dataMult *= healthFactor;
  }

  return { fundingMult, dataMult, energyMult };
}
```

### 5.6 Injector Linking

Called whenever the beamline is recalculated:

```javascript
checkInjectorLinks() {
  for (const machine of this.state.machines) {
    const def = MACHINES[machine.type];
    if (!def.canLink) continue;
    machine.injectorQuality = null;

    // Check all cells adjacent to this machine for a beamline endpoint
    const { w, h } = { w: def.w, h: def.h };
    for (let dx = -1; dx <= w; dx++) {
      for (let dy = -1; dy <= h; dy++) {
        if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue; // skip interior
        const adjCol = machine.col + dx;
        const adjRow = machine.row + dy;
        // Check if a beamline endpoint exists at this cell
        // (implementation depends on refactored beamline node system)
        const node = this.beamline.getNodeAt?.(adjCol, adjRow);
        if (node && this.state.beamQuality > 0) {
          machine.injectorQuality = this.state.beamQuality;
          break;
        }
      }
      if (machine.injectorQuality != null) break;
    }
  }
}
```

### 5.7 Grid Occupancy

Machines use a separate `state.machineGrid` dict to avoid conflicts with the beamline grid. Placement checks both grids:

```javascript
canPlaceMachine(machineId, col, row) {
  const def = MACHINES[machineId];
  if (!def) return false;
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const c = col + dx, r = row + dy;
      if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return false;
      if (this.state.machineGrid[`${c},${r}`]) return false;
      // Also check beamline grid
      if (this.beamline.getNodeAt?.(c, r)) return false;
    }
  }
  return true;
}
```

---

## 6. Save/Load

Machine state serializes naturally as JSON. On load, rebuild `machineGrid` from `state.machines` (same pattern as beamline grid rebuild). Add machines to save/load in `game.save()` and `game.load()`.

---

## 7. Implementation Order

1. Expand grid (data.js constants)
2. Add MACHINES to data.js with all 7 machine definitions + upgrade trees
3. Add proton linac components to COMPONENTS
4. Add 6 new research projects to RESEARCH
5. Add machine state, placement, removal to game.js
6. Add machine tick, performance calc, wear to game.js
7. Add injector linking to game.js
8. Add upgrade and mode-switch methods to game.js
9. Update save/load for machines
10. Verify with node --check and manual state tests
