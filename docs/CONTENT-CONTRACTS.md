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
- Renderer-owned placeables whose player-facing ownership differs from their
  implementation `kind` may declare `selectionCategory`. Use one of
  `structure`, `beamline`, `infra`, `facility`, or `grounds`; selection and
  every demolition path consume the same override.
- Small equipment/furnishings with `stackable: true` normalize to
  `portable: true` and receive physical drop presentation after an individual
  placement or move. Set `portable: false` explicitly when a stackable item is
  fixed in place. Beamline and infrastructure placement remains constrained.
- Authored `parts` default to `shape: 'box'`. Equipment parts may instead use
  `cylinder`, `sphere`, `torus`, or `cone`; their positive `w`/`h`/`l` values
  always describe the exact visual bounds in subtiles. `axis` is `x`, `y`, or
  `z` (the long axis for cylinders/cones and hole normal for toruses), optional
  `rotation` is three radians, and a cone's optional `topScale` is in `[0, 1]`.
- Floor coverings use `mount: 'floor'`. They retain a placement footprint for
  rendering, selection, rotation, and area demolition, but do not claim the
  ordinary furnishing occupancy layer, so desks and chairs can sit on them.
- Wall-mounted placeables use `mount: 'wall'`. Non-light hangings declare a
  positive `mountY` centre height in world metres. Wide fixtures may declare
  `wallSpan` from 1–4 to cover consecutive quarter-wall slots; the default is
  one slot. Placement stores the resolved span on `wallMount` so snapping,
  render poses, moves, and save/load agree.
- Structure Hangings do not reserve wall-fixture slots and may overlap other
  hangings, lights, and fittings. A door or window opening on the same physical
  wall edge is their only placement conflict, regardless of which wall face
  was used to author either object.
- A box-shaped equipment/furnishing part may declare `surface: 'mirror'` for a
  real planar scene reflection. Mirror surfaces render as individual geometry
  rather than joining the ordinary static-part material batches.
- A placeable that moves staff between storeys declares `verticalConnector`
  with `toLevelDelta: 1` and a positive subtile `travelCost`. It is authored
  on the lower storey; placement requires finished floors at both landings,
  and no connector may start on the third floor.
- Lighting fixtures use `mount` for physical placement and `subsection` for
  build-palette ownership. Indoor floor lamps use `mount: 'ground'` so their
  bases claim ordinary furnishing occupancy, while the `floorLamps`
  subsection keeps them under Structure → Lights. Every light-bearing def in
  a grouped lighting category must name one of that category's declared
  subsections. Off-centre emitters may declare local-space `sourceOffsetX` /
  `sourceOffsetZ`; the shared projection path rotates those offsets with the
  fixture so painted pools and real lights remain attached to the model.
  Warning and wayfinding fixtures may declare a normalized `light.dayFloor`
  so their emitter remains visible independently of the day/night cycle.
- Electrical wall feedthroughs use `mount: 'wall'` and
  `wallPassThrough: true`. They reserve the matching quarter-wall slot on both
  faces for every slot in `wallSpan` and declare matching passive front/back
  ports of one electrical utility. Multi-conductor fittings keep each authored
  inlet/outlet pair in its own `electricalGroups` entry. A line terminates on
  each face; same-device pair continuity is the only connection through the
  wall. HV feedthroughs set `utilityFlowPresentation: 'symmetric'`: both faces
  use passive, double-headed terminal arrows and the body carries no preferred
  flow arrow, because either face may be upstream.
- An off-map service uses `mapEdgeConnection` with a positive integer
  `maxDistanceTiles` plus validated conductor presentation dimensions. Its
  complete footprint must remain on the map and inside that boundary band at
  placement or move time. The renderer derives its nearest edge and conductor
  endpoints from the current `mapHalfExtent`; land expansion extends existing
  leads to the new boundary without relocating or deleting the service.
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

## Structure flooring

- `requiredFloor` on a Facility zone remains its canonical auto-brush/default
  surface. A finish family may satisfy that contract by listing the canonical
  id in `compatibleZoneFloors`; all placement, brush, and replacement logic
  must use `floorSupportsZone()` instead of comparing floor ids directly.
- Floors shown under Structure > Flooring declare `structureFloor: true`.
  Grounds surfaces continue to declare `groundsSurface: true`; do not maintain
  a second hard-coded palette/search list.
- A finish family with variants keeps `variants`, `variantTextures`,
  `variantTints`, `variantPreviewColors`, and `variantCosts` index-aligned.
  Every texture id must be registered in `renderer3d/materials/tiled.js` and
  backed by a committed PNG under `assets/textures/materials/`.

