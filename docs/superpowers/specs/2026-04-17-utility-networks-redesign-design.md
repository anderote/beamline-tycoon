# Utility Networks Redesign

**Date:** 2026-04-17
**Supersedes:** `2026-04-09-subtile-pipe-network-design.md` (subtile tile-painting model), parts of `2026-04-11-utility-port-networks-design.md` (port assignments remain authoritative)

## Summary

Full redesign of the facility utility network system as a **core simulation layer**. Replaces the current rack-segment + tile-paint model with **per-utility independent lines**: each of the six utility types is a first-class drawable entity with its own path, connected port-to-port, solved per tick as a graph with persistent per-network state. Lines use subtile-resolution Manhattan routing; each utility type has distinct 3D geometry (round, rectangular waveguide, jacketed). The system is organized as a **shared core + per-utility modules**, each utility's physics living in one small file.

## Goals

- **Reconnect validation to placement.** The current system silently disconnects `rackSegments` from `Networks.validate()` — this redesign puts placement → discovery → solve in a single pipeline.
- **Simulation depth.** Per-tick solve per network with persistent state (reservoir volumes, accumulated heat, wear) that drives quality multipliers on beamline components.
- **Extensibility.** Per-utility physics lives in one file per utility. Adding cooling evaporation, RF reflected power, or a new utility type means editing/adding a small module — the core doesn't know about specifics.
- **Visual distinctiveness.** Each utility has its own 3D geometry style (cylinder / rectangular waveguide / jacketed cylinder) driven by descriptor data.
- **Graph-native model.** Networks are explicit connected-component graphs of ports + lines; topology changes reconcile persistent state via declared merge/split hooks.

## Non-goals (for v1)

- **Cross-network coupling.** No RF-heating-affects-cooling-demand in v1. Each utility type solves independently. Add later via a second-pass or shared state.
- **Auto-routing / path-finding.** Player draws each line manually with Manhattan constraint; auto-routing is future polish.
- **Transient ODE simulation.** v1 is steady-state solve + persistent reservoirs. No pump startup curves, no pressure waves.
- **Save-file backwards compatibility.** Pre-release, single-user project. Old saves break at the cutover commit.
- **Mid-pipe T-branching.** Branching happens via multi-port sources and dedicated junction placeables. Lines are always 2-endpoint edges.

## Design decisions (from brainstorming)

1. **Scope:** facility utility networks only. Beam pipes unchanged.
2. **Gameplay role:** core simulation layer (not a checklist, not abstract).
3. **Redesign scope:** full redesign, including placement — rack-segment model removed.
4. **Pipe model:** per-utility independent lines, not shared carriers.
5. **Connection model:** port-based, mirroring beam pipes. Every line endpoint must terminate at a typed port.
6. **Branching:** multi-port sources + dedicated junction placeables; no mid-line branches.
7. **Routing:** player-drawn, Manhattan (90° bends at subtile corners). Different types can cross; same-type cannot overlap at a subtile.
8. **Simulation:** per-tick steady-state solve + persistent reservoirs.
9. **UI tiers:** always-on map error indicators; click-to-inspect info window; infra-mode gross-stats side panel below music player.
10. **Error severities:** hard (blocks beam) and soft (degrades quality). No separate info tier.
11. **Refills:** explicit player action (button in inspector), debits funding.

## Data model

### State additions

- `state.utilityLines: Map<id, UtilityLine>` — all utility lines across all six types, keyed by id. Map for O(1) lookup and insertion-order iteration.
- `state.utilityNetworkState: Map<networkId, PersistentState>` — per-network persistent state blob. Survives across ticks and saves.
- `state.utilityNetworkData: Map<utilityType, Map<networkId, FlowState>>` — derived per tick. Not persisted.

### UtilityLine

```js
{
  id: string,                              // unique
  utilityType: 'powerCable' | 'vacuumPipe' | 'rfWaveguide'
             | 'coolingWater' | 'cryoTransfer' | 'dataFiber',
  start: { placeableId, portName },        // required; no orphan endpoints
  end:   { placeableId, portName },        // required
  path: [{col, row}, ...],                 // subtile (0.25-step) Manhattan waypoints
  subL: number                             // arc length in sub-units (1 unit = 0.5m)
}
```

Unlike beam pipes, utility lines cannot have open ends. A line that doesn't terminate at two valid ports is not placeable.

### UtilityPort (declared on equipment definitions)

```js
ports: {
  power_out_1: {
    utility: 'powerCable',
    side: 'back',                       // 'back'|'front'|'left'|'right' (compass-relative pre-rotation)
    offsetAlong: 0.25,                  // 0..1 position along the face
    role: 'source' | 'sink' | 'pass',
    params: { capacity: 500 }           // utility-specific (capacity/demand/frequency/etc.)
  },
  ...
}
```

