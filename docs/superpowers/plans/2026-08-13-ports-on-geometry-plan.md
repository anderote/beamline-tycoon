# Plan — utility ports on the geometry

Design: `docs/superpowers/specs/2026-08-13-ports-on-geometry-design.md`

Three tasks. 1 and 2 touch disjoint files and can run in parallel; 3 depends on 1.

---

## Task 1 — anchors land on the measured shell

**Files:** `src/utility/ports.js`, `src/utility/port-anchors.js`,
`src/data/utility-port-anchors.js` (doc comment + schema only),
`src/renderer3d/component-builder.js`, `src/renderer3d/ThreeRenderer.js`

### 1a. `src/utility/ports.js` — expose the local frame

Two new exports, both pure, both derived from logic already inside
`portWorldPosition` (factor it, don't duplicate it — `portWorldPosition`'s
returned numbers must not change):

```js
export function placeableCenterWorld(placeable, def)
// → { x, z } world centre of the footprint, or null.
//   This is the `cx`/`cz` already computed in portWorldPosition.

export function portLocalAxis(def, portName)
// → { axis: 'x' | 'z', sign: 1 | -1 } in the component's UNROTATED frame, or null.
//   spec.side left→{x,-1} right→{x,+1} back→{z,-1} front→{z,+1},
//   matching SIDE_TO_COMPASS + COMPASS_VEC with dir 0.

export function footprintHalfExtents(def)
// → { x, z } local half-extents in metres, i.e. subW*0.25 and subL*0.25
//   (local, so NO dir swap — the swap belongs to the world-space rotation).
```

### 1b. `src/renderer3d/component-builder.js` — measurement

- `getModelBounds` returns `{ minX, maxX, minY, maxY, minZ, maxZ }`. Existing
  callers read `minY`/`maxY` only, so this is additive.
- New export:

```js
export function measureShellSurfaces(compType, requests)
// requests: Array<{ key, axis: 'x'|'z', sign: 1|-1, y: number, along: number }>
// → Map<key, number|null>  distance in metres from the local origin to the
//   first surface hit, measuring inward along `axis * sign` at height `y` and
//   longitudinal offset `along` on the perpendicular axis.
```

Implementation: instantiate the type's model **once** per call (same
instantiate path `getModelBounds` uses — `ROLE_BUILDERS` /`DETAIL_BUILDERS` /
`_buildPartsOrFallback`), raycast each request from just outside the model's
bounding box inward, dispose the model at the end. Returns an empty Map when
THREE is absent or the type has no model. Cache the whole result per
`compType` + a hash of the request list, so a type is instantiated once for the
lifetime of the process.

Ray origin: start at `bounds.max/min` on the measuring axis plus 1 m of margin,
pointing inward. Take the **first** hit. Null when nothing is hit (the port's
height is above or below the model).

### 1c. `src/utility/port-anchors.js` — the new resolution

Add a second provider alongside the bounds one:

```js
export function setShellMeasureProvider(fn)   // fn = measureShellSurfaces
```

`portAnchor3D(placeable, def, portName)` keeps its signature and its return
shape (`{ x, y, z, out, standoff }`) and is re-derived as:

1. `centre = placeableCenterWorld(placeable, def)`
2. `{ axis, sign } = portLocalAxis(def, portName)`
3. `y` — unchanged: authored → derived mid-shell → `DEFAULT_ANCHOR_Y`
4. `along` (local metres on the axis perpendicular to `axis`):
   authored `along` → from `spec.offsetAlong` lerped across the model bounds on
   that axis → `0`. Clamp to ±`footprintHalf` on that axis.
5. `lat` (local metres along `axis`): authored `lat` → measured surface →
   bounds half-extent on `axis` → `footprintHalf` on `axis`. Clamp to
   `[0.05, footprintHalf]`.
6. Local offset `{x,z}` from (`axis`,`sign`,`lat`,`along`), **rotated by
   `placeable.dir`** (90° steps, same convention as `rotateCompass`), added to
   `centre`.
7. `out` — unchanged, from `portApproachVec` (already rotated).
8. `standoff` — unchanged.

Cache the resolved `{lat, along}` per `type:portName`; invalidate whenever
either provider is re-registered.

**Fallback contract, load-bearing:** with both providers null and no authored
`lat`/`along`, steps 4–6 must reproduce `portWorldPosition(placeable, def,
portName)` exactly for every `dir`. This is what keeps the node test suite and
every headless path unchanged.