## Wall face finishes

- Paint, wallpaper, exterior cladding, and applied shielding are authored in
  `WALL_PAINTS` and stored per physical wall face in the legacy `facePaint`
  record. They do not replace the host wall or its collision/opening contract.
- `subsection` selects `paint`, `wallpaper`, `exterior`, or `shielding` in the
  Structure > Walls palette. Textured finishes name a material registered in
  `renderer3d/materials/tiled.js` and backed by a committed PNG.
- A material layer may declare a positive world-metre `thickness` and numeric
  per-segment `cost`. The renderer adds that thickness only toward the selected
  face; applying and stripping it use normal construction charge/refund rules.

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

## Wall openings

- A tile edge is four quarter-tile slots. A `doorWidth: 'single'` opening uses
  two slots and newly placed singles snap to `off: 0` or `off: 2`; `off: 1`
  remains a valid centered fallback for older saved records. A
  `doorWidth: 'double'` opening spans all four slots and uses `off: 0`.
- Every full-tile door definition declares `leafCount`: `2` for a true paired
  double door, `1` for a single moving gate or shutter spanning the opening,
  and `0` for an open hallway passthrough.
- A multi-tile door declares an integer `tileSpan > 1` and is one atomic,
  fixed-length opening across that many consecutive colinear wall edges. Its
  cost and demolition refund apply once to the whole door, while every covered
  edge is entered in `doorOccupied` for room detection and staff navigation.
- Only window definitions authored with `windowWidth: 'half'` use half-edge
  offsets (`off: 0` or `off: 2`). Existing `narrow`, `single`, and `double`
  windows remain centered continuous-width apertures.
- A physical edge carries at most one opening. Half-edge placement chooses
  where that opening sits; it does not permit two independent doors or windows
  on the same edge. Mirrored edge spellings must mirror the stored offset.
- Visible door leaves and window panes are direct demolition targets. A
  demolition gesture begun on that geometry removes the opening (or its
  connected opening run) while preserving the host wall; targeting the wall
  itself retains complete-edge demolition behavior.

## Utility ports and scenarios

### Independent rigid utility stacks

- Cryogenic transfer, cold-water supply, hot-water return, RF waveguide, and
  vacuum pipe are independent fabricated services. They may follow the same
  plan route because each owns a distinct facility-wide elevation. Sharing X/Z
  coordinates never joins their topology or combines their capacity.
- Fabricated services share one routing-permissibility contract: quarter-tile
  Manhattan paths, immediate bends at fittings, automatic same-service contact
  joins, measured 3D equipment clearance at the service's actual datum, and
  vertical coexistence with every other fabricated service. Water retains its
  explicit wall-penetration rule and hot/cold circuit isolation.
- All fabricated rigid services use the same support spacing and minimum-run
  threshold. Identical plan paths therefore put every H-frame at the same plan
  station. Coincident frames consolidate into one multi-level support rack with
  one shelf per occupied datum, without introducing a bus object or shared
  carrier network. The supported lines remain independently selectable.
- `universalUtilityBus` is retired compatibility content. It remains registered
  with `deprecated: true` only so older facilities can load and be demolished;
  palettes, linked collections, search, and research rewards must not advertise
  it. New water-supply pipe cannot be installed into a legacy bus.
- Other retired carrier props likewise remain registered only for save
  compatibility. New construction uses ordinary utility-line tools and real
  distribution equipment.

- Data fiber is a directionless bus network. Any data port may connect to any
  other data port, trunks may be tee-branched, and every data port on one
  device belongs to the same internal peer node. Data service is binary
  connectivity to at least one other device; switches add real connection
  ports and fan-out, never throughput capacity or source direction.
- Ordinary data runs use the shared subtile routing contract and the same
  rounded, gravity-affected presentation as power cords, while retaining data's directionless bus
  topology. Unless a port authors `maxConnections`, each physical data port
  accepts four cable attachments. Cable draw order never defines data flow.
- `networkSwitch` exposes eight internally joined peer ports and is available
  from both Infra > Data & Controls and Facility > Control Room. It requires
  power but does not require a separate upstream data source.

- Read ports through `getUtilityPortsV2(id)` when solver defaults and derived RF
  band information matter. The flat table is raw authoring data.
- Assisted utility wiring commits real paid lines from real free connectors.
  A definition whose source/pass connectors belong to one utility opts in
  automatically; this covers utility supplies, manifolds, network switches,
  and HV supports. `autoConnectRadius` overrides that utility's default reach,
  while `autoConnectUtility` resolves definitions with more than one possible
  origin utility. An authored utility must exist and the device must expose a
  matching source or passive port. Sink-only equipment remains a target.
