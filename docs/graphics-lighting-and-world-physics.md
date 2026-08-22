# Graphics, lighting, and world physics

This document describes the structural upgrade introduced by
`agent/world-physics-many-lights`. It preserves the authored isometric pixel
look and game-state model while replacing the renderer boundary, indoor-light
budget, and incident physics underneath them.

## Renderer boundary

The main world uses Three's node-based `WebGPURenderer`. It selects native
WebGPU when the browser exposes it and otherwise uses Three's WebGL 2 backend
through the same TSL/node-material API. `?renderer=legacy` deliberately forces
that WebGL 2 backend as the rollback path; small thumbnail and view-cube
canvases still use the old `WebGLRenderer` because they do not consume migrated
world materials.

This matters more than calling raw OpenGL from JavaScript. Browsers expose
WebGL rather than desktop OpenGL, and Three already owns the scene graph,
materials, asset lifecycle, picking, and camera. The useful structural win is
a modern GPU-data path behind that API, not replacing the whole game renderer.

## Many-light architecture

The modern path ranks up to 64 real indoor fixture lights around the camera.
All 64 participate in PBR material lighting. Their parameters are uploaded in
packed uniform arrays rather than one GPU binding per light, avoiding common
WebGPU binding-count limits.

The nearest/highest-value subset of up to 12 lights casts real dynamic
shadows. Those shadow maps live in one shared depth-texture array and each
dirty layer is rendered independently. The array is cached and serviced by a
global refresh queue; each quality preset independently selects its active
layer count, map size, and aggregate refresh rate. New assignments and scene
changes enter the same one-layer-per-frame queue, so dusk cannot recalculate
every active fixture in one frame. A light can
therefore remain visually real when it leaves the shadow subset instead of
blinking out entirely, while its inactive shadow contribution is explicitly
zeroed so it cannot sample a stale layer.

A **projected light pool** is only the soft painted footprint/halo placed on a
surface beneath a fixture. It is a cheap art layer that makes distant or
unselected fixtures still read as illuminated. It is not a light source and
does not shade arbitrary geometry or cast shadows. The modern 64-light path is
the real-light layer; projected pools are optional presentation support.

Fixtures do not draw visible volumetric cone meshes. Real lights, emissive
sources, bloom, halos, cookies, shadows, and projected surface pools provide
the illumination without placing translucent cone geometry in clear air.

Current maximum budgets:

| Resource | Modern maximum | Notes |
| --- | ---: | --- |
| Real fixture lights | 64 | Camera-ranked, packed GPU data |
| Shadowed fixture lights | 12 | Cached shared depth array |
| Dynamic point/effect lights | 32 | 30 camera-ranked utility-flow/machine-glow slots plus 2 flash reserves |

Use `window.dev.lightingStats()` to inspect the selected backend, candidates,
assigned lights, shadow layers, and update work. Use `?renderer=legacy` to
compare or immediately roll back.

## World rigid-body physics

World interactions use Rapier, a Rust rigid-body engine compiled to WebAssembly.
It runs at a fixed 60 Hz with an accumulator and a capped number of catch-up
steps. Authored equipment, furnishings, beamline components, and decorations
are registered lazily as dormant fixed bodies only when an incident starts.
Normal construction therefore carries no object colliders or active solver
islands. An incident promotes only nearby bodies to dynamic ones, and atomic
restoration releases the authored bodies again.

The collision world contains:

- the exact rendered terrain triangle mesh, including per-corner slopes;
- conservative box colliders for movable authored objects;
- fixed wall colliders that contain debris;
- articulated eight-body staff ragdolls with spherical joints;
- independently simulated leaf-mesh fragments for multipart objects, capped at
  96 fragments globally and 12 per source object.

Small stackable equipment and furnishings also use the rigid-body world for a
bounded placement effect. After the ordinary placement transaction selects a
valid floor or surface sub-cell, the committed model is released a short
distance above that pose and falls onto a temporary support collider. When it
sleeps (or reaches the timeout), presentation restores the exact canonical
transform and releases both temporary bodies. This gives oscilloscopes and
similar benchtop objects physical weight without allowing solver drift to
change stack parentage, occupancy, saves, undo history, or utility endpoints.
Beamline hardware and other non-portable placeables do not use this path.

Explosions use radial falloff, upward bias, linear impulse, and torque. Nearby
staff become articulated ragdolls. Multipart equipment can separate along its
authored parts; single-shell art tumbles intact rather than inventing fake
fracture seams. The renderer keeps one atomic incident snapshot so temporary
ragdolls, fragments, transforms, velocities, visibility, and body activation
can be restored together.

Gameplay code can trigger this without touching renderer internals:

```js
game.emit('worldExplosion', {
  position: { x: 12, y: 1, z: 8 },
  options: { radius: 7, strength: 90 },
});
game.emit('worldPhysicsUndo');
```

For effect development, selecting a rendered placeable and pressing `Backspace`
triggers the same reversible incident at the object's visual center. It does
not remove the canonical placeable or write damage into the save; persistent
fire, blast damage, and chain reactions belong to a future simulation-owned
incident system.

For development, the equivalent helpers are
`window.dev.explode(position, options)`, `window.dev.undoPhysics()`, and
`window.dev.physicsStats()`.

## Uniform density, mass, and center of mass

Every registered object's visible triangles are integrated as tetrahedra in
the object's local frame. Closed shells produce their volume and geometric
centroid. Multiple shells are combined by volume without allowing opposite
winding to cancel them. Open or degenerate artwork falls back to its bounding
box. The current inertia tensor is a stable box approximation around the
measured visual bounds.

Content may specify a realistic known weight as `physicsMassKg`. The system
then derives effective uniform density as `mass / measured volume`, while the
geometry-derived centroid remains the center of mass. Alternatively,
`physicsDensityKgM3` can be authored. If neither is present, effective bulk
density defaults are selected by kind (staff, furnishings, equipment,
beamline, decoration, and common materials). “Effective bulk” is intentional:
a hollow oscilloscope should not receive solid-steel density just because its
case looks metallic.

These two optional fields are content-authoring controls, not required runtime
data. They let a designer correct a visually unusual asset without writing a
collider or moving a pivot.

## Scope and practical limits

This is a real structural foundation, but it is not a claim that every asset is
already a hand-authored destruction model. Automatic boxes are intentionally
stable and inexpensive; high-value assets can later add compound/convex
colliders, joint limits, break thresholds, and authored fracture groups. The
simulation is presentation state rather than canonical save state, preventing
an explosion effect from silently corrupting construction occupancy, beamline
connectivity, or undo history.

The likely next gains are profiling on representative low-end integrated GPUs,
authoring explicit masses for recognizable equipment, adding compound
colliders to large beamline modules, and connecting damage results to a formal
gameplay incident/repair model.
