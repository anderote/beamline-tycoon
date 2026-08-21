# Content contracts

Use this checklist for placeables, utility definitions, research, scenarios, and
stock designs. `docs/ARCHITECTURE.md` explains why the rules exist; this file is
the short authoring contract.

## Placeables

- Author content in the appropriate `*.raw.js` registry. `PLACEABLES` in
  `src/data/placeables/index.js` is the runtime authority; `COMPONENTS` and
  `DECORATIONS` are compatibility views, not authoring surfaces.
- Use a category declared by `src/data/modes.js`, an object-valued numeric
  `cost`, and the normalized footprint fields expected by the registry.
- Small equipment/furnishings with `stackable: true` normalize to
  `portable: true` and receive physical drop presentation after an individual
  placement or move. Set `portable: false` explicitly when a stackable item is
  fixed in place. Beamline and infrastructure placement remains constrained.
- A `requiredConnections` entry must have a matching sink in
  `src/data/utility-ports-v2.js`.
- If an item is research-gated, its gate and the research node's `unlocks` list
  must name each other. `test/test-registry-integrity.js` and
  `test/test-research-integrity.js` enforce the mirror.
- Tiny beamline hardware uses `placement: 'attachment'`, `role: 'placement'`,
  and `attachmentKind: 'inline'`. Its authored `subL` still sizes the visible
  mesh, but the installed placement claims a point slot and is a zero-length
  thin beam element. Inline anchors snap at half-subtile intervals (alternating
  subtile centres and edges), may share an ordinary component boundary, and
  may not sit inside an ordinary component or share another inline anchor.

## Beamline missions and research

- Beamline mission families are purposes and target bands, not technology
  rewards. Every entry in `BEAMLINE_TYPES` is selectable from the start and
  must not declare a research `requires` gate.
- Research gates the components a player can place and therefore any stock
  blueprint containing those components. A locked blueprint must derive its
  missing research from its component definitions; choosing the mission must
  never bypass those gates.
- `requiredEndpoint` lists the endpoints that can satisfy a mission. It does
  not imply that each listed placeable is currently researched.

## Utility ports and scenarios

- Read ports through `getUtilityPortsV2(id)` when solver defaults and derived RF
  band information matter. The flat table is raw authoring data.
- Assisted distribution wiring uses `autoConnectRadius` and commits real paid
  lines from real free source ports. `autoConnectUtility` defaults to
  `powerCable`; set it to `hvCable` for HV distributors. The authored utility
  must exist and the device must expose a matching source port.
- Port identity is `<placeableId>:<portName>`, but scenario scripts should call
  `wireUtility` with capability selectors such as `{ id, role: 'sink' }` or
  `{ id, role: 'pass', side: 'left' }`. Add `index` only when several otherwise
  equivalent connectors must be distributed deterministically.
- Use `{ id, port: 'authored_name' }` only when that exact connector is material
  to the scenario. Renaming a connector should otherwise not break balance runs.
- RF frequency bands live in `src/data/rf-bands.js`, a dependency-neutral data
  module shared by port authoring and the RF solver descriptor.
- RF waveguides and cryogenic transfer lines use the `rectilinear` routing
  profile: their paths must be axis-aligned with 90-degree bends, but do not
  reserve rigid equipment or service-clearance aisles.
- Vacuum pipe, RF waveguide, and cryogenic transfer line are fabricated rigid
  services with vertical route lanes. Their saved `routeHeightMeters` starts at
  the source connector height and rises only as needed, so parallel or crossing
  runs may share X/Z coordinates while remaining physically separate. A named
  tap is a real fitting and therefore inherits the trunk's route height.
- Cooling supply displays use heat-rejection capacity when it is declared;
  reservoir volume is inventory, not cooling power.
- Cooling-water ports author make-up flow as `supplyRateLPerTick` and tank
  volume as `storageCapacityL`. These are independent capabilities: a source
  must not imply storage, and passive storage must not imply water generation.

## Scenario validity

- A scripted build must check every placement and line result. Do not let a
  rejected wire silently become a later economy or progression imbalance.
- The dev-only Scenario Admin persists one browser-local custom layout as the
  New Game default. Its balance sandbox waives capital construction and
  demolition refunds, but recurring salaries, power, pump service, reservoir
  refills, income, research, and physics continue through their normal paths.
- Scenario Admin's **Save Design** action updates that local layout without
  leaving the editor. **Edit Current** restores it later; **Start New** opens a
  blank project without deleting the current saved layout until the new project
  is explicitly saved over it.
- Separate networks that cannot physically bridge (notably RF and cryogenics)
  instead of relying on adjacency.
- Keep balance assertions about player outcomes and physical constraints. When
  an authored topology changes, repair the topology before adjusting thresholds.
- Run `npm run test:simulation` after scenario, staffing, utility, income,
  upkeep, or resource changes that can affect operating balance.

## Adding a new content field

Update, as applicable: raw authoring data, validation, the normalized registry,
world snapshots, the consuming system, UI formatting, serialization, and tests.
If a renderer builder consumes it, include it in the relevant snapshot section
so its content hash invalidates correctly.
