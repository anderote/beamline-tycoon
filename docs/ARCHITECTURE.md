# Beamline Tycoon — Architecture

This is the living architecture reference. The repository guardrails in
`AGENTS.md`, content rules in `CONTENT-CONTRACTS.md`, and executable tests are
authoritative when a cited line number has moved.

Written for someone who can already read the code. It does not restate what a file does;
it records the things that are **invisible from reading one file**: which of two similar
registries is authoritative, which fields are load-bearing beyond their obvious use, where a
single source of truth must not be re-derived, and what breaks *silently* when a rule is
violated.

Every claim is cited `file:line`. Where something is current behaviour rather than an
enforced invariant, it says so.

---

## PART 1 — Module map

One line per area: what it owns, and what it must not own.

### `src/game`
| Path | Owns | Must not own |
|---|---|---|
| `Game.js` | The one mutable `state` object, the tick loop, the gesture/undo primitives, serialization, and **all** writes to `state.subgridOccupied`. | Validation geometry (`placement.js`), pipe/junction mutation (`BeamlineSystem`), utility-line mutation (`UtilityLineSystem`), derived economy quantities (`aggregates.js`). |
| `Placeable.js` | Footprint arithmetic (`footprintCells`) and kind validation. 46 lines; keep it that way. | Anything kind-specific — that lives in the defs. |
| `placement.js` | Pure snap + collision + affordability preview. No state mutation. | Cost charging. |
| `aggregates.js` | **One definition per derived quantity.** Every accessor here replaced a value computed at two call sites that had already drifted into a shipped balance bug (`aggregates.js:1-30`). | Any variant logic — a caller that needs a variant passes an argument, it does not re-derive. |
| `economy.js` | The `ECON` tuning table, per-tick income/upkeep functions, and the canonical per-beamline gross-revenue breakdown used by billing and projections. | Its own derivations of draw/pumps/uptime — it imports them from `aggregates.js` (`economy.js:3-6`). |
| `terrain.js` | Sparse per-corner heightmap + the within-tile invariant. | Cross-tile cascade (deliberately absent, `terrain.js:8-10`). |
| `storeys.js` | The three-floor cap, vertical datum, and level-aware tile/subtile/edge key contract. Ground-level keys deliberately retain their legacy shapes. | Construction mutation or renderer policy. |
| `utility-gate.js` | Per-tick gating **policy**: which unwired sinks trip the beam, staffing, `nodeQualities`. | Topology knowledge — that is `network-discovery.js`. |
| `stacking.js` | Pure stack legality (`canStack`, `findStackTarget`, `collapsePlan`). | State mutation; callers apply the plan. |
| `research.js`, `objectives.js` | Thin tick-time delegates over the `src/data` tables. | Registry knowledge beyond the tables. |
| `staff/` | `StaffMember` pawns + per-tick needs. Counts in `state.staff` are **derived** from `staffMembers` (`Game.js:4060`). | The hiring UI. |
| `agent/` | Headless observation/action surface for scripted drivers. | Any gameplay rule of its own. |

### `src/data`
| Path | Owns | Must not own |
|---|---|---|
| `placeables/index.js` | **`PLACEABLES` — the single source of truth for every placeable** (`index.js:3`). Throws on duplicate ids at module load (`index.js:25-27`). | Raw authoring content; it aggregates the five `placeables/*.js` def files. |
| `placeables/{beamline-modules,infrastructure,furnishings,equipment,decorations}.js` | The `kind` tag and dimension normalization applied to each raw registry. | Content. |
| `*.raw.js` | The **authoring** surface: `BEAMLINE_COMPONENTS_RAW`, `INFRASTRUCTURE_RAW`, `FACILITY_{ROOM,LAB}_FURNISHINGS_RAW`, `DECORATIONS_RAW`. | Being read at runtime by gameplay code (see Invariant R1/R2 — several consumers still do). |
| `components.js` | **Legacy shim.** `COMPONENTS` re-derives from `PLACEABLES`, backfilled with raws for non-placeable entries (drift, on-pipe attachments), then merges utility ports. Also the content-validation gate (`components.js:66-87`). | New entries — "Do NOT add new entries here" (`components.js:6`). |
| `decorations.js` | **Legacy shim**, 15 lines, re-derives `DECORATIONS` from `PLACEABLES`. | Anything else. |
| `validate.js` | The content contract, as a pure function returning problems. Also `validateResearch` (the unlock/gating two-way contract). | Throwing — the caller decides. |
| `modes.js` | The palette tab taxonomy. `MODES[*].categories` keys **are** the legal `def.category` values (`validate.js:48-59`). | Item content. |
| `utility-ports-v2.js` | The single home for per-component utility sink/source numbers (`utility-ports-v2.js:14`). | Anything derived — read it via `getUtilityPortsV2(id)`, not the raw export (Invariant U1). |
| `utility-port-anchors.js` | Presentation-only utility mounts: service-band heights, exact model-local hardware coordinates/normals, and the explicit-vs-generated geometry audit. "This table moves the picture, never the model." | Simulation port identity, snapping, route topology, or pricing. |
| `beamline-types.js`, `research.js`, `objectives.js`, `scenarios/`, `stock-designs/`, `wiki/` | Static content tables. | — |

### `src/renderer3d`
| Path | Owns | Must not own |
|---|---|---|
| `world-snapshot.js` | The **only** channel by which world data reaches the 3D renderer. A registry of independently buildable sections (`:465-486`); `only:` computes a subset. | Mutation, or knowledge of THREE. |
| `ThreeRenderer.js` | Camera, scene graph, event→refresh routing, hover/ghost previews, and composition of renderer coordinators. | Live `game.state` reads outside the single sanctioned accessor `_liveState()`; incident physics orchestration (`world-physics-presentation.js`). |
| `lower-storey-presentation.js`, `storey-view.js` | Cached per-storey builder frames, floor-scoped wall modes, solid all-storeys roof overview, and ghost-material lifecycle for physical context below the active construction floor. | Picking, game-state mutation, or changing active-floor materials. |
| `world-physics-presentation.js` | Lazy authored-body registration, incident snapshots, ragdolls, debris, and presentation-only rollback. | Writing transforms or state back into the canonical game model. |
| `component-builder.js` | `ROLE_BUILDERS` (role-bucket geometry, the current path) **and** `DETAIL_BUILDERS` (legacy, returns a full Group). `isDetailedComponent` (`:3551`) is the authoritative "does this have real geometry" test. | Placement arithmetic — that is `componentPose` (`:3558`), shared with the ghost so preview and commit cannot drift. |
| `builders/*.js`, `{decoration,equipment,floor,wall,terrain,cliff,beam,grass-tuft,wildflower}-builder.js` | Geometry from one snapshot section, cached on a `contentKey` of that section. | Reading state. THREE is a **CDN global — do NOT import it** (repeated in every builder header). |
| `texture-manager.js` | Path→`THREE.Texture` cache and the two manifest loaders. Nearest-filter + sRGB is applied here, once (`:33-35`). | Material construction. |
| `content-hash.js` | `contentKey` — the cache key every builder rebuild is gated on. | — |
| `materials/tiled.js` | Module-level singleton materials — "Do NOT dispose them from builders" (`:28`). | — |

