# Lighting Quality Overhaul — Implementation Plan

**Date:** 2026-08-14
**Status:** In progress

## Goal

Turn the existing lighting foundation into a cohesive, high-quality system:
physically coherent fixture coverage, stable soft shadows, layered soft glow,
volumetric beams, dynamic fixture character, and predictable performance from
low-end through high-end hardware.

The target remains Beamline Tycoon's low-resolution dimetric art direction.
Effects should feel like light moving through an industrial facility, not a
generic high-resolution post-processing filter placed over pixel art.

## Existing foundation to preserve

- One simulation-owned day/night clock and one shared darkness ramp.
- Nine data-driven facility fixtures across ground, wall, and overhead mounts.
- A fixed-size real-light rig that never changes shader light counts at runtime.
- Merged painted floor pools and stable crossfades between lighting tiers.
- Selective bloom for explicitly tagged emissive geometry.
- Simulation-gated utility flow and short-lived impulse lights.
- A player-facing escape hatch for expensive lighting.

## Governing rules

1. **One projection model.** Painted pools, real spotlights, fixture geometry,
   beam volumes, and tests derive from the same emitter/target calculation.
2. **Fixed shader topology.** Real lights and volume slots are allocated once.
   Runtime work moves, retints, fades, or parks them.
3. **Stable handovers.** No light may pop, strobe, or radically change coverage
   as it moves between the painted and real-light tiers.
4. **Effects follow simulation state.** Night, power/fault state, and fixture
   type drive lighting. Random animation is deterministic per fixture.
5. **Quality scales by cost.** Resolution, update frequency, shadow count, and
   volumetric count vary by preset without changing gameplay or save data.
6. **Measure before increasing budgets.** Every expensive stage gets counters,
   deterministic tests, and an off switch.

## Performance budgets

Budgets are expressed relative to the existing half-resolution scene render.
They are initial shipping targets and must be checked on real hardware.

| Preset | Fixture shadow slots | Shadow map | Shadow refresh | Glow | Volumetric beams |
|---|---:|---:|---:|---|---:|
| Low | 0 | — | — | tight, quarter-res | 0 |
| Medium | 2 | 512 | staggered 10 Hz | tight + soft | 1 |
| High | 4 | 1024 | staggered 15 Hz | tight + soft | 3 |
| Ultra | 6 | 1024 | staggered 30 Hz | tight + soft | 6 |

Additional constraints:

- The sun shadow remains one map, but refresh is scheduled rather than blindly
  repeated in every render pass.
- Bloom continues to run against the `_pixelScale` buffer; broad glow may use a
  further downsampled buffer.
- Volumetric beams render as pooled proxy geometry. No full-screen ray marcher.
- No shadow-casting point lights; local shadows stay single-pass spotlights.
- `renderer.info.programs.length` must remain stable while panning, toggling
  presets, handing lights over, and spawning flashes.

## Phase 1 — projection correctness and stable allocation

### 1.1 Shared projection model

Create `src/renderer3d/fixture-light-math.js`, pure and Three-free.

It produces a normalized packet for each fixture:

```js
{
  emitter: { x, y, z },
  target: { x, y, z },
  direction: { x, y, z },
  distance,
  halfAngle,
  penumbra,
  groundFootprint,
}
```

Downlights derive the cone angle and attenuation distance from emitter height
and desired floor radius:

```text
halfAngle = atan(poolRadius / emitterHeight)
distance  = hypot(poolRadius, emitterHeight) + falloffMargin
```

Aimed floods derive their target and pool polygon from ray/ground-plane
intersections. Invalid or horizon-parallel rays degrade to a bounded fallback,
never Infinity/NaN.

Both `lighting-builder.js` and `light-rig.js` consume this packet. Remove the
independent ellipse constants once parity tests cover the new path.

### 1.2 Fixture schema cleanup

Clarify authored fields in `src/data/placeables/lighting.js`:

- `poolRadius`: desired downlight floor radius.
- `beamAngleDeg`: full cone angle when explicitly authored.
- `tiltDeg`: angle away from straight down.
- `targetDistance`: optional horizontal aim distance for floods.
- `sourceRadius`: apparent emitter size for glow/shadow tuning.
- `shadowSoftness`, `bloomProfile`, `volumeProfile`, `dynamicProfile`.