Port assignments for each equipment type reuse the table from `2026-04-11-utility-port-networks-design.md` (sources, optics, RF cavities, SRF cavities, diagnostics, endpoints, and infrastructure outputs). `params` carries utility-specific fields: power capacity/demand, RF frequency, cooling flow demand, etc. The earlier `utilityPorts: [...]` array schema is replaced by the `ports: {name: {...}}` object schema used here, matching the beam-pipe junction port pattern.

### Network (derived each tick)

```js
{
  id: string,                     // stable hash of sorted port keys in this component
  utilityType: string,
  lineIds: [string],
  ports: [{placeableId, portName, role, params}],
  sources: [{portKey, capacity, params}],    // role='source' ports, expanded
  sinks:   [{portKey, demand, params}],      // role='sink' ports, expanded
}
```

Network IDs are stable as long as the port-key set is unchanged. Topology changes (add/remove line, move/remove equipment) may shift IDs; persistent state is reconciled via the utility module's `onNetworkMerge` / `onNetworkSplit` hooks.

### FlowState (derived each tick by `descriptor.solve()`)

```js
{
  networkId, utilityType,
  totalCapacity: number,
  totalDemand: number,
  utilization: number,                       // [0,1], clamped
  perSegmentLoad: [{lineId, load01}],        // optional, for overlay rendering
  perSinkQuality: { portKey → number },      // [0,1] per consumer
  errors: [Error],
  flowDirection: { lineId → 'forward'|'reverse'|'stagnant' },   // optional
}
```

### Error

```js
{
  severity: 'hard' | 'soft',
  code: string,
  message: string,
  location?: { portKey?, lineId?, networkId }
}
```

### UtilityDescriptor (one per utility module)

```js
export default {
  type: 'coolingWater',
  displayName: 'Cooling Water',
  color: '#38bdf8',
  geometryStyle: 'cylinder' | 'rectWaveguide' | 'jacketedCylinder',
  pipeRadiusMeters: number,
  capacityUnit: string,                     // display unit
  persistentStateDefaults: {...},
  solve(network, persistentState, worldState) → {
    flowState, nextPersistentState, errors
  },
  onNetworkMerge?(oldNetworkStates) → newState,
  onNetworkSplit?(oldNetworkState, newNetworks) → [newState, ...],
  renderInspector?(network, flowState, persistent) → DOM/string,
  refillCost?(persistent) → { funding } | null,   // for source-placeable refills
}
```

### Utility visual descriptors (from existing design)

| Type | Color | Profile | Diameter |
|---|---|---|---|
| `powerCable` | `#44cc44` | round | ~4cm |
| `coolingWater` | `#4488ff` | round | ~8cm |
| `cryoTransfer` | `#44aacc` | jacketed cylinder | ~12cm |
| `rfWaveguide` | `#cc4444` | rectangular | ~10×7cm |
| `dataFiber` | `#eeeeee` | thin round | ~2cm |
| `vacuumPipe` | `#888888` | round | ~12cm |

## Modules

### Shared core (utility-agnostic)

| Module | Responsibility |
|---|---|
| `src/utility/UtilityLineSystem.js` | Facade. Add/extend/remove lines via pure validators; mutates `state.utilityLines`; emits `'utilityLinesChanged'`. |
| `src/utility/line-drawing.js` | Pure validators: `validateDrawLine`, `validatePortTypeMatch`, same-type overlap detection. |
| `src/utility/line-geometry.js` | Subtile Manhattan pathfinding: `buildManhattanPath(start, end, obstacles)`, path expansion, arc-length. |
| `src/utility/ports.js` | `availablePorts(placeable, utilityType)`, `portWorldPosition(placeable, portName)`, `portMatchesApproach(port, pathDir)`. |
| `src/utility/network-discovery.js` | Per utility type, union-find over port keys to produce `Network[]`. Stable IDs from hashed port-key sets. |
| `src/utility/solve-runner.js` | Per-tick loop: for each utility type, for each network, call `descriptor.solve()`; collect `FlowState[]` and errors; update `state.utilityNetworkData` and `state.utilityNetworkState`. |
| `src/utility/registry.js` | Imports all six utility descriptors; exports `UTILITY_TYPES`. |
| `src/utility/save.js` | Serialize/deserialize utility lines and persistent state. |
| `src/input/UtilityLineInputController.js` | Cursor/preview/mouse handling for line drawing. Calls `UtilityLineSystem`. |

### Shared rendering