### `src/renderer`
The old PixiJS renderer is **gone**. What survives: `grid.js` (iso ↔ grid coordinate math, still used by input and placement), `Renderer.js` (mode/category helpers + a 4x5 pixel font), `sprites.js`, and `designer-renderer.js` — 1144 lines of 2D canvas schematic/plot rendering **attached to `BeamlineDesigner.prototype`** as a side-effect import (`main.js:9`).

### `src/input`
`InputHandler.js` is the event hub. `Tool.js` defines the one-armed-tool contract; `placement-tools.js`, `structure-tools.js`, `demolish-tool.js`, `mode-tools.js`, `beamline-tool.js`, `utility-line-tool.js` are the families. Mutual exclusivity holds *by construction* — one `activeTool` slot (`Tool.js:5-9`). `selection-commands.js` owns atomic copy, move, and demolish transactions so they are testable without calling private `InputHandler` methods. `BeamlineInputController` and `UtilityLineInputController` own the multi-step gesture state that `ThreeRenderer` reads live each frame. `demolishScopes.js` owns what each demolish button may delete and its refund. Escape belongs to `ui/esc-stack.js`, never to a keydown listener of your own.

### `src/utility`
`registry.js` (7 descriptors; adding an 8th is one import + one array entry) → `network-discovery.js` (union-find over port keys, plus **distribution buses** and **adjacency bridging**) → `solve-runner.js` (per-tick solve, topology-revision cache, persistent-state reconciliation) → `game/utility-gate.js` (policy). `UtilityLineSystem.js` is the only writer of `state.utilityLines`; `line-drawing.js` is its pure validator; `routing-contract.js` owns the universal quarter-tile profile and `line-geometry.js` owns its Manhattan path math. `route-obstacles.js` performs footprint broad-phase lookup and delegates actual model-envelope tests through dependency-neutral `utility-collision.js`; `ThreeRenderer` injects the measured triangle provider. `service-heights.js` owns the dependency-neutral fixed route/rack datums and `route-elevation.js` owns their physical-clearance arithmetic. `ports.js` answers *where on the footprint*; `port-anchors.js` answers *where on the model*; `port-contracts.js` resolves scenario-facing capability selectors to authored port names. `utility-endpoints.js` flattens `state.placeables` **and** `pipe.placements` into one endpoint list — everything utility-shaped must consume that, not `placeables` alone.

### `src/beamline`
`BeamlineSystem.js` owns mutation of pipes, junctions and on-pipe placements (Game injects `placePlaceable`/`removePlaceable`/`movePlaceable` into it). `flattener.js` is **the single source of truth for beam element ordering** (`flattener.js:5-6`). `pipe-{drawing,splice,geometry,placements}.js` are pure validators. `pipe-placements.js` also owns longitudinal occupancy: ordinary placements claim intervals, while installed `inline` attachments claim points that may share interval boundaries. `designer-plan.js` plans a Designer *Apply* as an ordered op list; `designer-workspaces.js` owns the persistent per-beamline Current/alternative draft store; `BeamlineRegistry.js` holds per-beamline identity + `beamState`. `component-physics.js` holds `PARAM_DEFS` and the JS-side stat math; `physics-payload.js` builds the payload for Python; `physics.js` is the async client for the worker-owned Pyodide runtime.

### `src/networks`
Only `rooms.js` survives — generic wall/door-bounded flood fill. The legacy `Networks.validate()` pipeline is gone (`Game.js:3963-3966`).

### `src/ui`
`UIHost` is a prototype that `hud.js` and `overlays.js` extend by side-effect import (`ThreeRenderer.js:38-41` — "Must run before `new UIHost(...)` is ever evaluated"). Everything else is a window/dialog. `EconomyWindow`, `UtilityInspector`, `UtilityStatsPanel` and `hud.js` are *display only*: they read published snapshots and never recompute an economy term.

### `beam_physics/` + bridge
A pure-Python package run **client-side under worker-hosted Pyodide** (`src/beamline/physics-worker.js`), and also directly under pytest (`test/test_*.py`, run by `scripts/run-tests.mjs`). `gameplay.py` is the single entry point (`compute_beam_for_game`); `lattice.propagate` runs the module stack in `modules/`; `machines.py` maps a beamline type to a module configuration; `srf.py` owns cavity specs and the gradient model. The JS side passes structured-cloned objects into the worker and JSON through `pyodide.globals`, never Python string interpolation.

---

## PART 2 — Invariants

Each: the **rule**, where it is **enforced or violated**, and what breaks **silently**.

### R — Registries and shims

**R1. `PLACEABLES` is authoritative; `COMPONENTS` and `DECORATIONS` are derived shims.**
`src/data/placeables/index.js:22` is the registry. `components.js:3-6` and `decorations.js:3` say so explicitly and re-derive. `Game._placePlaceableInner` resolves types through `PLACEABLES[type]` (`Game.js:1866`) and rejects anything absent.
*Silent failure:* an entry added to `COMPONENTS` directly is placeable-adjacent but not placeable — `placePlaceable` returns `false` with no log at `Game.js:1867`.