### 1d. Schema + registration

- `src/data/utility-port-anchors.js`: document the two new optional per-port
  fields (`lat`, `along`, both local metres) in the header comment. Do **not**
  author values yet — measurement covers every type. Leave the existing `y`/
  `out` table untouched.
- `src/renderer3d/ThreeRenderer.js`: next to the existing
  `setModelBoundsProvider(getModelBounds)` call (~line 333), register
  `setShellMeasureProvider(measureShellSurfaces)`.

---

## Task 2 — connectors that look like their utility

**File:** `src/renderer3d/builders/port-fitting-builder.js` (only)

Replace the single collar+spigot with six styles keyed by utility type. Keep
the module's existing character: small, desaturated, hardware not UI, THREE as a
CDN global (do not import it), materials shared via the existing `_matCache`.

- `buildPortFitting(anchor, utilityType)` — the second parameter becomes the
  utility type rather than a colour; it resolves the colour from
  `UTILITY_TYPES[utilityType].color` itself. `buildPortFittings` passes
  `spec.utility`.
- Each style's geometry is authored **once** in the local +X-facing orientation,
  merged into a single `BufferGeometry` with the same merge helper
  `component-builder.js` uses for its buckets, and cached by utility type. A
  fitting is then **one** `THREE.Mesh` with shared geometry + shared material,
  positioned at the anchor and rotated onto `anchor.out` (keep the existing
  quaternion-from-unit-vectors approach, and keep the vertical fallback for a
  zero normal).
- Styles, all roughly within the current 0.075 m collar radius / 0.1 m
  projection envelope so a hall of them still reads as detail:
  - `powerCable` — conduit gland into a small junction box
  - `coolingWater` — plate with twin supply/return hose barbs
  - `cryoTransfer` — vacuum-jacketed bayonet: fat outer jacket, thin inner line
  - `rfWaveguide` — rectangular waveguide flange with a ring of bolt bumps
  - `vacuumPipe` — CF flange: knife-edge ring with bolt heads
  - `dataFiber` — small gland with a service loop
  - unknown utility — the current collar+spigot, as the fallback
- `buildPortFittings` and `portFittingSignature` keep their signatures.

---

## Task 3 — tests (after Task 1)

**Files:** `test/test-port-anchors.js`, `test/browser/port-fittings.spec.mjs` (new)

Node suite, rewriting section 1 and adding to it:

- **headless identity** — with both providers null, `portAnchor3D().x/z` equals
  `portWorldPosition()` exactly, for every utility port in `COMPONENTS`, at
  every `dir` 0–3. (This replaces the old unconditional assertion.)
- **the anchor moves onto the shell** — with a fake measure provider reporting a
  surface well inside the footprint, the anchor is strictly closer to the
  component centre than `portWorldPosition` is, and is still on the correct
  side.
- **never outside the footprint** — a fake provider reporting an absurd surface
  distance still clamps to the footprint half-extent.
- **`offsetAlong` displaces along the model** — a port with `offsetAlong: 0.8`
  and a fake bounds box lands off-centre on the perpendicular axis, on the
  correct end; `0.5` lands at the centre.
- **authored wins** — an authored `lat`/`along` beats the measured value.
- **rotation** — the same port on the same type at `dir` 0/1/2/3 produces four
  distinct world anchors, each still at the same local offset from its centre.

Sections 2–4 of the existing file (heights, override-table integrity, normals)
stay as they are.

Browser spec (`test/browser/port-fittings.spec.mjs`), following the existing
helpers in `test/browser/helpers.mjs`: place a cryomodule, read the fitting
group's world positions out of the renderer, and assert each sits within the
drawn model's silhouette — inside the measured bounds on the lateral axis,
rather than out at the footprint edge.

---

## Verification

- `npm test` — full node suite green, with particular attention to
  `test-port-anchors`, `test-utility-ports`, `test-junctions`,
  `test-utility-line-geometry`, `test-utility-placement-endpoints`.
- `npx playwright test test/browser/port-fittings.spec.mjs` for the visual
  invariant.
- No dev server is started; the user checks the look in their own running one.

## Acceptance

- A placed cryomodule's cryo, RF, power and vacuum connectors are on its
  cryostat, at different points along it, each looking like its own kind of
  connector.
- Unwired pins stand on the machine they are complaining about.
- Cables terminate at a connector.
- Nothing in the sim moved: network topology, snapping, pathing and cost are
  bit-identical.
