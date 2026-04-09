# FODO Focus Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add energy-aware focus margin tracking and ghost quad placement suggestions to the beamline designer view.

**Architecture:** Python propagator computes `focus_margin` and `focus_urgency` per snapshot using existing beam size and aperture data. JS designer-renderer draws colored background bands on envelope plots and ghost quad markers on the schematic. BeamlineDesigner computes ghost positions by scanning the urgency array after each physics recompute.

**Tech Stack:** Python (beam_physics), vanilla JS (renderer, UI)

---

## File Structure

| File | Role | Change |
|---|---|---|
| `beam_physics/lattice.py` | Propagation engine | Add focus_margin + focus_urgency to snapshot extra dict |
| `beam_physics/gameplay.py` | Physics-to-game bridge | Pass new fields through envelope mapping |
| `src/renderer/designer-renderer.js` | Designer canvas rendering | Draw envelope color bands + ghost quad markers on schematic |
| `src/ui/BeamlineDesigner.js` | Designer state/logic | Compute ghost positions from envelope, handle ghost clicks |
| `test/test_focus_advisor.py` | Tests | New file for focus margin/urgency tests |

---

### Task 1: Add focus_margin and focus_urgency to Python snapshots

**Files:**
- Modify: `beam_physics/lattice.py:79-138` (propagate function, snapshot loop)
- Create: `test/test_focus_advisor.py`

- [ ] **Step 1: Write failing test for focus_margin in snapshots**

Create `test/test_focus_advisor.py`:

```python
"""Tests for focus margin and urgency fields in propagation snapshots."""
import unittest
from beam_physics.lattice import propagate


class TestFocusMargin(unittest.TestCase):
    def _simple_fodo(self):
        """FODO cell: source, quad, drift, quad, drift."""
        return [
            {"type": "source", "length": 0},
            {"type": "quadrupole", "length": 1.0, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 5.0},
            {"type": "quadrupole", "length": 1.0, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 5.0},
        ]

    def test_snapshots_have_focus_margin(self):
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertIn("focus_margin", snap)

    def test_snapshots_have_focus_urgency(self):
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertIn("focus_urgency", snap)

    def test_focus_margin_range(self):
        """Focus margin should be <= 1.0 (beam smaller than aperture)."""
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertLessEqual(snap["focus_margin"], 1.0)

    def test_focus_urgency_range(self):
        """Focus urgency should be clamped to [0, 1]."""
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertGreaterEqual(snap["focus_urgency"], 0.0)
            self.assertLessEqual(snap["focus_urgency"], 1.0)

    def test_long_drift_increases_urgency(self):
        """A very long drift without focusing should have high urgency at the end."""
        config = [
            {"type": "source", "length": 0},
            {"type": "drift", "length": 50.0},
        ]
        result = propagate(config)
        last = result["snapshots"][-1]
        self.assertGreater(last["focus_urgency"], 0.5)

    def test_focused_beam_has_low_urgency(self):
        """Right after a quad, urgency should be low."""
        result = propagate(self._simple_fodo())
        # Find first snapshot after first quad (element_index=1)
        post_quad = [s for s in result["snapshots"] if s["element_index"] == 1]
        if post_quad:
            self.assertLess(post_quad[-1]["focus_urgency"], 0.3)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python -m pytest test/test_focus_advisor.py -v`

Expected: FAIL — `focus_margin` and `focus_urgency` keys not in snapshots.

- [ ] **Step 3: Implement focus_margin and focus_urgency in lattice.py**

In `beam_physics/lattice.py`, add imports at the top (after existing imports):

```python
from beam_physics.constants import DEFAULT_APERTURE
```

Then in the `propagate()` function, add tracking state before the main element loop (after `n_focusing = 0`):

```python
    prev_max_sigma = None  # for divergence rate estimation
    prev_s = 0.0
```

Then modify the snapshot section inside the sub-step loop. Replace the existing snapshot append block:

```python
            context.snapshots.append(beam.snapshot(i, etype, context.cumulative_s, extra={
                "eta_x": float(context.dispersion[0]),
                "eta_xp": float(context.dispersion[1]),
            }))
```