- Passive peer wiring connects a device pair only once. Overhead HV supports
  are the exception: the nearest pole/tower peer receives an aligned bundle of
  matching free terminals so parallel conductors do not criss-cross.
- Cooling-water assisted wiring uses `autoConnectClass` in addition to the
  solver's source/sink/pass role. `coolingLoadBranch` feeds ordinary cooling
  sinks; `coolingPlantLink` joins chillers, storage, make-up and heat rejection;
  and `coolingDistributionFeed` is reserved for compatibility distribution
  content. The LCW manifold has no service radius: it fans out four cold and
  four hot `coolingLoadBranch` hoses from one rigid cold header and one rigid
  hot header. Assisted wiring pairs ports by `waterCircuit` and may connect both
  circuits on one load. These classes guide assisted routing only; they do not
  change published capacity.
- Electrical distributors and transformers add no demand of their own. Their
  HV inlet draws the actual connected downstream HV/branch load, capped by the
  device rating; unused nameplate capacity does not consume upstream supply.
  The Compact HV Distributor and HV Distributor Box specialize that inlet as
  a two-attachment roof tap: one segment arrives and one may continue the same
  trunk while the cabinet feeds its protected outputs. Ordinary panel/load
  inlets remain single-ended, and a distributor tap may not parallel sources.
- Any electrical sink with demand strictly above 50 kW must use `hvCable`.
  Loads at or below 50 kW may remain on the green `powerCable`; purpose-built
  equipment may still use an authored HV connection below that threshold.
- Port identity is `<placeableId>:<portName>`, but scenario scripts should call
  `wireUtility` with capability selectors such as `{ id, role: 'sink' }` or
  `{ id, role: 'pass', side: 'left' }`. Add `index` only when several otherwise
  equivalent connectors must be distributed deterministically.
- Use `{ id, port: 'authored_name' }` only when that exact connector is material
  to the scenario. Renaming a connector should otherwise not break balance runs.
- RF frequency bands live in `src/data/rf-bands.js`, a dependency-neutral data
  module shared by port authoring and the RF solver descriptor.
- Reuse the narrow connector placements in `src/data/rf-port-standards.js` for
  ordinary centred NC feeds and single-output RF sources. Long structures,
  cryomodules, manifolds, and multi-output flange banks keep their physically
  authored exceptions rather than being forced onto the common mount.
- Every beamline RF sink authors its 3D `rf_in` anchor on the visible inlet
  window/coupler hardware. Sector-scale cryomodules with several rendered
  couplers expose a matching bank of independently connectable `rf_in*` sinks;
  split the placement's aggregate RF demand across them and sum delivered RF
  watts back at the component boundary. Distributed `vac_in*` sinks follow the
  same total-load-preserving rule. Do not leave a rendered sector coupler as a
  decorative false hookup or place these feeds high on the vacuum jacket.
- Every beamline cryogenic sink likewise authors its exact visible bayonet or
  header mount. Use `localX`, `localZ`, and a model-local 3D `normal` in
  `utility-port-anchors.js` when side-derived shell projection cannot identify
  that hardware; `{ x: 0, y: 1, z: 0 }` is a top-facing fitting. These fields
  affect presentation only and must not be used to change simulation endpoints.
- Every utility port must resolve to either `explicit-hardware` or
  `generated-hardware` through `portGeometryClassification`; `unreviewed` is a
  failing content state. RF and cryogenic beamline sinks require explicit
  mounts. Power/HV, cooling, vacuum, and data intentionally use their generated
  type-specific terminal fittings on measured shells. Generated beamline
  vacuum fittings meet the 1 m beam axis, cooling fittings use the low service
  band, and data fittings use the instrumentation band unless a per-port mount
  overrides them.
- Every utility descriptor uses the `flexibleSubtile` routing profile. Vacuum,
  RF, and cryogenic runs author axis-aligned paths on quarter-tile coordinates
  and may turn on any such coordinate. Power, HV, cooling, and data retain that
  path for endpoint routing and compatibility, but also persist the unsnapped
  freehand `cablePath` the player drew. The freehand trace owns their visible
  geometry, length/cost, wall checks, and solid-equipment collision; cooling
  additionally uses it for spatial topology.