**R2. Decoration consumers still key on `DECORATIONS_RAW`, not on `PLACEABLES`.**
`world-snapshot.js:308` does `DECORATIONS_RAW[d.type]` and falls back to `category: 'unknown'` and `subW/subL/subH = 4` (`:309-311, :338`). `decoration-builder.js:1524-1526` (`_createGhost`) and `:1642-1643` (`renderDecorationThumbnail`) both return `null` for an id absent from `DECORATIONS_RAW`. Today `DECORATION_DEFS` is generated *from* `DECORATIONS_RAW` (`placeables/decorations.js:10`), so the two agree — which is exactly why nothing catches a divergence.
*Silent failure:* a decoration authored only in `placeables/decorations.js` renders as a 2m grey box (`buildDecorationGroup` falls through to `_defaultBox`, `decoration-builder.js:1463`), has no placement ghost, and has a blank palette thumbnail. Nothing throws. **Author decorations in `decorations.raw.js`.**

**R3. Instance `category` is the *kind*, not the palette category.**
`Game.js:1974` writes `category: kind` onto every placed instance, alongside `kind`. So `instance.category ∈ {beamline, infrastructure, furnishing, equipment, decoration}`, while `def.category` is a `MODES` tab key (`power`, `treesPlants`, …). `world-snapshot.js:308-309` reads the *def's* category off the raw registry precisely because the instance does not carry it.
*Silent failure:* filtering `state.placeables` by a palette-tab name returns the empty set — no error, just a panel reporting zero.

**R4. `getUtilityPortsV2(id)` fills defaults; `UTILITY_PORTS_V2_BY_ID` does not.**
`getUtilityPortsV2` (`utility-ports-v2.js:779`) merges `SINK_DEFAULTS`/`SOURCE_DEFAULTS` and derives RF `frequency`/`band`/`bands`; the flat export at the bottom is the raw table. `components.js:46` and `utility-gate.js:98` use the function; `validate.js` (via `components.js:76`) uses the flat table, which is fine because it only inspects `utility`/`role`/`side`.
*Silent failure:* reading the flat table for `params` gives a sink with no `demand` — it contributes zero load, so an over-subscribed network solves green.

**R5. `state.zoneFurnishings` / `facilityEquipment` / `facilityGrid` / `zoneItems` are derived mirrors.**
Rebuilt wholesale by `Game._syncLegacyPlaceableState()` (`Game.js:2553-2571`) on every placement. `zoneFurnishings` is the **furnishing-only render view**; `zoneItems` is *every* placed item with a `ZONE_FURNISHINGS` def regardless of kind, and zone tiering + zone effects must read `zoneItems` (`Game.js:2562-2570`).
*Silent failure:* keying tiering off `zoneFurnishings` means no research lab can ever pass tier 0 and every lab item's `effects` block is dead data — the exact bug the comment records.

**R6. `MODES` is the category vocabulary.**
`validate.js:48-59` derives the legal category/zone/subsection sets straight from `MODES`. `INFRA_DISTRIBUTION` (`modes.js:95`) must be keyed on *categories*, never subsections — a `distribution:` key once sat there unreachable for exactly that reason (`modes.js:91-94`).
*Silent failure without the validator:* an unknown category makes an item invisible in every palette while remaining fully placeable by id.

### S — Single sources of truth

**S1. `facilityEnergyDraw(state)` feeds the electricity bill *and* the power panel.**
Defined `aggregates.js:75`; billed at `economy.js:181`; displayed at `hud.js:150`. `computeSystemStats` uses the same basis (`economy.js:545`).
*Silent failure:* a second derivation at the display site is how a facility drawing 74 kW of a 100 kW supply once displayed a green 6% (`aggregates.js:12-16`). Nothing errors; the number is just wrong.

**S2. `poweredPlaceables()` means equipment **plus** infrastructure — deliberately.**
`aggregates.js:50-54`. Pumps, RF sources, chillers and cold boxes are `kind: 'infrastructure'`; `equipment` is lab devices. Filtering to `equipment` alone left the HUD reporting zero pumps and zero draw for hardware the player is billed for.

**S3. Beam income scales with `hardwareNodeCount`, never `flattened.length`.**
`aggregates.js:92-99` strips the flattener's synthetic `kind: 'drift'` gap entries; `computeBeamlineRevenueBreakdown` uses it for live billing; `ECON.beamIncomePerNode` is derived against that meaning (`economy.js:29-80`). Designer drafts pass an explicit non-drift node count because their synthetic gaps are identified by `type` rather than `kind`.
*Silent failure:* billing raw entries pays for every gap — spacing identical hardware further apart mints income at zero cost.

**S4. `billedDataRate` (not `beamState.dataRate`) is what may be paid for or displayed.**
`aggregates.js:126`, `dataFeeIncome` at `economy.js:134`. The UI's "User Fees" readout once re-derived `dataRate * 0.1` off the raw physics rate — 50x off, and still quoting a fee for a beamline whose fiber was cut (`economy.js:128-133`).

**S5. `state.economySnapshot` is what the tick *charged*, not a second opinion about it.**
Accumulated during `tick()` and published once at `Game.js:3723` / `_publishEconomySnapshot` (`:3792`). Panels call `getEconomySnapshot()` (`:3831`) and display; they do not recompute (`EconomyWindow.js:4`).
*Silent failure:* re-derivation at the display site drifts from the balance without any error.

The Beamline Designer's revenue number is explicitly a **projection**, not a
snapshot of charged money. `BeamlineDesigner` publishes `draftRevenueProjection`
through the same `computeBeamlineRevenueBreakdown` function used by
`Game._tickBeamline`; the renderer only formats it. Because a draft has no
external utility topology, the projection is labelled as gross earning
potential at full data connectivity and excludes facility upkeep. The same
projection publishes the exact operation, endpoint-service, data-fee, and
photon-port terms plus the endpoint contract's band and delivery factors; the
Designer's hover disclosure names those values but never recomputes them.

**S6. Facility uptime is the **mean** of per-beamline uptimes, not summed ticks over wall clock.**
`aggregates.js:112-118`. The summed form runs up to N with N beamlines and once paid out the `highAvailability` objective for a facility whose beams were down.

**S7. A beamline's `typeId` is the sole authority on `beamState.machineType`.**
Re-asserted before any early return in `_recalcSingleBeamline` (`Game.js:3112-3118`) and set at creation (`BeamlineRegistry.js:47-53`). A heuristic `_pickMachineType()` used to guess `'fel'` and silently drop the specialised physics path (`BeamlineDesigner.js:818-831`).