With:

```python
            # Compute focus margin and urgency for FODO advisor
            aperture = element.get("aperture", DEFAULT_APERTURE)
            sx = beam.beam_size_x()
            sy = beam.beam_size_y()
            max_sigma = max(sx, sy, 1e-15)
            focus_margin = 1.0 - (max_sigma / aperture)

            # Focus urgency: how soon does this beam need focusing?
            # Estimate divergence rate from consecutive snapshots
            focus_urgency = 0.0
            if prev_max_sigma is not None and context.cumulative_s > prev_s:
                ds = context.cumulative_s - prev_s
                divergence_rate = (max_sigma - prev_max_sigma) / ds
                if divergence_rate > 0:
                    # Meters until beam hits aperture at current growth rate
                    remaining = aperture - max_sigma
                    if remaining > 0:
                        meters_to_loss = remaining / divergence_rate
                    else:
                        meters_to_loss = 0.0
                    # Reference scale: max stable half-cell for default quad
                    # f = p / (q * G * l) with G=20 T/m, l=3m, q*c=0.2998
                    # For momentum p (GeV/c): f = p / (0.2998 * 20 * 3)
                    p_gev = beam.energy  # approximate p ~ E for relativistic
                    ref_focal = p_gev / (0.2998 * 20.0 * 3.0)
                    ref_scale = max(ref_focal, 1.0)  # at least 1m
                    focus_urgency = max(0.0, min(1.0, 1.0 - meters_to_loss / ref_scale))
                # If beam is converging (divergence_rate <= 0), urgency stays 0

            prev_max_sigma = max_sigma
            prev_s = context.cumulative_s

            context.snapshots.append(beam.snapshot(i, etype, context.cumulative_s, extra={
                "eta_x": float(context.dispersion[0]),
                "eta_xp": float(context.dispersion[1]),
                "focus_margin": float(focus_margin),
                "focus_urgency": float(focus_urgency),
            }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python -m pytest test/test_focus_advisor.py -v`

Expected: All 6 tests PASS.

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python -m pytest test/ -v`

Expected: All existing tests still pass. The new snapshot fields are additive — they don't change any existing behavior.

- [ ] **Step 6: Commit**

```bash
git add beam_physics/lattice.py test/test_focus_advisor.py
git commit -m "feat: add focus_margin and focus_urgency to propagation snapshots"
```

---

### Task 2: Pass focus fields through gameplay.py to JS envelope

**Files:**
- Modify: `beam_physics/gameplay.py:348-384` (envelope mapping in physics_to_game)

- [ ] **Step 1: Write failing test for focus fields in game output**

Add to `test/test_focus_advisor.py`:

```python
import json
from beam_physics.gameplay import compute_beam_for_game