| Module | Responsibility |
|---|---|
| `src/renderer3d/utility-line-builder.js` | 3D mesh builder. Branches on `descriptor.geometryStyle`. Replaces existing `utility-pipe-builder.js`. |
| `src/renderer/utility-line-overlay.js` | 2D/HUD overlay rendering (optional, for minimap/overlay modes). |
| `src/ui/UtilityInspector.js` | Click-a-line info window; shared sections + delegates to `descriptor.renderInspector()`. |
| `src/ui/UtilityStatsPanel.js` | Infra-mode gross-stats side panel below music player. |

### Per-utility modules

`src/utility/types/powerCable.js`, `vacuumPipe.js`, `rfWaveguide.js`, `coolingWater.js`, `cryoTransfer.js`, `dataFiber.js`.

Each exports a `UtilityDescriptor` with `solve()`, `renderInspector()`, and persistent-state schema.

### New junction placeables (defer full stats to v2 once core lands)

- `powerDistributionPanel` (power passthrough)
- `coolingManifold` (cooling passthrough)
- `cryoColdBox` (cryo source + passthrough, owns LHe reservoir)
- `rfSplitter` (RF passthrough)
- `dataSwitch` (data passthrough)
- `vacuumManifold` (vacuum passthrough)

v1 ships these as minimal stubs; tuning and upgrade tiers are a later pass.

## Data flow & lifecycle

### Placement

1. Player selects utility-line tool of a given type in Infra mode.
2. `UtilityLineInputController` enters draw mode. Hover → `line-geometry.buildManhattanPath()` builds preview; snap to matching-type ports via `ports.availablePorts()`.
3. Click-drag updates preview; dry-run validation highlights invalid subtiles (same-type overlap) in red, valid target ports in green.
4. Commit on valid end port: controller calls `UtilityLineSystem.addLine({utilityType, start, end, path})`. System validates, assigns id, inserts into `state.utilityLines`, emits `'utilityLinesChanged'` with `{utilityType}`.
5. `network-discovery` listens, recomputes networks for that utility type only, updates `state.utilityNetworkData[utilityType]`.
6. Persistent state reconciliation: for each new networkId, look up old networks whose ports overlap; call descriptor's `onNetworkMerge` / `onNetworkSplit`.
7. Next tick, solve runs against new topology.

### Removal / cascade

- `UtilityLineSystem.removeLine(id)` removes from map, emits event.
- `removePlaceable(id)` cascades: removes all lines with `start.placeableId === id || end.placeableId === id`. No dangling refs (fixes a current bug in beam pipe removal which leaves nulled endpoints).
- Discovery + reconciliation re-run.

### Per-tick solve loop

1. **Topology-dirty check:** skip discovery if `utilityLines` hasn't changed; reuse cached networks.
2. For each utility type (in registry order), for each network:
   - Look up `persistentState` (default from descriptor if first tick).
   - Call `descriptor.solve(network, persistent, worldState)`.
   - Write `flowState` into `utilityNetworkData`; write `nextPersistentState` back.
   - Collect errors.
3. Feed results into gameplay: `perSinkQuality` → `state.nodeQualities`; hard errors → beam blockers; all errors → UI surface.

### Rendering

- 3D: `utility-line-builder` rebuilds meshes on `'utilityLinesChanged'` only. Per-frame: update material uniforms from current `flowState` (load tint, error glow).
- 2D overlay: reads lines + flow state, toggleable per utility type.
- HUD: `UtilityStatsPanel` (infra mode only) and `UtilityInspector` (on click).

### Save / load

- Serialize `state.utilityLines` (Map → Array) and `state.utilityNetworkState` (Map → Array).
- Deserialize rebuilds Maps; `utilityNetworkData` recomputes on load.
- No migration for existing saves; they break at cutover. Acceptable per project rules (pre-release, single-user).

### Events

- `'utilityLinesChanged'` with `{utilityType}` — triggers discovery + mesh rebuild.
- `'utilityNetworkError'` with `{severity, networkId, message}` — for logging/UI.

## Simulation contract

### `solve()` signature

```
descriptor.solve(network, persistentState, worldState) → {
  flowState: FlowState,
  nextPersistentState: object,
  errors: Error[]
}
```

- Pure function. Inputs read-only; clone if needed.
- Deterministic for replay/save.
- Runs every tick (persistent state evolves even when topology stable).
- No cross-utility coupling in v1.

### Per-utility v1 solve sketches

**`powerCable`:** `totalDemand = Σ sink.demand`; `totalCapacity = Σ source.capacity`; `utilization = demand/capacity`. If `>1`, soft error; `perSinkQuality = capacity/demand` uniformly. No persistent state.