**S8. `state.mapHalfExtent` is the only map bound; nothing holds a copy.**
`Game.js:238-243`; `world-snapshot.js:12-22` reads it with a fallback that covers test fixtures only, "never a live game."
*Silent failure:* a duplicated `35` means bought land renders as void.

**S9. `state.timeOfDay` is the single day/night clock, recomputed from the integer tick.**
`Game.js:3639-3640`, derived not accumulated — repeated `+= 1/240` drifts across the `isNightAt` boundaries (`Game.js:138-152`). `ThreeRenderer._updateSunCycle` reads it and *snaps* to it rather than easing, so load/undo cannot leave the sun stuck mid-glide (`ThreeRenderer.js:2980-2981`).

**S10. `UTILITY_TO_QUALITY_FIELD` is the utility→quality-field contract.**
Exported from `utility-gate.js:58` for exactly that reason. Anything reading `nodeQualities` must key off it, not a hand-copied map.

### P — The state → snapshot → builders pipeline

**P1. The 3D renderer reads world data only through `buildWorldSnapshot`.**
Stated at `world-snapshot.js:3` and `ThreeRenderer.js:4-12`. Live per-frame state (hover, drag previews, armed tool) is read from the input controllers that own it — that is correct and expected. Everything else goes through `this._snapshot`, and the residual `game.state` reads go through the one greppable accessor `_liveState()` (`ThreeRenderer.js:3076-3086`): terrain sampling under the cursor, and utility-line port/network resolution.
*Silent failure:* a builder that reads `game.state` directly bypasses the section cache and renders stale-or-too-fresh data with no symptom until an event ordering changes.

**P2. Builders skip rebuilds on a `contentKey` of their snapshot section.**
`content-hash.js:98`; e.g. `wall-builder.js:70-72` returns early when the key matches. Object keys are mixed in **own-enumerable order**, which is deterministic only because snapshot builders construct fixed-shape literals (`content-hash.js:13-15`).
*Silent failure:* add a field to a builder's inputs without adding it to the hashed section, and the builder never rebuilds when that field changes. No error — the mesh is just wrong forever.

**P3. Snapshot sections are independently buildable and independently expensive.**
`SECTION_BUILDERS` (`world-snapshot.js:465`); `terrain` and `cliffs` walk the whole map region. `_updateSnapshot(sections)` merges a partial into the cache (`ThreeRenderer.js:3067-3072`).
*Silent failure:* refreshing a cheap section via the full `refresh()` costs a full-map walk per event — a frame-rate regression with no correctness symptom.

**P4. Durable world mutations publish one canonical, frame-coalesced change-set.**
`Game.emit` preserves the public compatibility events and additionally publishes
`worldChanged` with the `WorldChangeSet` contract from `game/world-change-set.js`.
Exact placeable mutations carry stable ids and net actions; transaction merging
preserves every id and collapses add/update/remove sequences. `ThreeRenderer`
queues the derived `world-refresh-plan` and drains it once at the start of the
next animation frame. Full load/restore and unscoped legacy mutations retain
conservative full-section fallbacks.
*Silent failure:* rebuilding from each compatibility event separately turns one
placement into several synchronous snapshot walks and scene teardowns; dropping
all but the last batched payload leaves stale entity meshes behind.

**P5. Preview geometry and committed geometry must share one arithmetic.**
`componentPose` was extracted from `ComponentBuilder.build` for the design ghost (`component-builder.js:3558-3564`), and `isDetailedComponent` is the authoritative "has real geometry" test because `_createObject` always wraps in a Group with a hitbox, so `children.length` is *always* truthy (`ThreeRenderer.js:2340-2344`, `:2522-2526`).
*Silent failure:* the ghost sits a metre below the pipe, or claims a spot the commit will not take.

**P6. Grass-kind floors do not displace the terrain mesh.**
`world-snapshot.js:63-68` keeps the terrain tile and tags it; `buildFloors` skips emitting a floor for them (`:168`); `buildGrassSurfaces` re-checks `infraOccupied`, which is authoritative over the `floors` array (`:143-149`).
*Silent failure:* stamping a flat texture over a placed grass patch breaks the brightness-blob vertex colouring continuity.

### C — Content validation

**C1. `src/data/components.js` is the validation gate, and dev/node throws while production logs.**
`components.js:66-87`: it is the point where every registry has loaded. `isNode || import.meta.env?.DEV` → `throw`; otherwise `console.error` and keep running.
*Consequence:* a malformed def **fails the entire test suite at import time**, not at first placement. That is intentional. It also means a production build ships with the bad def live.

**C2. `cost` must be an object of numeric resource amounts.**
`validate.js:121-129`. `Game.canAfford`/`spend` iterate `Object.entries(cost)` (`Game.js:911, 918`).
*Silent failure:* a bare number has no entries — the item places for free.

**C3. Anything with `requiredConnections` must have a matching **sink** port in `utility-ports-v2.js`.**
`validate.js:176-186`.
*Silent failure:* the component contributes no demand to any network, so a 40 kW panel "feeds" a 2000 kW gyrotron at 0% utilization while the overlay still draws a hookup the player can never make.

**C4. `physicsType` is mandatory on every beamline component and must be in `KNOWN_PHYSICS_TYPES`.**
`validate.js:209-213`. The JS set (`validate.js:33-37`) **mirrors** `beam_physics/gameplay.py:75-79`, and `test/test-content-validate.js` parses the Python and asserts equality (`validate.js:23-25`).
*Silent failure without the mirror:* `gameplay.py:179-184` raises at compute time, `physics.js:104-107` catches and returns `null`, and the beamline silently falls back to `Game._fallbackStatsForBeamline` (`Game.js:3325`) — a running beamline with wrong numbers, not an error.

**C5. Research nodes and component gates form a two-way contract.**
`validateResearch` (`validate.js:365`): every id in `unlocks` must not ship `unlocked: true`, must declare `requires`, and must name this node or one of its prerequisites; every `requires` must name a real, *startable* node. 27 of 68 nodes — $403M of content — were dead before this existed (`validate.js:330-334`).
`test/test-registry-integrity.js` generalizes this: **every id-shaped string literal in an id position anywhere in `src/`** must resolve against some registry.
Beamline mission families are deliberately outside this gate: they declare the
purpose and target bands and are always selectable. Research gates the
placeable hardware and stock blueprints used to implement them.