class TestFocusFieldsInGameOutput(unittest.TestCase):
    def _game_beamline_json(self):
        beamline = [
            {"type": "source", "length": 1, "stats": {}},
            {"type": "quadrupole", "length": 1, "stats": {"focusStrength": 1}, "params": {"polarity": 0}},
            {"type": "drift", "length": 5, "stats": {}},
            {"type": "quadrupole", "length": 1, "stats": {"focusStrength": 1}, "params": {"polarity": 1}},
            {"type": "drift", "length": 5, "stats": {}},
        ]
        return json.dumps(beamline)

    def test_envelope_has_focus_margin(self):
        result = json.loads(compute_beam_for_game(self._game_beamline_json()))
        for point in result["envelope"]:
            self.assertIn("focus_margin", point)

    def test_envelope_has_focus_urgency(self):
        result = json.loads(compute_beam_for_game(self._game_beamline_json()))
        for point in result["envelope"]:
            self.assertIn("focus_urgency", point)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python -m pytest test/test_focus_advisor.py::TestFocusFieldsInGameOutput -v`

Expected: FAIL — `focus_margin` key not in envelope points.

- [ ] **Step 3: Add focus fields to envelope mapping in gameplay.py**

In `beam_physics/gameplay.py`, inside the `physics_to_game()` function's envelope list comprehension (the `for s in physics_result["snapshots"]` block), add two new fields after the `"peak_current"` line:

```python
                "peak_current": s.get("peak_current", 0),
                # Focus advisor fields
                "focus_margin": s.get("focus_margin", 1.0),
                "focus_urgency": s.get("focus_urgency", 0.0),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python -m pytest test/test_focus_advisor.py -v`

Expected: All tests PASS (both TestFocusMargin and TestFocusFieldsInGameOutput).

- [ ] **Step 5: Commit**

```bash
git add beam_physics/gameplay.py test/test_focus_advisor.py
git commit -m "feat: pass focus_margin and focus_urgency through to game envelope"
```

---

### Task 3: Draw envelope color bands in designer plots

**Files:**
- Modify: `src/ui/probe-plots.js:1-80` (add focus band drawing to shared utilities)

The envelope plot is drawn by `_drawBeamEnvelope` in `probe-plots.js`. We add a background color band pass before the existing line drawing.

- [ ] **Step 1: Add _drawFocusBands helper to probe-plots.js**

In `src/ui/probe-plots.js`, add the following function inside the IIFE (after the `_applyYScale` function, before the plot-specific drawing functions):

```javascript
  /** Draw focus margin color bands behind a plot.
   *  Reads focus_margin from envelope data to color the background. */
  function _drawFocusBands(ctx, area, envelope, xr) {
    if (!envelope || envelope.length < 2) return;
    const [xMin, xMax] = xr;
    const xSpan = xMax - xMin || 1;

    for (let i = 0; i < envelope.length - 1; i++) {
      const d = envelope[i];
      const dNext = envelope[i + 1];
      const margin = d.focus_margin;
      if (margin == null) continue;

      const s0 = d.s != null ? d.s : i;
      const s1 = dNext.s != null ? dNext.s : i + 1;

      // Map s to pixel x
      const px0 = area.x + ((s0 - xMin) / xSpan) * area.w;
      const px1 = area.x + ((s1 - xMin) / xSpan) * area.w;

      // Skip if fully outside view
      if (px1 < area.x || px0 > area.x + area.w) continue;

      // Color by margin
      let color;
      if (margin > 0.6) color = 'rgba(0, 200, 0, 0.12)';
      else if (margin > 0.3) color = 'rgba(200, 200, 0, 0.12)';
      else if (margin > 0.0) color = 'rgba(200, 100, 0, 0.15)';
      else color = 'rgba(200, 0, 0, 0.18)';

      ctx.fillStyle = color;
      ctx.fillRect(
        Math.max(px0, area.x), area.y,
        Math.min(px1, area.x + area.w) - Math.max(px0, area.x), area.h
      );
    }
  }
```

- [ ] **Step 2: Call _drawFocusBands from _drawBeamEnvelope**

Find the `_drawBeamEnvelope` function in `probe-plots.js`. Add the focus band call right after the background is drawn and the area/ranges are computed, but before the envelope lines are drawn. Locate the line where the axes or grid are drawn and add before it:

```javascript
    // Focus health color bands (behind everything)
    const focusXr = xr || _xRange(envelope);
    _drawFocusBands(ctx, area, envelope, focusXr);
