# LOD performance review — September 2026

Reviewed baseline: `6af0efbe`. Measurements below are headless Node CPU and
scene-structure measurements, not browser FPS or GPU timings.

## Existing LOD results

`node scripts/benchmark-minor-lab.mjs --json --iterations=3` exercises the stock
Minor Lab scene through production builders. Before and after this change its
render counts were identical:

| Presentation | Draw calls | Triangles | Shadow draws |
| --- | ---: | ---: | ---: |
| Near | 2,035 | 1,241,740 | 1,107 |
| Far | 182 | 138,484 | 49 |

The current system already removes about 91% of draw calls and 89% of triangles
at far zoom. It retains authored silhouettes/colors, zoom hysteresis, idle
preparation, and staged transitions. Further simplification should be guided by
visual profiling rather than reducing these budgets indiscriminately.

## Implemented improvement

`createFarMergedMesh` previously cloned and transformed every instance before
copying all resulting attributes into final merged buffers. It now copies each
source attribute directly into its destination and transforms a view of that
buffer. This avoids temporary geometry copies and per-instance bounds scans.
Only the final merged bounds are calculated. Three's own attribute operations
still handle positions, normals and tangents.

An isolated comparison used 400 translated copies of a non-indexed
`SphereGeometry(1, 16, 12)` with float RGB colors and precomputed bounds. Old and
new implementations alternated execution order, with six warmup rounds and 20
measured rounds. Median merge CPU time was **15.67 ms before / 9.07 ms after**.
The eliminated temporary attribute buffers totaled **18,585,600 bytes** for that
fixture, excluding geometry object overhead. This is a synthetic merge result,
not a whole-game speedup claim.

Three-iteration Minor Lab scene-build means were 431 ms before / 318 ms after;
first-far-transition means were 8.95 ms before / 9.47 ms after. These small,
separate samples do not establish a reliable whole-scene timing improvement.
The deterministic gains are reduced copying/allocation and unchanged output.

Public-boundary tests cover indexed and non-indexed geometry, rotation and
nonuniform scale, normals/tangents, normalized colors, UVs, source ownership,
bounds, triangle-to-object picking, and 32-bit index promotion.

## Next profiling targets

Near-view utility geometry contributes 764,224 triangles (about 62% of the
scene), across 279 draws. Profile its tessellation and screen-space contribution
first if close-up views are GPU-bound. Keep route shapes and picking intact.

Near components, equipment and decorations contribute 785, 439 and 419 draws,
respectively, plus 449, 277 and 324 shadow draws. Material-compatible near
batching or a separate shadow-detail budget may help if submission or shadow
passes dominate. Changes here must preserve effects, selection and lighting.

Far batches merge many world objects into a single bounds volume. On larger
facilities, measure offscreen work before considering spatial chunking: chunks
can improve culling but increase draws. Existing plant and utility chunking
provides precedents. Minor Lab alone does not establish the correct tradeoff.

## Validation and remaining checks

Focused merge and Minor Lab render-budget tests, the fast lane and production
build passed. The complete non-browser suite is the integration gate.

Browser operation was not authorized for this task. Remaining owner checks:
profile cold Continue, first zoom across both LOD boundaries, rapid wheel
reversals, and close-up utility-heavy views; inspect colors, highlights and
picking across transitions. Compare CPU/GPU frame-time distributions on the
same device and save. Use the isolated ephemeral-server workflow in AGENTS.md.