**`vacuumPipe`:** Sum pump speeds (sources) and outgassing (sinks). Compute effective pressure via `1/(1/sPump + 1/cPath)` using real subtile path length. Map pressure → quality bands. No persistent state.

**`rfWaveguide`:** Group sinks by `params.frequency`. For each frequency group, match against sources with matching frequency. Unmatched sinks → soft error. Compute reflected-power ratio → feeds quality. No persistent state.

**`coolingWater`:** Sum heat demand (sinks) and chiller capacity (sources); compute quality. Persistent state: `reservoirVolumeL`. Evaporation debits volume proportional to heat. Zero → quality collapse. Refill via player action.

**`cryoTransfer`:** Analogous to cooling but with static loss + dynamic SRF heat. Persistent state: `lheVolumeL`. Quench error when volume below threshold. Refill via player action.

**`dataFiber`:** Quality = 1 if connected, 0 otherwise. No persistent state.

Each sketch is a placeholder; richer physics comes later with the same contract.

### Feedback into gameplay

- `perSinkQuality[portKey]` → `state.nodeQualities[placeableId]` (same hookup the current system uses, but actually fed from real data).
- `errors[severity='hard']` → beam blockers + red icons on affected equipment.
- `errors[severity='soft']` → yellow icons and quality drops.
- Persistent state surfaces in inspector and gross-stats panel.

## UI

### Always-on map feedback

- Red glow on lines/equipment with hard errors.
- Yellow tint on lines/equipment with soft errors.
- Floating alert icons above affected equipment, severity-colored.

### UtilityInspector (click-to-inspect)

- Triggered by clicking a utility line or a port on equipment.
- Shared frame: network name/id, utility type, member count, total capacity/demand, source/sink lists, error list.
- Utility-specific inner section from `descriptor.renderInspector()`: reservoir levels, frequency lists, etc.
- Source placeables with reservoirs: "Refill" button that debits funding per `descriptor.refillCost(persistent)` and resets reservoir to max.

### UtilityStatsPanel (infra-mode side panel)

- Mounts below music player only when Infra mode is active.
- One row per utility type: color swatch, display name, # networks, total capacity / total demand, # hard errors, # soft errors.
- Click a row → opens that utility's overview (list of networks, clickable to inspect).

### Draw-mode preview

- Reuses beam-pipe preview-path pattern.
- Invalid subtiles (same-type overlap) highlighted red.
- Valid candidate ports highlighted green.

## Testing strategy

- **Pure validator tests**: `validateDrawLine`, `buildManhattanPath`, `availablePorts`, `portMatchesApproach` — table-driven in `test/test-utility-line-*.js`.
- **Network discovery tests**: construct fixture topologies (single network, multiple disjoint, merge on line-add, split on line-remove); assert `Network[]` shape and stable IDs.
- **Per-utility solve tests**: one test file per utility module covering known-input → expected-output scenarios (over/under capacity, reservoir drain, frequency match/mismatch).
- **Reconciliation tests**: split/merge persistent state (e.g., cooling reservoir conservation on network split).
- **Integration smoke test**: fixture facility with placed lines; run a tick; assert `nodeQualities` populated and no ghost errors.

Mirrors existing `test/test-*.js` patterns.

## Migration plan

Pre-release, single-user — no save compat required. Cutover in logical steps:

1. Land shared core (system, validators, geometry, discovery, solve runner) with no utility types registered. No gameplay change.
2. Land each utility module + port declarations on equipment (reuse port tables from prior design). Lines become placeable; solves run but results unwired.
3. Wire `perSinkQuality` → `state.nodeQualities` consumer.
4. Wire error surfacing → HUD and beam blockers.
5. Land UI: `UtilityInspector`, `UtilityStatsPanel`, overlay.
6. **Cleanup commit** at end: delete `src/networks/networks.js`, `state.rackSegments`, `paintRackUtility`, `placeRackSegment`, old `utility-pipe-builder.js`, `NetworkWindow` (or refactor into `UtilityStatsPanel`), `state.networkData` (replaced by `state.utilityNetworkData`), any remaining references. Old save files break; acceptable.

Feature-flag the new system during steps 1–5 if it's ergonomic, but simpler path: land in sequence on master, cleanup at end.

## Open questions / future work

- **Cross-network coupling** (e.g., RF heating adding to cooling demand). v2 via second-pass or shared state dict.
- **Auto-routing** (click endpoints, game plans Manhattan route around obstacles).
- **Flow animation** along subtile paths when overlay enabled.
- **Wear, failures, transient events** (arc-fault, pump failure, vacuum leak).
- **Junction placeable tuning** (capacity tiers, upgrade paths).
- **Auto-refill policies** as an alternative to manual refill (e.g., recurring supply contract).