```

This must go after `const area = _area(canvas)` and after the x-range is determined, but before any `_line()` or `_polyline()` calls that draw the actual envelope curves.

- [ ] **Step 3: Test visually**

Open the game in browser, open the beamline designer, and verify:
- Green bands appear behind well-focused regions
- Yellow/orange/red bands appear where beam size grows large
- The bands sit behind the envelope lines, not on top

- [ ] **Step 4: Commit**

```bash
git add src/ui/probe-plots.js
git commit -m "feat: add focus margin color bands to designer envelope plots"
```

---

### Task 4: Compute ghost quad positions in BeamlineDesigner

**Files:**
- Modify: `src/ui/BeamlineDesigner.js:1202-1251` (after _recalcDraft physics recompute)

- [ ] **Step 1: Add _computeGhostQuads method to BeamlineDesigner**

Add the following method to `src/ui/BeamlineDesigner.js`, after the `_recalcDraft()` method:

```javascript
  /**
   * Compute suggested quad positions from focus urgency data.
   * Returns array of { s, nodeIndex, polarity } objects.
   */
  _computeGhostQuads() {
    this.ghostQuads = [];
    const env = this.draftEnvelope;
    if (!env || env.length < 2) return;

    const URGENCY_THRESHOLD = 0.7;

    // Find s-positions of existing quads
    const quadTypes = new Set([
      'quadrupole', 'scQuad', 'protonQuad', 'combinedFunctionMagnet',
    ]);
    const existingQuadS = [];
    let lastQuadPolarity = 1; // default: first ghost is Focus X
    let cumS = 0;
    for (const node of this.draftNodes) {
      const comp = COMPONENTS[node.type];
      const compLen = (comp ? comp.length : 1) * LENGTH_SCALE;
      if (quadTypes.has(node.type)) {
        existingQuadS.push(cumS + compLen / 2);
        // Track last quad polarity for alternation
        const p = node.params?.polarity;
        lastQuadPolarity = (p === 1) ? -1 : 1; // next should be opposite
      }
      cumS += compLen;
    }

    // Estimate one cell length for "nearby" check
    // Use ref_focal from the beam energy at midpoint
    const midEnv = env[Math.floor(env.length / 2)];
    const pGev = midEnv ? midEnv.energy : 0.01;
    const refFocal = pGev / (0.2998 * 20.0 * 3.0);
    const cellLength = Math.max(refFocal * 2, 3.0);

    let inUrgentRegion = false;
    for (let i = 0; i < env.length; i++) {
      const d = env[i];
      const urgency = d.focus_urgency || 0;

      if (urgency >= URGENCY_THRESHOLD && !inUrgentRegion) {
        inUrgentRegion = true;
        const ghostS = d.s || 0;

        // Check if an existing quad is nearby (within one cell length ahead)
        const hasNearbyQuad = existingQuadS.some(qs =>
          qs >= ghostS && qs <= ghostS + cellLength
        );
        if (hasNearbyQuad) continue;

        // Map s-position to node index
        let nodeIdx = 0;
        let accS = 0;
        for (let j = 0; j < this.draftNodes.length; j++) {
          const comp = COMPONENTS[this.draftNodes[j].type];
          accS += (comp ? comp.length : 1) * LENGTH_SCALE;
          if (accS >= ghostS) { nodeIdx = j; break; }
        }

        // Alternate polarity from last real or ghost quad
        const polarity = lastQuadPolarity;
        lastQuadPolarity = polarity === 1 ? -1 : 1;

        this.ghostQuads.push({ s: ghostS, nodeIndex: nodeIdx, polarity });
      } else if (urgency < URGENCY_THRESHOLD * 0.8) {
        inUrgentRegion = false;
      }
    }
  }
```

- [ ] **Step 2: Call _computeGhostQuads after physics recompute**

In `_recalcDraft()`, add the call right before the closing brace, after the `totalLength` update:

```javascript
    if (this.draftEnvelope && this.draftEnvelope.length > 0) {
      const maxS = this.draftEnvelope[this.draftEnvelope.length - 1].s;
      if (maxS > 0) this.totalLength = maxS;
    }

    // Compute ghost quad suggestions from focus urgency
    this._computeGhostQuads();
```

- [ ] **Step 3: Initialize ghostQuads in constructor**

In the BeamlineDesigner constructor (near the other draft state declarations), add:

```javascript
    this.ghostQuads = [];      // suggested quad positions [{s, nodeIndex, polarity}]
```

- [ ] **Step 4: Test visually**

Open beamline designer, create a beamline with a source and long drifts but no quads. Check browser console: `window.game.designer.ghostQuads` should contain entries with `s`, `nodeIndex`, and `polarity` values.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BeamlineDesigner.js
git commit -m "feat: compute ghost quad positions from focus urgency data"
```

---

### Task 5: Render ghost quad markers on the schematic

**Files:**
- Modify: `src/renderer/designer-renderer.js:94-212` (schematic rendering, after component drawing loop, before marker line)

- [ ] **Step 1: Add ghost quad rendering after the component loop**