Retain temporary aliases only if existing code/tests need a staged migration.
Validation rejects contradictory or non-finite profiles.

### 1.3 Correct candidate scoring

Pass the world-space camera focus point into `LightRig.update`. Score candidates
in this order:

1. inside the camera frustum;
2. fixture priority and visible projected influence;
3. distance to camera focus;
4. stable fixture id tie-break.

Keep rank slack, minimum hold time, and crossfade behavior.

### 1.4 Hybrid handoff

The painted pool becomes low-frequency indirect spill and remains faintly
visible under a real light. Real slots suppress only the calibrated direct
portion instead of deleting the pool completely. A handoff therefore adds
wall/object illumination and shadows without changing the footprint.

### Acceptance

- Pure tests prove projection/pool parity for all nine fixture definitions and
  all four rotations.
- No real-light handoff changes the pool's center or extent by more than the
  documented tolerance.
- Flood geometry, painted pool, real cone, and volume point the same direction.
- Offscreen fixtures cannot displace an onscreen fixture solely because the
  camera itself is offset from its focus point.

## Phase 2 — shadows and quality presets

### 2.1 `LightingQuality` presets

Create `src/renderer3d/lighting-quality.js` with immutable presets and a pure
resolver. `auto` selects a starting preset from renderer capabilities and can
step down after sustained frame pressure; explicit player choices never move.

Changing presets does not add/remove Three lights. The rig allocates the Ultra
maximum once and parks slots beyond the active preset.

### 2.2 Shadow scheduler

Create `src/renderer3d/shadow-scheduler.js`.

- Each light uses `shadow.autoUpdate = false`.
- The scheduler sets `shadow.needsUpdate` only for a scheduled slot.
- Assignment, significant light movement, camera-focus movement, caster rebuild,
  or elapsed refresh interval marks a slot dirty.
- Updates are staggered so all local maps never refresh on the same frame.
- Parked/daylight slots never render a shadow map.
- The sun refreshes on meaningful orbit/target movement and world changes.

### 2.3 Softness

Start with tuned PCF filtering and per-profile bias/normalBias. Add a receiver-
plane/contact-softening shader patch only if the result survives the pixel-scale
render and remains inside budget. Do not switch the entire renderer to VSM
without measuring its extra blur passes and light-bleeding artifacts.

Fixture `penumbra` controls cone edge softness; `sourceRadius` controls the
shadow profile exposed to the selected filter.

### Acceptance

- Zero-intensity and parked fixtures perform zero shadow renders.
- Shadow updates per frame obey the active preset budget.
- Panning and slot reassignment do not cause shader recompiles.
- Contact shadows remain attached without obvious acne, peter-panning, or
  swimming at the normal play zooms.

## Phase 3 — HDR grading and layered glow

### 3.1 Controlled HDR rolloff

Enable a filmic tone mapper (`AgX` when supported by the pinned Three version,
otherwise ACES) and explicitly configure exposure/output color space. Retune
day/night light intensities and emissive values in linear space.

Provide a temporary comparison flag during implementation. Remove it after
materials and UI colors are verified; do not ship two incompatible grades.

### 3.2 Two selective glow profiles

Split glow membership into:

- **tight glow:** indicators, screens, cathodes, utility pulses;
- **soft glow:** fixture emitters, windows, high-energy equipment, beam volumes.

Each profile owns strength, radius, threshold, smooth knee, and render scale.
Composite both before the final tone/output pass. Keep non-glow material
darkening exception-safe with `try/finally` restoration.

### 3.3 Per-emitter controls

Emitter metadata controls core intensity, halo size, soft-glow contribution,
and daytime floor. Replace radius-derived billboard sizing with source-size data.
Windows use a dedicated low-frequency profile instead of behaving like opaque
white emissive panels.

### Acceptance

