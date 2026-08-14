# Utility ports on the geometry

## The problem

Utility connectors float in mid-air beside the machines they belong to.

`portAnchor3D` (`src/utility/port-anchors.js`) is half model-aware. Its **y** is
measured against the real model — `src/data/utility-port-anchors.js` holds a
carefully authored height per component, taken by walking each type's builder
headless. Its **x/z** come straight from `portWorldPosition`, which returns a
point on the **tile footprint** edge:

```js
const halfAlongX = footColSub * 0.25;   // footprint, not mesh
```

For an on-pipe placement the footprint is the reserved beam corridor, and the
corridor is much wider than the machine. A cryomodule declares `subW: 4` — a 2 m
footprint — so `cryo_in` and `rf_in` anchor at ±1.0 m from the beam axis, while
the drawn cryostat is `vesselR = cellPeakR + 0.09`, roughly ±0.45 m. Every
fitting, unwired pin and cable end therefore lands about half a metre out on
bare floor. The same error is present but smaller on `subW: 2` parts.

Second cause: `offsetAlong` is declared on every port in `utility-ports-v2.js`
and never read. `portWorldPosition` always returns the face midpoint, so on a
16-sub (8 m) cryomodule `cryo_in` (0.5) and `rf_in` (0.8) resolve to the same
point, nowhere near the coupler the model actually draws.

Third: the connector itself is one generic collar-and-spigot for all six
utilities, so even when it lands correctly it reads as a UI blob rather than as
a waveguide flange or a cryogenic bayonet.

## The goal

A utility port is a piece of hardware bolted to the component's shell. It should
sit **on** the mesh, at the right height, at the right point along the machine,
and look like the kind of connector that utility actually uses.

## Design

Three parts. The sim is untouched throughout: `portWorldPosition` keeps
returning the footprint point, and network topology, snapping, pathing, overlap
and pricing keep reading it. Only `portAnchor3D` — the presentation anchor —
moves. `portAnchor3D` has no callers outside `src/renderer3d/`.

### 1. Measure the shell, don't assume the footprint

Anchor resolution moves into the component's **local, unrotated** frame and is
rotated by `dir` at the end, the way the side already is.

- `getModelBounds` returns the full box (`minX/maxX/minY/maxY/minZ/maxZ`); it
  currently drops the mins on X and Z.
- A new renderer-side primitive raycasts the cached model from outside inward
  and reports where its surface actually is at a given height and longitudinal
  offset. This is height-aware, which a bounding box is not: a magnet with a
  wide base and a narrow yoke gets its port on the yoke, not out past the skirt.
- `port-anchors.js` owns the port knowledge and asks for the measurement. It
  caches one mount per (type, port).

Resolution order for the lateral distance, first hit wins:

1. authored `lat` in `utility-port-anchors.js`
2. raycast surface at the port's authored height
3. model bounds half-extent on that axis
4. footprint half-extent — today's number

The longitudinal offset comes from the port's declared `offsetAlong` mapped onto
the model's measured extent along that axis, or an authored `along`. Both are
clamped inside the footprint so a connector can never poke into a neighbouring
tile.

**Headless is byte-identical.** With no bounds provider and no measurement
provider — tests, and any path without THREE — the chain falls through to the
footprint half-extent and a zero longitudinal offset, which reproduces
`portWorldPosition` exactly.

### 2. Connectors that look like their utility

`port-fitting-builder.js` grows one connector style per utility instead of one
generic fitting for all six:

| Utility | Connector |
|---|---|
| `powerCable` | conduit gland into a small junction box |
| `coolingWater` | twin supply/return hose barbs on a plate |
| `cryoTransfer` | vacuum-jacketed bayonet — fat jacket, thin inner line |
| `rfWaveguide` | rectangular waveguide flange with a bolt ring |
| `vacuumPipe` | CF flange: knife-edge ring with bolt heads |
| `dataFiber` | small gland with a service loop |

Each style's geometry is built **once**, merged, cached, and oriented along +X;
a fitting is then a single mesh with a shared geometry and a shared material,
rotated onto the port's outward normal. That is fewer draw calls than the two
meshes per fitting the current generic builder emits, which matters because
fittings are always on and a built-out hall has hundreds.

They stay small and desaturated. These are hardware detail, not UI.

### 3. Everything downstream follows for free

The unwired-sink pins, the available-port dots and the cable endpoints all read
`portAnchor3D` already. Fixing the anchor fixes all three: the pin now stands on
the machine, and a cable now terminates at a connector instead of stopping in
mid-air beside one.

## Testing

`test/test-port-anchors.js` currently asserts that the anchor's x/z is exactly
`portWorldPosition`. That invariant is what we are deliberately breaking in the
presentation layer, so it is replaced by two narrower ones:

- with no providers registered, x/z is exactly `portWorldPosition` (the headless
  fallback is unchanged)
- with providers registered, the anchor moves **toward** the component axis and
  never outside the footprint

plus new coverage for `offsetAlong` displacement, authored `lat`/`along`
winning over measurement, and the clamps. The existing height, override-table
and rotation sections stand as they are.

A browser check asserts the fittings for a placed cryomodule land inside its
drawn silhouette rather than out on the floor.