In `designer-renderer.js`, inside `_renderSchematic`, add the following block after the component drawing loop ends (after `xPos += compW;` closing brace at ~line 159) and before the marker line section (before `// Draw marker line at markerS position`):

```javascript
  // --- Ghost quad markers (FODO advisor) ---
  if (this.ghostQuads && this.ghostQuads.length > 0 && this.totalLength > 0) {
    const tileLenSum = this.draftNodes.reduce((s, n) => {
      const c = COMPONENTS[n.type];
      return s + (c ? c.length : 1);
    }, 0) || 1;

    for (const ghost of this.ghostQuads) {
      // Map ghost.s to pixel position (same logic as marker)
      let ghostXPos = 20 + panOffsetPx;
      let cumS = 0;
      for (let i = 0; i < this.draftNodes.length; i++) {
        const comp = COMPONENTS[this.draftNodes[i].type];
        const tileLen = comp ? comp.length : 1;
        const compLen = (tileLen / tileLenSum) * this.totalLength;
        const cW = compWidths[i] * effectiveZoom;

        if (ghost.s <= cumS + compLen) {
          const frac = (ghost.s - cumS) / compLen;
          ghostXPos += frac * cW;
          break;
        }
        cumS += compLen;
        ghostXPos += cW;
      }

      // Draw ghost quad box
      const ghostW = Math.max(SCHEM_PW * 0.6, 30) * effectiveZoom;
      const ghostH = schematicH * 0.8;
      const ghostX = ghostXPos - ghostW / 2;
      const ghostY = beamY - ghostH / 2;

      // Dashed outline
      ctx.strokeStyle = 'rgba(68, 136, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(ghostX, ghostY, ghostW, ghostH);
      ctx.setLineDash([]);

      // Semi-transparent fill
      ctx.fillStyle = 'rgba(68, 136, 255, 0.08)';
      ctx.fillRect(ghostX, ghostY, ghostW, ghostH);

      // Polarity label
      ctx.fillStyle = 'rgba(68, 136, 255, 0.6)';
      ctx.font = `${Math.max(9, 11 * effectiveZoom)}px monospace`;
      ctx.textAlign = 'center';
      const label = ghost.polarity === 1 ? 'F' : 'D';
      ctx.fillText(label, ghostXPos, beamY + 4);

      // "+" icon above
      ctx.fillStyle = 'rgba(68, 136, 255, 0.5)';
      ctx.font = `${Math.max(10, 14 * effectiveZoom)}px monospace`;
      ctx.fillText('+', ghostXPos, ghostY - 4);

      // Store click region for ghost interaction
      if (!this._ghostRegions) this._ghostRegions = [];
      this._ghostRegions.push({
        x: ghostX, y: ghostY, w: ghostW, h: ghostH,
        ghost,
      });
    }
  }
```

- [ ] **Step 2: Clear ghost regions at start of _renderSchematic**

At the top of `_renderSchematic`, right after `this._compRegions = [];` add:

```javascript
  this._ghostRegions = [];
```

- [ ] **Step 3: Test visually**

Open beamline designer. Create a beamline with source + several drifts + no quads. Ghost quad markers (dashed blue boxes with F/D labels) should appear where the beam needs focusing. Add quads — ghosts should disappear near existing quads.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/designer-renderer.js
git commit -m "feat: render ghost quad markers on designer schematic"
```

---

### Task 6: Handle ghost marker clicks

**Files:**
- Modify: `src/renderer/designer-renderer.js` (schematic click handler)
- Modify: `src/ui/BeamlineDesigner.js` (insert logic)

- [ ] **Step 1: Find the schematic click handler**

The click handler is in `BeamlineDesigner._bindEvents()` (already read above). The `schematicCanvas.addEventListener('click', ...)` handler at ~line 225 currently calls `this._placeMarkerAtClickX(clickX)`. We need to check for ghost clicks first.

- [ ] **Step 2: Add ghost click detection to the schematic click handler**

In `src/ui/BeamlineDesigner.js`, in the schematic canvas click handler (inside `_bindEvents`), modify the click callback. Replace:

```javascript
      schematicCanvas.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        if (dragDistance > 5) return;  // was a drag, not a click
        const rect = schematicCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        this._placeMarkerAtClickX(clickX);
        this._renderAll();
      });