- Bright warm/cool lights retain hue instead of clipping immediately to white.
- Indicator lights stay crisp while large fixtures can have wide, soft haze.
- Bloom-off rendering restores every material and shadow setting after errors.
- Existing UI/view-cube canvases retain their intended color appearance.

## Phase 4 — volumetric beams and dynamic effects

### 4.1 Pooled beam volumes

Create `src/renderer3d/volumetric-light-pool.js` and
`src/renderer3d/volumetric-light-material.js`.

Allocate the Ultra maximum number of cone/frustum meshes once. Assign them to
visible floods/high-bays using the same score and projection packet as real
spots. The shader supplies:

- soft radial and longitudinal falloff;
- deterministic low-frequency density noise;
- depth testing and camera-aware edge fading;
- day/night and slot crossfade;
- optional cookie modulation;
- dithering appropriate to the low-resolution buffer.

Volumes do not write depth and never render for ordinary omnidirectional lamps.
They are atmospheric cues, not opaque cones.

### 4.2 Light cookies

Generate small procedural textures for flood, panel, high-bay, and cage
patterns. Apply to spotlight maps where supported and use the same texture in
the volume shader. Cookies are cached and disposed once with the renderer.

### 4.3 Dynamic fixture profiles

Add deterministic effects:

- fluorescent/high-bay start-up flutter at dusk;
- subtle industrial mains shimmer, below distraction threshold;
- fault/brownout flicker driven by simulation state when available;
- warm sodium ramp versus instant LED/office-panel response;
- existing flash impulses retained and integrated with exposure/glow.

No per-frame random allocation. Each fixture phase comes from a stable id hash.

### Acceptance

- Rays remain aligned with both their fixture model and illuminated footprint.
- Volume slots crossfade without popping when reassigned.
- Effects are reproducible across save/load and do not alter simulation state.
- Low preset performs no volumetric work.

## Phase 5 — controls, observability, and regression coverage

### 5.1 Player controls

Replace the binary option with:

- Lighting quality: Auto / Low / Medium / High / Ultra.
- Bloom: on/off.
- Volumetric beams: on/off, disabled when preset budget is zero.

The old stored boolean migrates locally: off becomes Low + bloom off; on becomes
Auto. These remain local preferences, not save data.

### 5.2 Debug instrumentation

Expose a development-only lighting panel or snapshot API reporting:

- active/allocated fixture spots and ambient points;
- active volume slots;
- shadow maps refreshed this frame and per second;
- bloom render sizes;
- renderer calls/triangles/program count;
- current quality preset and automatic downgrade reason.

### 5.3 Automated coverage

Node tests:

- projection and ground-intersection math;
- schema/profile validation;
- deterministic scoring and handoff;
- preset resolution and pool invariants;
- shadow scheduling;
- dynamic waveform determinism;
- volumetric slot allocation.

Browser tests:

- deterministic noon, dusk, and midnight scenes;
- glow/volume/preset toggles without errors or blank frames;
- stable program count through pans, handovers, flashes, and preset changes;
- screenshot baselines for a compact lighting showcase scene;
- explicit WebGL context and frame-completion assertions.

### 5.4 Manual visual matrix

Review each fixture at noon/dusk/midnight, at near/default/far zoom, against:

- terrain, floors, walls, windows, equipment, staff, and transparent objects;
- isolated fixture and overlapping fixtures;
- all camera rotations;
- each quality preset;
- powered, faulted, and brownout states where applicable.

## Commit sequence

1. `docs: plan lighting quality overhaul`
2. `fix(render): unify fixture light projection and selection`
3. `perf(render): schedule shadows and add lighting quality presets`
4. `feat(render): add filmic grading and layered soft glow`
5. `feat(render): add pooled volumetric fixture beams`
6. `feat(render): add dynamic fixture profiles and lighting controls`
7. `test(render): add lighting visual and performance regression coverage`
8. Final tuning/fixes grouped by the subsystem they affect.

## Definition of done

- All phases and acceptance criteria above are satisfied.
- Full Node suite and production build pass.
- Relevant browser suite passes with software WebGL.
- Visual matrix is completed on an attached browser/GPU when available.
- New worktree is clean, with coherent commits and no unrelated changes.
