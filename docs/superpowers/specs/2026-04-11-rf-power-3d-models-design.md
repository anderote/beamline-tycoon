# RF Power 3D Models Design

## Goal

Replace flat-box rendering of RF Power infrastructure components with physically accurate 3D geometry using role-based builders. Klystrons modeled after SLAC XL-4/XL-5 series at 50 kW scale.

## Approach

New file `src/renderer3d/builders/rf-builder.js` following the `vacuum-builder.js` pattern. Each component gets an exported role-bucket builder function. Builders are registered in `component-builder.js` via `ROLE_BUILDERS[compType]`. Uses existing role material system (`accent`, `iron`, `copper`, `pipe`, `stand`, `detail`).

## Components Getting Custom Geometry (8)

### Pulsed Klystron (`pulsedKlystron`) — 1m W × 2m L × 2m H

SLAC XL-4/XL-5 style vertical tube assembly. Dominant visual: tall cylindrical focusing solenoid.

| Part | Role | Geometry | Dimensions |
|------|------|----------|------------|
| Base frame | stand | Box | 0.9 × 0.15 × 1.8m |
| Focusing solenoid | iron | Cylinder | r=0.35, h=1.5m |
| Solenoid end caps | iron | 2× Cylinder (disc) | r=0.37, h=0.04m |
| Klystron tube (collector end) | copper | Cylinder | r=0.1, h=0.3m, above solenoid |
| Collector dome | accent | Cylinder | r=0.18, h=0.15m, at top |
| Output waveguide | copper | Box | 0.12 × 0.08 × 0.15m, side at ~70% height |
| Cooling manifold | detail | Torus | R=0.36, tube r=0.015, at solenoid midpoint |

### CW Klystron (`cwKlystron`) — 1m W × 2m L × 2m H

Same silhouette as pulsed. Larger collector cooling jacket for continuous heat dissipation.

- Same parts as pulsed klystron except:
- Collector dome: r=0.22, h=0.25m (larger for CW thermal load)
- Second cooling manifold torus near solenoid top

### Multi-beam Klystron (`multibeamKlystron`) — 1.5m W × 2m L × 2m H

Wider solenoid, dual output waveguides, larger collector.

- Same structure as pulsed klystron except:
- Solenoid: r=0.45m (wider for multiple beams)
- End caps: r=0.47m
- Two output waveguide stubs on opposite sides
- Collector dome: r=0.25, h=0.2m
- Base frame: 1.3 × 0.15 × 1.8m

### Magnetron (`magnetron`) — 1m W × 1m L × 2m H

Compact vacuum tube in a permanent magnet yoke. H-frame magnet dominates the visual.

| Part | Role | Geometry | Dimensions |
|------|------|----------|------------|
| Base plate | stand | Box | 0.8 × 0.1 × 0.8m |
| Magnet pillars | iron | 2× Box | 0.12 × 1.2m × 0.12m, spaced 0.4m apart |
| Magnet cross-piece | iron | Box | 0.4 × 0.12 × 0.12m, at top of pillars |
| Anode block | copper | Cylinder | r=0.15, h=0.3m, between poles at mid-height |
| Cooling fins | detail | 3-4× Cylinder (disc) | r=0.18, h=0.01m, spaced around anode |
| Output waveguide | copper | Box | 0.08 × 0.06 × 0.12m, from anode toward +X |

### Traveling Wave Tube (`twt`) — 0.5m W × 1m L × 2m H

Vertical tube in a periodic permanent magnet (PPM) stack. Tall and narrow.

| Part | Role | Geometry | Dimensions |
|------|------|----------|------------|
| Support rails | stand | 2× Box | 0.04 × 1.6m × 0.04m, with base feet boxes |
| PPM magnet stack | iron | Cylinder | r=0.08, h=1.2m |
| PPM ring magnets | detail | 3-4× Torus | R=0.08, tube r=0.012, spaced along stack |
| Tube extensions | copper | 2× Cylinder | r=0.04, h=0.15m, above and below PPM |
| Collector | accent | Cylinder | r=0.07, h=0.12m, at top |
| Output waveguide | copper | Box | 0.06 × 0.05 × 0.1m, near top on side |

### IOT (`iot`) — 1m W × 2m L × 2m H

Single-cavity device — shorter solenoid than klystron with a prominent output cavity torus.

| Part | Role | Geometry | Dimensions |
|------|------|----------|------------|
| Base frame | stand | Box | 0.9 × 0.15 × 1.8m |
| Focusing solenoid | iron | Cylinder | r=0.3, h=0.8m (shorter than klystron) |
| Output cavity | copper | Torus | R=0.35, tube r=0.08, at solenoid top |
| Tube | copper | Cylinder | r=0.1, h=0.2m, above cavity |
| Collector | accent | Cylinder | r=0.25, h=0.3m, at top (large — dissipates beam power) |
| Output waveguide | copper | Box | 0.12 × 0.08 × 0.15m, from cavity on side |

### Circulator (`circulator`) — 1m W × 1m L × 1m H

Y-junction — three waveguide ports at 120 degrees around a central ferrite body.

| Part | Role | Geometry | Dimensions |
|------|------|----------|------------|
| Base plate | stand | Box | 0.8 × 0.06 × 0.8m |
| Central junction body | iron | Cylinder | r=0.2, h=0.25m, at y=0.4m |
| Waveguide stubs (×3) | copper | 3× Box | 0.12 × 0.08 × 0.2m, at 0°/120°/240° around Y axis in XZ plane |
| Dummy load | accent | Cylinder | r=0.1, h=0.25m, attached to one waveguide stub |

### RF Coupler (`rfCoupler`) — 0.5m W × 0.5m L × 1m H

Waveguide-to-cavity transition piece. Compact cylindrical device.

| Part | Role | Geometry | Dimensions |
|------|------|----------|------------|
| Main body | copper | Cylinder | r=0.12, h=0.5m |
| Flanges | copper | 2× Cylinder (disc) | r=0.18, h=0.03m, at top and bottom |
| Ceramic window | pipe | Cylinder (disc) | r=0.1, h=0.02m, at mid-height (bright/stainless to read as ceramic) |
| Mounting bracket | stand | Box | 0.15 × 0.08 × 0.15m, at base |

## Components Staying as Cabinets (4)

These are physically correct as textured boxes — they are real-world rack enclosures:

- `solidStateAmp` — 19" rack of semiconductor amplifier modules
- `highPowerSSA` — larger modular solid-state transmitter rack
- `modulator` — cabinet of pulse-forming networks and switches
- `llrfController` — 19" rack unit with digital electronics

No changes needed for these.

## Integration

1. Create `src/renderer3d/builders/rf-builder.js` with 8 exported builder functions
2. In `component-builder.js`: import builders, register in `ROLE_BUILDERS` map
3. Leave `geometryType` in `infrastructure.raw.js` as-is (harmless; role builder takes precedence when registered). Remove face decal overrides from the 8 components that get custom builders to avoid confusion
4. Existing decals for cabinet components (SSA, modulator, LLRF) remain unchanged

## Material Mapping

Role materials from the existing system:
- **accent** — painted metal (per-component tintable, default red for RF)
- **iron** — dark brushed metal (solenoids, magnet yokes)
- **copper** — copper-colored metal (tubes, waveguides, cavities)
- **pipe** — stainless steel (not heavily used here)
- **stand** — dark gray painted metal (base frames, support rails)
- **detail** — dark metal (cooling fins, manifold rings, PPM rings, ceramic window)