- Free-drag endpoints may snap to an existing compatible vacuum, cooling, RF,
  cryogenic-transfer, or data run and commit a named `tapLineIds` T-junction.
  Vacuum, RF, and cryogenic transfer also join automatically wherever an
  authored route touches an existing run of the same type, including a
  mid-route crossing or collinear shared trunk. Cooling and data still require
  the explicit endpoint tap.
  Cooling-water hoses use the same forgiving magnetic pickup halo as data
  cables; their connection still commits as an explicit plumbing tee.
  Power and HV cable do not allow casual tees; use distribution equipment so
  electrical branching retains protected physical outlets.
- Every utility route may turn immediately at a port. Port facing selects the
  visible fitting position and ranks a one-subtile outward lead or perimeter
  wrap, but no utility reserves
  a minimum straight lead-out or clearance strip in front of that fitting.
  If no port-aligned candidate fits, another Manhattan arrival is legal.
  Any utility may connect two real port anchors at the same plan coordinate;
  that stored fitting has zero plan length.
- Equipment footprints are only a cheap broad-phase lookup for route planning.
  Within a candidate footprint cell, the utility body's envelope at its real
  fixed Y datum is tested against triangles measured from the rendered model.
  A footprint by itself never blocks a utility: routes may pass beneath a
  beamline component, through an open stand, or around either side whenever
  there is no 3D intersection. The source and destination components are
  omitted from this obstacle lookup because their measured connector tails own
  the local exterior transition and perimeter wrap.
- Interactive drawing projects the pointer's camera ray onto the armed
  utility's current route-height plane for every utility type, including HV.
  That one projected point also drives hover, tooltips, snapping, erasing, and
  release; the utility tool does not derive a second point from terrain.
- Cryogenic transfer, rigid water supply, RF waveguide, and vacuum pipe use
  mandatory facility-wide route datums: cryogenic at 0.30 m, cold water at
  0.60 m, hot water at 0.90 m, RF at 1.20 m, and vacuum at 1.50 m. Authored
  equipment fittings remain on their visible hardware and use short local
  transitions to these datums. Every rigid descriptor uses the shared 3 m
  support spacing and 3 m minimum supported-run threshold, so co-located runs
  form an aligned vertical stack on consolidated rack frames. Route planning
  and equipment collision must use the selected water circuit's height rather
  than the descriptor's default cold height. Runs remain independent by
  utility and water circuit. Retired saved `routeHeightMeters` values cannot override a fixed
  datum, except the two authored water-circuit datums are both valid.
- A utility descriptor with `requiresWallPassThrough: true` validates the
  physical rendered route against `wallOccupied`. Power and HV cable opt in;
  their freehand `cablePath` is authoritative for newly drawn lines, with the
  shared subtile `path` retained as a compatibility fallback.
  Flexible cooling-water lines also opt in and cannot cross walls directly.
  Rigid water supply pipe crosses only through a matching 1×1 or 2×2 water
  pipe penetration. Vacuum, RF, and cryogenic services retain direct crossing.
- Water line bodies, previews, flow arrows, equipment fittings, and available
  port markers use blue for `cold` and red for `hot`. The LCW manifold's
  detailed model carries the same blue supply and red return header colors.
- The Water Line palette item exposes remembered `Cold Water` and `Hot Water`
  variants. That selection is a circuit constraint, not cosmetic tint: it
  filters port markers, snapping, run-wiring targets, previews, taps, and the
  committed line's `waterCircuit`. Directly dragging an unarmed water port
  infers the same variant from that port.
- An HV cable whose two endpoints are overhead terminals on utility poles or
  transmission towers is an elevated span and may cross any wall or fence in
  plan view. The exception requires two overhead support ports; the pole's
  pad-transformer tap, a transformer, panel, open end, or wall feedthrough at
  either end keeps the ordinary wall-pass-through requirement.
- Every Power-category `hv_in` presentation anchor lands on visible insulated
  hardware at the equipment roof or upper shoulder. Distribution panels, HV
  distributor cabinets, MCCs, and UPS cabinets use model-specific roof-cap
  heights; transformer inputs land on their actual roof-bushing caps. This is
  a presentation contract only and does not change the simulation port side.
- Distribution-equipment outputs terminate at visible, independently selectable
  front-face glands aligned with their breaker rows. Moving an HV input onto its
  insulated roof bushing must not move the device's branch outputs off the front.
- Transmission towers expose one passive HV port at every visible insulator.
  Each accepts two wire attachments; lines sharing one named port are
  continuous, while the other support ports remain isolated. The former
  45-degree indoor HV corner rack remains registered only to load old saves
  and is absent from construction palettes and search.
