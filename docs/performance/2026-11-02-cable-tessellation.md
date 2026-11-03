# Cable tessellation performance pass

Local review candidate; not deployed or promoted to master.

The saved Minor Lab benchmark uses 287 utility lines. Reducing near cable
longitudinal density from 8 to 4 samples/metre (cap 512 to 256) removes
49,968 triangles: utility triangles fall from 572,040 to 522,072 and total
near triangles from 1,049,556 to 999,588. Radial segments, spline control
points, floor clamping, UV distance, routing and far geometry are unchanged.
Draw counts remain 2,035 near and 182 far.

Five-iteration headless measurements found no meaningful CPU improvement:
utility construction 189.05 to 186.75 ms, full scene 327.38 to 324.82 ms.
These are diagnostic timings, not FPS or GPU evidence. JSON receipts are
adjacent. The near utility budget is tightened to 530,000 triangles.
The fixture's lower-bound sanity check now allows the optimized scene to
fall below a million triangles.

Before integration, visually review tight bends, short cables, long sagging
runs and floor contact at maximum zoom; profile actual GPU frame time on a
large facility. No browser gameplay or GPU measurements performed in this pass.