**C6. A beamline component with no `ROLE_BUILDERS`/`DETAIL_BUILDERS` entry is *info*, never a problem.**
`roleBuilderFallbacks` (`validate.js:72`), reported at `component-builder.js:3524-3535`. It renders as a generic box/cylinder.

### Z — Serialization, undo, and gestures

**Z1. `SERIALIZED_FIELDS` is the whitelist; everything else on `state` is derived.**
`Game.js:46-65`, with the rule stated at `:41-45`. Derived-and-never-serialized includes `economySnapshot`/`economyHistory` (`:291-293`), `utilityNetworkData`, `utilityNetworks`, `nodeQualities`, `systemStats`, all occupancy indexes, and `zoneItems`. `Map`-backed fields (`cornerHeights`, `utilityLines`, `utilityNetworkState`) persist as entry arrays and are rehydrated in `_applyState` (`:4559, :4615-4617`).
*Silent failure:* adding a field to `state` without listing it means it silently resets on every load **and** is invisible to the undo diff — a gesture that only changed it reads as "nothing happened."

`beamlineDesignerWorkspaces` is serialized player content, not an open UI session. The transient open Designer remains in the `designer` aux section; closed Current/Design N drafts live in the ordinary state field so closing the overlay cannot erase work before the next save.

**Z2. Undo/redo restores a full snapshot but must **not** rewind sim progress.**
Three lists, all in `Game.js`: `UNDO_PRESERVED_FIELDS` (`:78-84`) — clock, research, objectives, staff, log, `savedDesigns`, and `beamlineDesignerWorkspaces` (the last two live outside world gestures); `BEAMSTATE_PRESERVED_FIELDS` (`:92-95`) — per-entry accumulators; and the resource ledger (`_syncResourceLedger`, `:719`), which lets undo refund a build's cost without reclaiming the upkeep paid while it stood. The RNG stream is **not** reseeded on undo (`:4548-4554`).
*Silent failures:* rewinding `componentHealth` makes Ctrl+Z a free facility-wide repair; rewinding `beamOnTicks` under a preserved `tick` permanently corrupts `uptimeFraction`; reseeding lets a player re-roll wear failures and discoveries by undo/redo.

**Z3. `beginGesture`/`commitGesture` are the only places allowed to touch the undo stacks.**
`Game.js:660-669`. Ordering is fixed and load-bearing: validate → charge → mutate → snapshot-if-changed (`:781-799`). Nested gestures **join** the outer one so one user action makes one undo entry (`:753-758`). The diff is against `_snapshot()`, which excludes the log and the aux sections so a logged rejection does not read as a mutation (`:680-694`).
*Silent failure:* charging inside `mutate` *and* passing `cost` double-charges (`:790-792`).

**Z4. `BEAMLINE_TX_FIELDS` is deliberately narrower than the undo snapshot — and `cornerHeights` is in it non-negotiably.**
`Game.js:111-117`. Placement auto-flattens terrain under the footprint (`_placePlaceableInner`, `:1946-1959`), so a rolled-back Apply that omitted terrain left a permanent flat scar in the hillside with nothing to explain it (`:105-110`). The beamline **registry** is deliberately outside the blob (`:4394-4399`).

**Z5. `restoreSnapshot` does not dispatch aux sections; `load` does.**
`Game.js:4356-4376`. Camera, probe pins and the designer session must not jump on undo. `restoreSnapshot` emits `'restored'`, which the 3D renderer treats exactly like `'loaded'`.

**Z6. Save format is version-gated at 9 with no migrators.**
`Game.js:4312`, `:4336-4339` — anything older is deleted. Pre-release, single-user: old saves are expected to break.

### U — Units and coordinate systems

**U1. One tile = 4 sub-tiles = 2 world units = 2 metres. World units *are* metres.**
`dims.js:4-6` ("1 sub-tile = 0.5m"), `line-geometry.js:8`, `ports.js:125-126` (`cx = col*2 + (subCol + w/2)*0.5`), `wall-builder.js:8`.
**Trap:** `wall-builder.js:9-10` reads `const M = TILE_SIZE / 2; // 1 world unit = 2m, so 1m = 0.5 world units`. The comment is wrong — `M` evaluates to **1**, and every `x * M` in that file is metres-as-world-units. Do not "fix" the comment by changing `M`; that would halve every wall in the game.

**U2. `dir` is 0–3 quarter turns and drives footprint occupancy — it is not cosmetic.**
`Placeable.footprintCells` swaps `subW`/`subL` on `dir === 1 || dir === 3` (`Placeable.js:24-26`). The same swap is mirrored, independently, in `world-snapshot.js:315-318`, `ports.portWorldPosition` (`ports.js:116-118`), `network-discovery.footprintSub` (`:81-88`), `placement.snapForPlaceable` (`:32-34`), `stacking`, and `ThreeRenderer` ghost code (`:2350-2352`).
*Silent failure:* redefining the range (degrees, 8-way, signed) corrupts tile occupancy everywhere — items overlap, ports resolve to the wrong edge, adjacency bridging links the wrong components. Nothing throws.

**U3. `dir` on an on-pipe placement is a *compass* index, not the same quarter-turn.**
`placementPose` returns `dir` as 0=NE, 1=SE, 2=SW, 3=NW derived from the path segment (`pipe-placements.js:270-277`). It happens to be consumable as quarter turns by the renderer and `portWorldPosition`, but its *derivation* is directional, not rotational.

**U4. On-pipe placement records carry **negative** `subCol`/`subRow`, but their rendered centre has the beam-pipe tile offset.**
`utility-endpoints.js:46-47` sets the logical offsets to `-footprint/2` for solver footprint arithmetic. Beam-pipe path coordinates are tile-centre indices, however, so the physical model centre is `col*2+1, row*2+1`; `componentPose` and `portAnchor3D` apply that offset. Any physical-world consumer of the synthesized record must preserve the distinction: `network-discovery.endpointCenter`/`endpointBox` intentionally use the logical convention, while `route-obstacles.physicalEndpointCenterWorld` uses the rendered centre.
*Silent failure:* treating a physical obstacle like an ordinary logical endpoint shifts its blocking footprint one metre north-west, rejecting a clear utility route on one side of the visible machine while allowing a route through the other side.