- The straight indoor HV racks are passive buses. The 4-way rack is one
  six-point bus with four overhead terminals plus one insulated tap on each
  leg. The compact 2-way rack is a three-point L-frame bus with two overhead
  terminals plus one insulated tap on the upright's outside face. Every rack
  attachment shares the 2.00 m crossbar-terminal height and tensions attached
  cables. Overhead rows use 0.4 m spacing so the hanging insulators clear their
  uprights.
  The 2×2 Utility Pole likewise buses its four overhead terminals to one front
  `hv_tap` at 1.55 m. The Pole-Mount Service Transformer is a compact
  port-mounted 100 kW box: placement snaps its `hv_in` directly onto any free
  `hvDistributionTap` capability on a wood pole or straight indoor rack and
  creates the internal HV topology connection. Its four `powerCable` outlets
  remain independently selectable. A host cannot move out from under mounted
  equipment, and removing it cascades through the mounted transformer's normal
  removal path. Sources remain the sole capacity authority. A transformer tap
  does not tension cables or qualify a line for the elevated wall-crossing
  exception.
  Indoor HV racks use overhead placement occupancy: their footprint anchors
  the frame but does not prevent ordinary equipment from being built beneath
  it. An HV cable with either end on an elevated support terminal, or on an
  electrical wall feedthrough, removes drawn lateral slack but retains a
  visible, shallow gravity sag while suspended between its endpoints; the pole
  transformer tap and other soft cables retain drawn slack.
- The active Elevated Wire Tray is an overhead, stilt-mounted mixed-utility
  carrier. Its cable deck and connector band are exactly 1.78 m above the
  local floor, below the indoor HV rack's 2.00 m insulators. Four numbered
  `powerCable` inlet/outlet pairs are isolated conductor groups; the paired
  `dataFiber` connectors share one data pathway. It owns no floor occupancy
  and is linked into both Power / Cable Routing and Data & Controls / Transport.
  The former `cableTray` remains registered only for old saves.
- Passive inlet/outlet fittings keep their `pass` topology role but normally
  derive their physical arrow direction from the port name. Pole, tower,
  indoor-rack support ports, and symmetric HV wall feedthroughs remain
  nondirectional regardless of whether their device is isolated or bused.
  Directional wall feedthroughs and transformers carry a body-level arrow
  derived from the world-space inlet/outlet anchor centroids.
- Cooling supply displays use heat-rejection capacity when it is declared;
  reservoir volume is inventory, not cooling power.
- Cooling-water ports author make-up flow as `supplyRateLPerTick` and tank
  volume as `storageCapacityL`. These are independent capabilities: a source
  must not imply storage, and passive storage must not imply water generation.
- Central cryogenic plants author three independent capabilities on connected
  cryo ports: `storageCapacityL` (reservoir), `coldCapacityW` (chiller), and
  `heatRejectionCapacityW` (warm-end rejector). A network serving SRF hardware
  must have all three; no capability may be inferred from another. A sealed
  cryocooler may explicitly author all three as an integrated starter plant.
- Powered cryogenic stages count only with a live electrical feed. A helium
  compressor's heat-rejection capability additionally requires its authored
  cooling-water connection. Recovery, liquefaction, LN2 precooling, and
  cryomodule heat-intercept bonuses apply only to the cryo network to which the
  corresponding hardware is physically connected.

## Scenario validity

- A scripted build must check every placement and line result. Do not let a
  rejected wire silently become a later economy or progression imbalance.
- The dev-only Scenario Admin publishes browser-local starting situations to
  the same picker as source-authored scenarios. Their balance sandbox waives
  capital construction and demolition refunds, but recurring salaries, power,
  pump service, reservoir refills, income, research, and physics continue
  through their normal paths.
- Scenario Admin's **Save** action updates the open local scenario. **Save As**
  can deliberately overwrite a selected local scenario or create another one;
  each saved scenario remains independently editable and playable.
- Scenario Admin's **Load** action accepts its exported `.scenario.json` and
  emergency `.scenario-backup.json` payloads, validates their world shape, and
  opens them as unsaved work. Import never overwrites a catalogue entry until
  the author chooses a destination through **Save As**.
- Export preserves the current scenario id when its display name is unchanged.
  Publishing updates the payload and catalogue index as one verified operation;
  a failed write rolls both keys back to their prior values.
- App startup migrates the retired single local-scenario slot into the current
  catalogue. The old payload remains the recovery source until both the new
  per-scenario payload and catalogue index have been written and verified.
- **New Game** always opens the scenario picker. Its playable choices are the
  local Scenario Editor-authored starter game and the `sandbox` registry entry;
  source-authored regression fixtures do not appear. Sandbox is the explicit
  blank-map path; do not add a second implicit blank-game flow.
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