```

With:

```javascript
      schematicCanvas.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        if (dragDistance > 5) return;  // was a drag, not a click
        const rect = schematicCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Check ghost quad click first
        if (this._ghostRegions) {
          const dpr = window.devicePixelRatio || 1;
          for (const gr of this._ghostRegions) {
            if (clickX >= gr.x / dpr && clickX <= (gr.x + gr.w) / dpr &&
                clickY >= gr.y / dpr && clickY <= (gr.y + gr.h) / dpr) {
              this._insertGhostQuad(gr.ghost);
              return;
            }
          }
        }

        this._placeMarkerAtClickX(clickX);
        this._renderAll();
      });
```

- [ ] **Step 3: Add _insertGhostQuad method to BeamlineDesigner**

In `src/ui/BeamlineDesigner.js`, add after `_computeGhostQuads`:

```javascript
  /**
   * Insert a quad at a ghost marker position.
   * Activates insert mode at the ghost's node index with focusing category selected.
   */
  _insertGhostQuad(ghost) {
    // Move marker to ghost position
    this.markerS = ghost.s;

    // Select the node at the ghost position
    this.selectedIndex = Math.min(ghost.nodeIndex, this.draftNodes.length - 1);

    // Activate insert mode
    this.insertMode = 'nearest';
    this._updateInsertButtons();

    // Set focus row to palette
    this.focusRow = 1;
    this._updateFocusRowVisuals();

    this._renderAll();
  }
```

- [ ] **Step 4: Test visually**

Open beamline designer with a beamline that has ghost markers visible. Click a ghost marker — should switch to insert mode and move selection near the ghost position so the player can place a quad.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BeamlineDesigner.js src/renderer/designer-renderer.js
git commit -m "feat: handle ghost quad marker clicks in designer"
```

---

### Task 7: Final integration test and polish

**Files:**
- Modify: `test/test_focus_advisor.py` (add integration test)

- [ ] **Step 1: Add end-to-end test through gameplay bridge**

Add to `test/test_focus_advisor.py`:

```python
class TestFocusAdvisorIntegration(unittest.TestCase):
    """End-to-end: game beamline through full pipeline produces focus data."""

    def test_unfocused_beamline_has_high_urgency(self):
        """A beamline with no quads should show high urgency somewhere."""
        beamline = json.dumps([
            {"type": "source", "length": 1, "stats": {}},
            {"type": "drift", "length": 5, "stats": {}},
            {"type": "drift", "length": 5, "stats": {}},
            {"type": "drift", "length": 5, "stats": {}},
        ])
        result = json.loads(compute_beam_for_game(beamline))
        max_urgency = max(p["focus_urgency"] for p in result["envelope"])
        self.assertGreater(max_urgency, 0.5,
                          "Long unfocused beamline should have high urgency")

    def test_well_focused_beamline_has_low_urgency(self):
        """A proper FODO lattice should keep urgency low throughout."""
        beamline = json.dumps([
            {"type": "source", "length": 1, "stats": {}},
            {"type": "quadrupole", "length": 1, "stats": {"focusStrength": 1},
             "params": {"polarity": 0}},
            {"type": "drift", "length": 2, "stats": {}},
            {"type": "quadrupole", "length": 1, "stats": {"focusStrength": 1},
             "params": {"polarity": 1}},
            {"type": "drift", "length": 2, "stats": {}},
            {"type": "quadrupole", "length": 1, "stats": {"focusStrength": 1},
             "params": {"polarity": 0}},
            {"type": "drift", "length": 2, "stats": {}},
        ])
        result = json.loads(compute_beam_for_game(beamline))
        max_urgency = max(p["focus_urgency"] for p in result["envelope"])
        self.assertLess(max_urgency, 0.5,
                       "Well-focused FODO should keep urgency low")
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python -m pytest test/ -v`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/test_focus_advisor.py
git commit -m "test: add end-to-end focus advisor integration tests"
```