**U5. The 2:1 dimetric camera is a formula, not a magic number.**
`ThreeRenderer.js:466-471`: for a camera at `(d, h, d)` the screen X:Y ratio for a grid axis is `sqrt(2h² + 4d²) / (h·sqrt(2))`; setting it to 2 gives `h = d·sqrt(6)/3`. It reproduces the old PixiJS 64x32 tile projection. Ground-projected pan axes are pre-normalized by √2 (`:1082-1088`).

**U6. Terrain: heights are integer steps, `HEIGHT_STEP_METERS = 0.5`, range `[-4, 6]`, and `max(corners) − min(corners) ≤ 1` per tile.**
`terrain.js:8-17`. Enforcement cascades **within** a tile only, never across tiles (`enforceInvariant`, `:49`). `setTileCorners` will silently clamp a caller's requested value down to satisfy it (`:200-209`). `state.cornerHeightsRevision` is the renderer's cache key and is bumped by every mutation; it **resets to 0 on load** so builders rebuild on the first frame (`Game.js:4560`).

**U7. Every utility line has a geometric route height, and the input pick plane must follow it.**
`registry.utilityLineHeight` supplies the physical height. Fabricated cryogenic,
cold-water, hot-water, RF, and vacuum services use the mandatory datums in
`service-heights.js` (0.30/0.60/0.90/1.20/1.50 m); obsolete saved lane values
are ignored. The two rigid-water heights are selected by circuit. Exact
equipment hardware may sit elsewhere, but its transition is local to the
endpoint. The input tool always follows the armed utility's datum, so preview
and pointer do not drift under the isometric camera. Different fixed-height
utilities may cross when `route-elevation.js` proves body clearance. Co-located
rigid paths use common support stations but remain independent topology.

**U8. A footprint is only the broad phase for utility/equipment collision.**
All eight utilities publish `flexibleSubtile` and retain a quarter-tile
Manhattan compatibility path through `routing-contract.js`. Power, HV, cooling,
and data additionally store the unsnapped freehand `cablePath` the player drew;
that visible trace is authoritative for pricing, wall checks, and equipment
collision. `route-obstacles.js` uses the rendered footprint to limit lookups,
transforms each candidate point into component-local coordinates, and calls the
provider registered in `utility-collision.js`.
`component-builder.utilityEnvelopeIntersectsModel` tests that 3D utility
envelope against cached triangles from the actual component model. With no
provider (headless logic), equipment contributes no footprint-only blocker.
Endpoint host models are excluded so `port-anchors.js` and the renderer's local
connector tails can wrap around their shells. Thus matching X/Z occupancy is
not a collision by itself: a line may pass below or through open model volume.

### T — The utility system

**T1. Every utility consumer must read `listUtilityEndpoints(state)`, not `state.placeables`.**
`utility-endpoints.js:1-17`, `:67`. Role-`placement` modules (cavities, quads, BPMs, cryomodules) live inside `pipe.placements`, not in `placeables`.
*Silent failure:* the entire cryoTransfer sink population is placements, so indexing placeables alone left the cryo plant with nothing to serve, the quench path as dead code, and those components absent from `nodeQualities` — so they ran at the consumer's **1.0 default**. Never wiring outscored wiring badly (`utility-gate.js:10-13`).

**T2. Five utilities hard-gate the beam; `dataFiber` deliberately does not.**
`HARD_REQUIRED_UTILS` (`utility-gate.js:29-31`) vs `ALL_GATED_UTILS` (`:45`). dataFiber is a soft derate through `Game._dataConnectivityFactor` (`Game.js:3844`) — an unwired BPM costs money rather than tripping the machine. The wider sweep still runs over all six so panels can report wiring truthfully.

**T3. A declared-but-unsolved sink fails **closed**, to its worst physical value — not to zero.**
`declaredSinkQualityFloor` (`utility-gate.js:96`) and `UTILITY_PHYSICAL_FIELDS` (`:78-83`): no RF is 0 W, but no cooling is **300 K** and no pumping is **1013 mbar**. A component that declares *no* sink for a utility is "not applicable" and takes the consumer's 1.0 default.
*Silent failure:* zeroing the physical fields reads as "perfectly cold" and "perfect vacuum" — the exact inversion the floor exists to prevent.

**T4. Adjacency bridging is bounded three ways, and each bound is load-bearing.**
`network-discovery.js:190-211`: (1) per-utility opt-in via `bridgesAdjacent` on the descriptor — RF and cryo do **not** bridge; (2) a cluster is inert until a line reaches it (seeded from `touchedPlaceables` only, `:470-480`); (3) a component declaring both a source and a sink of the same utility is a boundary and never bridges it (`bridgeablePortKeys`, `:298-310`) — otherwise its own output satisfies its own input and a rack of them needs no supply.
Geometry: `ADJ_MAX_GAP_SUB = 1` sub-unit of slack (`:218`), and **corner contact is not adjacency** — one axis must genuinely overlap (`boxesAdjacent`, `:236-243`).
*Silent failure:* relaxing (3) makes a dataFiber rack self-satisfying; relaxing corner contact bolts diagonal neighbours together.

**T5. A distribution bus adds no capacity and is bounded to one pipe segment plus a radius.**
`network-discovery.js:56-75`. Coverage stops at the segment carrying the nearest covered sink, and at `params.serviceRadius` grid cells (default 8, `:78`). Covered sinks land in the **same network as the source feeding the bus**, so the source still carries their total demand.
*Silent failure:* removing either bound makes one bus answer a whole beamline and the placement decision evaporates.

**T6. Network ids are content-hashed from sorted port keys — so wiring one more sink mints a new id.**
`network-discovery.js:24-32`; `SolveRunner._reconcilePersistentState` (`solve-runner.js:173-278`) migrates persistent state across the re-hash by `__portKeys` overlap, splits extensive fields proportionally on a cut, sums them on a join, and asks the utility descriptor to apply its physical bounds. Fields listed in `persistentIntensiveFields` (for example cryogenic bath temperature) are not divided or summed. Orphans are held for `ORPHAN_GRACE_PASSES = 300` (`:34`) before pruning.
Cooling water and cryogenic helium both use dynamic bounds: their `boundPersistentState` hooks cap inventory at the sum of connected `storageCapacityL` ports, because adding a physical tank must add real capacity. Utilities without a hook still use `persistentStateDefaults` as their ceiling.
*Silent failures if you touch this:* without migration, a drained reservoir refills for free on any topology edit; treating temperature like inventory produces nonsense on a split or join; without the appropriate cap, joining independently seeded loops can leave inventory above physical storage, make `refillCost()` compute a negative `missing`, and silently remove the Refill button; without the grace window, delete-and-redraw is a free refill for two clicks.

**T7. Discovery is cached on `topologyRevision`; every mutation seam must bump it.**
`solve-runner.js:10-19`, `markTopologyDirty()` (`:73`). Game bumps it from a single listener on `utilityLinesChanged | placeableChanged | beamlineChanged` (`Game.js:431-439`) and again on load/undo/redo (`Game.js:4628`). On-pipe placements are utility endpoints too, which is why a *pipe* edit must bump it (`Game.js:417-423`). `UtilityGate` rides the same revision for its topology cache (`utility-gate.js:136-143` — "must never go per-tick").
*Silent failure:* a mutation path that skips the seam keeps serving a network that still carries a deleted placement's demand.

**T8. Move is not remove-then-place.**
`Game.movePlaceable` (`:2090`) keeps the id, because utility lines, beam-pipe `start`/`end` refs and the beamline registry all anchor to it (`:2071-2084`). It also deliberately touches no money — charging or refunding would let a player mint funding by nudging a module back and forth.
*Silent failure:* a remove/place "move" unwires every cavity's cryo and RF feed and orphans every pipe end.

**T9. Port identity: `${placeableId}:${portName}`, and only *utility* ports carry a `utility` field.**
`network-discovery.js:23`, `ports.js:8-12`. `components.js:44-58` merges utility ports into each entry's `ports` object **without clobbering beam ports** (`entry`, `exit`, `linacEntry`, …) — beam ports win on a name collision, and a fresh merged object is always assigned so utility ports never leak back into the raw registries.

**T10. Render anchors may move the picture, never the utility endpoint.**
`port-anchors.js` starts from the canonical `portWorldPosition`, then may project
the visible fitting onto measured shell geometry or an exact model-local
hardware mount from `utility-port-anchors.js`. Exact mounts can carry a full 3D
outward normal, including top-facing connectors. Port identity, snapping,
routing topology, and pricing continue to use the canonical footprint point.
The bounds provider is injected with `setModelBoundsProvider` so anchor
resolution remains usable headless.

**T11. Utility contact semantics come from the descriptor.**
The input controller can snap a compatible line endpoint to a named installed
run and persist that relationship in `tapLineIds`. Vacuum, RF, and cryogenic
transfer additionally declare `joinsOnContact`: validation accepts any exact
same-type route contact and network discovery spatially unions the lines,
including interior crossings and collinear shared trunks. Cooling and data
retain explicit endpoint taps. Power and HV remain radial and require authored
distribution hardware rather than casual line-to-line tees. The two HV
distributor cabinets are the authored exception: their demand-tracking roof
inlet accepts two cable segments so a trunk can continue through the terminal
while the cabinet taps its protected outputs; it cannot combine live sources.

### B — Beam physics bridge

**B1. `flattenPath` is the single source of truth for element ordering — but the physics envelope is *not* parallel to it.**
`flattener.js:5-22`. `lattice.propagate` resamples onto a fixed `SAMPLE_POINTS` uniform arc-length grid, so `envelope` is indexed by *sample*, each carrying its own `.s` (metres, at the **end** of a sub-step) and `.index`. To locate an element, search for the sample nearest its `beamStart` — **never** index by element position.

**B2. `physics-modules.js:PY_PHYSICS_MODULES` must list every Python file the package imports.**
`physics-worker.js` writes each listed file into Pyodide's virtual FS before importing `beam_physics.gameplay`. The manifest includes `srf.py` and `modules/beam_gas.py`, and `test-browser-physics-sync.js` checks every manifest entry against the served package.
*Silent failure:* omitting a transitive import makes worker initialization fail while the game can continue on fallback physics, so this contract requires the explicit manifest test rather than relying on pytest's filesystem imports.

**B3. `component-params.js:seedComponentParams` is the one param seeder for both placement paths.**
`Game.js:1989-2000`. The free-grid path and `BeamlineSystem.placeOnPipe` had drifted, and the pipe path was seeding nothing — running every on-pipe RF cavity at the Python engine's 1.3 GHz default instead of its catalogue frequency.

**B4. Python `COMPONENT_DEFAULTS` are fallbacks; the JS catalogue's `stats` win.**
`gameplay.py:27-29` — "Keep them in agreement with `beamline-components.raw.js`; they must never diverge." `srf.CAVITY_SPECS` is the single source of truth for whether a cavity is SRF (`gameplay.py:368-374`) — a hand-maintained `SRF_TYPES_SET` used to drift.

**B5. The gate writes `nodeQualities` at the *end* of the tick, after the physics pass that reads them.**
`Game.js:3760-3769`. `_syncPhysicsToNodeQualities` propagates the change immediately, keyed on `_nodeQualitySig` (`:2957`), where `''` is the signature of "nothing solved" so an empty world never triggers a first-tick recalc (`:450-454`).
*Silent failure:* skipping the propagation freezes `beamState` at whatever quality the last build mutation happened to see.

### M — Money

**M1. Every build-time funding debit goes through `chargeConstruction` (`Game.js:928`) or `spend` (`:916`).**
Both no-op under `sandboxMode`, so sandbox has exactly one place to suppress. Recurring upkeep deliberately still charges (`:921-926`, `:890-898`).

**M2. Refund paths are *not* sandbox-guarded — current behaviour, and asymmetric.**
`Game.js:2192` and `:2327` (50% placeable refund), `:1346, :1354, :1423` (wall/door), `:2675, :2683` (pipe), and `commitGesture`'s failure refund at `:845` all add to `state.resources` unconditionally, while `spend` (`:917`) returns early in sandbox.
*Consequence:* in sandbox mode, place-then-demolish mints 50% of catalogue price per cycle, and a gesture that passes an explicit `cost` and then fails mints the full amount. Flagged here as a **finding**, not as a rule to preserve.

**M3. `chargeReservoirRefill` (`Game.js:940`) is the only way to pay for a top-up.**
It books into `_refillsCharged`, swept into the next tick's snapshot under `upkeep.refills` (`:3668-3672`). Refills are event costs, not per-tick ones.
*Silent failure:* paying anywhere else makes the panel quote a cost the player never paid, or miss one they did.

**M4. Utility lines are priced per sub-unit on **both** commit paths.**
`costPerSubUnit` on each descriptor (`types/powerCable.js:47`, and the ladder documented at `:36-42`); `UtilityLineInputController` prices the run-wiring drag and the single-line draw through the same helper (`:378-400`).
*Silent failure:* free single runs make every distribution bus in the catalogue a strictly worse buy, so the bus mechanic quietly dies.

### I — Input and UI

**I1. Exactly one armed tool; exclusivity is structural.**
`Tool.js:5-9`, `InputHandler.activeTool`. `armedPlaceableId` (`InputHandler.js:145`) is the single query the shared preview/commit/rotation paths use.

**I2. `cancelGesture(ctx, reason)` distinguishes `'stateReplaced'` from `'abort'`.**
`Tool.js:29-34`. A tool holding state that mirrors the world (MoveTool's lifted object) must **drop** it on `'stateReplaced'` (the restore already holds a copy) but **restore** it on `'abort'` (nothing else will).
*Silent failure:* getting it backwards either deletes the payload unrefunded or duplicates it.

**I3. Escape belongs to `ui/esc-stack.js` — one window listener, a stack, and a fallback tier.**
`esc-stack.js:1-14`. The game input layer registers the *fallback* handler (`InputHandler.js:137`), so any open dialog beats it. Handlers return `false` to pass down.
*Silent failure:* a private keydown listener creates a capture-phase race that only shows up with two layers open.

**I4. A rejected gesture must not push undo or clobber redo.**
Enforced structurally by `commitGesture` (`Game.js:794-796`) and asserted by tools that manage their own (`placement-tools.js:229`, `demolish-tool.js:231`).

**I5. `UIHost` methods are attached by side-effect imports and ordering matters.**
`ThreeRenderer.js:38-41` — `hud.js` and `overlays.js` must be imported before `new UIHost(...)` is evaluated. `designer-renderer.js` does the same to `BeamlineDesigner.prototype` (`main.js:8-9`).

---

## PART 3 — Extension recipes

### Adding a placeable
1. Author the def in the matching `src/data/*.raw.js` (`beamline-components.raw.js`, `infrastructure.raw.js`, `facility-{room,lab}-furnishings.raw.js`, `decorations.raw.js`). `id`, `name`, object-valued `cost`, `category` from `MODES`, `subW`/`subL`/`subH` in sub-tiles.
2. Beamline only: `physicsType` from `KNOWN_PHYSICS_TYPES`, `placement`, `role`, `ports`, `routing`.
3. If it consumes a utility: add `requiredConnections` **and** a matching sink port in `utility-ports-v2.js` (C3 — validation will refuse otherwise).
4. Optional: research gate (`src/data/research.js` — must satisfy the two-way contract, C5), 3D geometry (see below), port anchor (`utility-port-anchors.js`).
5. Run `npm test`. Content problems throw at import, so failures point at the def.
No changes to `placeables/index.js` are needed — the per-kind def files sweep their raw registry.

### Adding a utility type
1. New descriptor in `src/utility/types/<name>.js`: `type`, `color`, `geometryStyle`, `capacityUnit`, `costPerSubUnit`, `bridgesAdjacent`, `persistentStateDefaults`, `solve(network, persistent, worldState)`.
2. Import + array entry in `src/utility/registry.js` (the only wiring point).
3. `UTILITY_TO_QUALITY_FIELD` in `src/game/utility-gate.js:58`, plus `HARD_REQUIRED_UTILS`/`UNCONNECTED_CODES` if it should trip the beam, plus `UTILITY_PHYSICAL_FIELDS` if it carries a physical quantity (choose `worst` fail-closed, T3).
4. `SINK_DEFAULTS`/`SOURCE_DEFAULTS` in `src/data/utility-ports-v2.js`, then declare ports on components.
5. A `utilityLineTools` entry on the relevant `MODES.infra` category and an `INFRA_DISTRIBUTION` key (`src/data/modes.js`).
6. Test file `test/test-utility-solve-<name>.js` mirroring an existing one.

### Adding a 3D builder for a beamline component
1. Write `_build<Type>Roles()` in `src/renderer3d/component-builder.js` (or a file in `builders/`) returning role→`BufferGeometry[]` buckets — **not** a Group; that is the legacy `DETAIL_BUILDERS` shape.
2. Register it: `ROLE_BUILDERS.<typeId> = _build<Type>Roles`. That alone flips `isDetailedComponent` (P4) and removes the id from the fallback coverage report.
3. Bake `BEAM_HEIGHT` into the geometry — both builder families do, and `_createObject` assumes it (`component-builder.js:4089`).
4. Templates are cached per type and materials are shared: **do not dispose geometry or base materials** from a builder (`component-builder.js:4128-4160`).
5. THREE is a CDN global — do not import it.

### Adding a new snapshot section / world builder
1. Add a `buildX(game)` to `src/renderer3d/world-snapshot.js` and register it in `SECTION_BUILDERS` (`:465`). It must be a pure read of state.
2. Add a builder class taking that section, gated on `contentKey(section)` (P2). Anything that affects its output must be *in* the section.
3. Wire it in `ThreeRenderer.applySnapshot` (full rebuild) **and** in the partial `_refreshX` that owns the events which change it, via `_updateSnapshot(['x'])`.
4. Never read `game.state` from the builder (P1).

### Adding a field to a content def
1. Add it to the raw registry entry; if the per-kind def file normalizes (`placeables/dims.js`), extend there.
2. Add a check to `src/data/validate.js` if a malformed value would degrade silently — that is the file's whole purpose.
3. If the renderer consumes it, add it to the relevant `world-snapshot.js` section builder, or the builder will never rebuild when it changes (P2).
4. If it must survive a save, it rides inside `placeables`, which is already in `SERIALIZED_FIELDS` — new top-level `state` fields need an explicit entry (Z1).
