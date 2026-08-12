# RF Ladder & Beamline-Type Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every beamline type the hardware to reach its own energy band in a sane number of placements, by adding 12 components on a graded RF ladder and replacing exact-frequency RF matching with band matching.

**Architecture:** Three layers, in dependency order. (1) The RF waveguide solver switches from exact-frequency buckets to band eligibility plus a one-frequency-per-network lock — this must land first because every new component depends on it. (2) Twelve new components enter the catalogue as data, each homed on a research node that currently unlocks nothing, with no new `physicsType` values. (3) Each new component gets a 3D role-builder and a 70×30 pixel schematic.

**Tech Stack:** Vanilla ES modules, Three.js for 3D, canvas 2D for schematics, Python/Pyodide for `beam_physics/`. Tests are hand-rolled Node scripts auto-discovered from `test/*.js` by `scripts/run-tests.mjs`; Python tests via pytest.

**Spec:** `docs/superpowers/specs/2026-08-12-rf-ladder-and-type-coverage-design.md`

## Global Constraints

- **No new `physicsType` values.** Every component maps onto an existing member of `KNOWN_PHYSICS_TYPES` (`beam_physics/gameplay.py:62`). `gameplay.py` raises `ValueError` on an unknown one.
- **No new research nodes.** All 12 components home on existing nodes. `test/test-registry-integrity.js:319` enforces gating symmetry in both directions with `KNOWN_OPEN_GATING` empty — a component must appear in exactly one node's `unlocks` **and** carry that node in its `requires`.
- **No new subsections.** Use existing `normalConducting` / `superconducting` / `focusing` / `manipulation`. Asserted at `test-registry-integrity.js:377`.
- **Frequencies are MHz in the catalogue, Hz in port params.** `getUtilityPortsV2` (`src/data/utility-ports-v2.js:621`) does the `* 1e6` conversion. The `RF_BANDS` table is defined in **MHz**; the solver compares in **Hz**.
- **Ports declare their own params.** Per the header of `utility-ports-v2.js`, `SINK_DEFAULTS` is a safety net, not something to rely on.
- **Costs are provisional.** Follow the `fomRef` convention already stated in `beamline-types.js`: measure in `scripts/balance-sim.mjs`, then replace. Do not hand-tune during implementation.
- **Do not commit.** The user decides commit boundaries. Steps below say "verify", never "commit".
- **Plan style:** per `CLAUDE.md`, art tasks are written as directives with acceptance criteria, not transcribed geometry. Solver tasks carry real code because the code encodes non-obvious decisions.

## Resolved tension: implied gradient vs. footprint

`gameplay.py:209` derives `gradientDemanded = energyGain * 1000 / length`, and `length = subL * 0.5` metres. The governing principle ("one placement is a cryostring or sector") means the upper rungs imply gradients far above any real device:

| component | GeV | subL | length | implied gradient | real? |
|---|---|---|---|---|---|
| `cbandStructure` | 0.12 | 6 | 3 m | 40 MV/m | yes |
| `xbandStructure` | 0.30 | 6 | 3 m | 100 MV/m | yes |
| `srf650Cryomodule` | 0.15 | 20 | 10 m | 15 MV/m | yes |
| `srf805Cryomodule` | 0.40 | 24 | 12 m | 33 MV/m | ~2 modules |
| `cwCryomodule` | 0.50 | 24 | 12 m | 42 MV/m | ~3 modules |
| `nbSnCryomodule` | 1.2 | 24 | 12 m | 100 MV/m | ~6 modules |
| `srfLinacSector` | 3.5 | 32 | 16 m | 219 MV/m | a full sector |
| `twoBeamModule` | 6.0 | 24 | 12 m | 500 MV/m | abstracted |
| `plasmaAfterburner` | 15 | 20 | 10 m | 1.5 GV/m | **yes** — plasma is GV/m |

**Rule:** the first three and the last are physically honest and their `desc` states the real gradient. The middle five are abstractions, and each `desc` must say so explicitly — "one placement stands for N modules in a single cryogenic sector" — rather than quoting a gradient the hardware does not have. Never write a `desc` quoting a gradient that contradicts `gradientDemanded`.

## File Structure

**Modified once (foundation):**
- `src/utility/types/rfWaveguide.js` — `RF_BANDS`, `bandForFrequencyHz()`, rewritten `solve()`, new `rf_frequency_split` code.
- `src/data/utility-ports-v2.js` — inject `band` on RF sinks and `bands` on RF sources; drop `broadband`.
- `src/data/infrastructure.raw.js` — `rfBands` on nine `rfPower` sources.

**Modified per-content:**
- `src/data/beamline-components.raw.js` — 12 new entries; low-band frequency consolidation.
- `src/data/research.js` — 12 additions to `unlocks`.
- `src/data/beamline-types.js` — `requires`, `excludes`, collider band.
- `beam_physics/gameplay.py` — `COMPONENT_DEFAULTS` rekey.
- `src/renderer3d/component-builder.js` — 12 `ROLE_BUILDERS` entries.
- `src/ui/overlays.js` — 12 schematic drawers.

**Created:**
- `test/test-beamline-type-coverage.js` — the regression guard for the whole spec.

---

## Task 1: RF band table and lookup

**Files:**
- Modify: `src/utility/types/rfWaveguide.js`
- Test: `test/test-utility-solve-rfWaveguide.js`

**Interfaces:**
- Produces: `export const RF_BANDS` — array of `{ id, loMHz, hiMHz, label, tier }`, ascending by `loMHz`. `export function bandForFrequencyHz(hz)` returning a band id string or `null`.

- [ ] **Step 1: Write the failing test**

Append to `test/test-utility-solve-rfWaveguide.js`:

```js
import desc, { RF_BANDS, bandForFrequencyHz } from '../src/utility/types/rfWaveguide.js';

console.log('\n--- Band table ---');
{
  assert(RF_BANDS.length === 6, `6 bands (got ${RF_BANDS.length})`);
  const ids = RF_BANDS.map(b => b.id);
  assert(ids.join(',') === 'vhf,uhf,lband,sband,cband,xband', `band order (got ${ids.join(',')})`);
  // Ascending, non-overlapping, no gaps.
  for (let i = 1; i < RF_BANDS.length; i++) {
    assert(RF_BANDS[i].loMHz === RF_BANDS[i - 1].hiMHz,
      `${RF_BANDS[i].id} starts where ${RF_BANDS[i - 1].id} ends`);
  }
  assert(bandForFrequencyHz(162.5e6) === 'vhf', '162.5 MHz -> vhf');
  assert(bandForFrequencyHz(650e6) === 'uhf', '650 MHz -> uhf');
  assert(bandForFrequencyHz(1300e6) === 'lband', '1300 MHz -> lband');
  assert(bandForFrequencyHz(2856e6) === 'sband', '2856 MHz -> sband');
  assert(bandForFrequencyHz(5712e6) === 'cband', '5712 MHz -> cband');
  assert(bandForFrequencyHz(11424e6) === 'xband', '11424 MHz -> xband');
  assert(bandForFrequencyHz(20e6) === null, 'below vhf -> null');
  assert(bandForFrequencyHz(99e9) === null, 'above xband -> null');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-utility-solve-rfWaveguide.js`
Expected: FAIL — `RF_BANDS` is not exported (SyntaxError on the named import).

- [ ] **Step 3: Implement**

Add near the top of `src/utility/types/rfWaveguide.js`, above `distributePower`:

```js
// Band table. Ranges are half-open [loMHz, hiMHz) and contiguous: every
// frequency between 50 MHz and 16 GHz lands in exactly one band, so a
// component can never fall between two.
//
// A source powers anything in a band it covers, at any frequency in that
// band — that is the "generous" half of the rule. The strict half lives in
// solve(): one network carries one frequency, so two frequencies in the same
// band still need two networks and two source instances.
export const RF_BANDS = [
  { id: 'vhf',   loMHz:    50, hiMHz:   500, label: 'VHF',     tier: 'beginner' },
  { id: 'uhf',   loMHz:   500, hiMHz:  1000, label: 'UHF',     tier: 'proton SRF' },
  { id: 'lband', loMHz:  1000, hiMHz:  2000, label: 'L-band',  tier: 'SRF workhorse' },
  { id: 'sband', loMHz:  2000, hiMHz:  4000, label: 'S-band',  tier: 'mid NC' },
  { id: 'cband', loMHz:  4000, hiMHz:  8000, label: 'C-band',  tier: 'high-gradient NC' },
  { id: 'xband', loMHz:  8000, hiMHz: 16000, label: 'X-band',  tier: 'expert NC' },
];

/** Band id for a frequency in HERTZ, or null if outside every band. */
export function bandForFrequencyHz(hz) {
  const mhz = hz / 1e6;
  for (const b of RF_BANDS) {
    if (mhz >= b.loMHz && mhz < b.hiMHz) return b.id;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-utility-solve-rfWaveguide.js`
Expected: the new band assertions PASS. Pre-existing `solve()` tests still pass — nothing has changed in `solve()` yet.

---

## Task 2: Inject band onto RF ports

**Files:**
- Modify: `src/data/utility-ports-v2.js:610-646` (`getUtilityPortsV2`)
- Test: `test/test-utility-ports-v2.js`

**Interfaces:**
- Consumes: `bandForFrequencyHz` from Task 1.
- Produces: RF **sink** port params gain `band` (string). RF **source** port params gain `bands` (array of band ids). `params.broadband` is no longer produced.

- [ ] **Step 1: Write the failing test**

Append to `test/test-utility-ports-v2.js`:

```js
console.log('\n--- RF band injection ---');
{
  const cryo = getUtilityPortsV2('cryomodule');
  assert(cryo.rf_in.params.band === 'lband',
    `cryomodule rf_in band lband (got ${cryo.rf_in.params.band})`);
  assert(cryo.rf_in.params.frequency === 1300e6, 'cryomodule rf_in 1.3 GHz');

  const gy = getUtilityPortsV2('gyrotron');
  assert(Array.isArray(gy.rf_out.params.bands), 'gyrotron rf_out has bands array');
  assert(gy.rf_out.params.bands.join(',') === 'cband,xband',
    `gyrotron covers cband,xband (got ${gy.rf_out.params.bands.join(',')})`);
  assert(gy.rf_out.params.broadband === undefined, 'broadband flag is gone');

  const iot = getUtilityPortsV2('iot');
  assert(iot.rf_out.params.bands.join(',') === 'uhf,lband',
    `iot covers uhf,lband (got ${iot.rf_out.params.bands.join(',')})`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-utility-ports-v2.js`
Expected: FAIL — `band` undefined, `bands` undefined.

- [ ] **Step 3: Implement**

In `src/data/utility-ports-v2.js`:

1. Import the helper: `import { bandForFrequencyHz } from '../utility/types/rfWaveguide.js';`
2. Add a raw reader beside `rawRfFrequency`:

```js
function rawRfBands(id) {
  const raw = BEAMLINE_COMPONENTS_RAW[id] || INFRASTRUCTURE_RAW[id];
  return raw ? raw.rfBands : undefined;
}
```

3. Replace the `rfWaveguide` branch inside `getUtilityPortsV2` so that:
   - **sinks** keep the existing MHz→Hz frequency fill, then set `params.band = params.band ?? bandForFrequencyHz(params.frequency)`;
   - **sources** read `rawRfBands(id)` into `params.bands` (declared `params.bands` wins), and no longer set `params.frequency` or `params.broadband` at all;
   - a sink whose frequency falls outside every band keeps the existing `DEFAULT_RF_FREQ_HZ` fallback and therefore lands in `lband`.
4. Update the JSDoc above `getUtilityPortsV2` to describe bands rather than broadband.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-utility-ports-v2.js`
Expected: PASS. Task 4 supplies the `rfBands` data — until then `gyrotron`/`iot` assertions fail, so **run Task 4 before re-running this**, or accept those two as red until Task 4 lands.

> **Ordering note:** Tasks 2 and 4 are mutually dependent (code reads data that does not exist yet). Implement Task 4's data edit first if you prefer a green bar at every step; the plan lists them in this order because the interface is defined here.

---

## Task 3: Rewrite solve() for band matching

**Files:**
- Modify: `src/utility/types/rfWaveguide.js` (`solve`, lines ~50-140)
- Test: `test/test-utility-solve-rfWaveguide.js` (rewrite the frequency-bucket tests)

**Interfaces:**
- Consumes: `bandForFrequencyHz`, port params `band` / `bands` from Tasks 1-2.
- Produces: `solve()` returning the same shape as today (`flowState` with `perSinkQuality`, `perSinkPower`, `totalCapacity`, `totalDemand`; `errors[]`), plus a new error code `rf_frequency_split`.

**Behaviour contract:**

1. Determine the network's **served frequency**: group sinks by `params.frequency`, sum demand per frequency, pick the largest; break ties by **ascending frequency**.
2. Sinks at any other frequency get quality 0, power 0, and one soft `rf_frequency_split` error per unserved frequency, naming both frequencies.
3. Capacity = sum of `capacity` over sources whose `params.bands` includes the served frequency's band. Sources not covering it contribute nothing.
4. Zero capacity with non-zero demand → quality 0 plus soft `rf_frequency_mismatch`.
5. Demand > capacity → quality `cap/demand` plus soft `rf_overload`.
6. Duty-factor weighting, `peakFactor` and `distributePower` are **unchanged**, except that `dutyWeighted` accumulates only over *eligible* sources.
7. `totalCapacity` reports eligible capacity only; `totalDemand` reports all sinks' demand including split-off ones.

- [ ] **Step 1: Write the failing tests**

Replace Tests 2-6 in `test/test-utility-solve-rfWaveguide.js` (the exact-frequency and broadband-pool cases) with:

```js
console.log('\n--- Band match: one source feeds many same-frequency sinks ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['lband'], dutyFactor: 1 } }],
    sinks: [
      { portKey: 'k1', demand: 40, params: { frequency: 1300e6, band: 'lband' } },
      { portKey: 'k2', demand: 40, params: { frequency: 1300e6, band: 'lband' } },
      { portKey: 'k3', demand: 40, params: { frequency: 1300e6, band: 'lband' } },
    ],
  });
  const r = desc.solve(net, {}, {});
  for (const k of ['k1', 'k2', 'k3']) {
    assert(r.flowState.perSinkQuality[k] === 1, `${k} quality 1`);
  }
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

console.log('\n--- Band match: source out of band ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['sband'], dutyFactor: 1 } }],
    sinks:   [{ portKey: 'k1', demand: 40, params: { frequency: 1300e6, band: 'lband' } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 0, 'k1 quality 0');
  assert(r.errors.some(e => e.code === 'rf_frequency_mismatch'), 'rf_frequency_mismatch raised');
}

console.log('\n--- Same band, two frequencies: network splits ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['vhf'], dutyFactor: 1 } }],
    sinks: [
      { portKey: 'k1', demand: 50, params: { frequency: 162.5e6, band: 'vhf' } },
      { portKey: 'k2', demand: 10, params: { frequency: 325e6,   band: 'vhf' } },
    ],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 1, 'dominant frequency served');
  assert(r.flowState.perSinkQuality.k2 === 0, 'minority frequency starved');
  const split = r.errors.filter(e => e.code === 'rf_frequency_split');
  assert(split.length === 1, `1 split error (got ${split.length})`);
  assert(split[0].severity === 'soft', 'split severity soft');
}

console.log('\n--- Split tie broken by ascending frequency ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['vhf'], dutyFactor: 1 } }],
    sinks: [
      { portKey: 'kHi', demand: 25, params: { frequency: 325e6,   band: 'vhf' } },
      { portKey: 'kLo', demand: 25, params: { frequency: 162.5e6, band: 'vhf' } },
    ],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.kLo === 1, 'lower frequency wins the tie');
  assert(r.flowState.perSinkQuality.kHi === 0, 'higher frequency starved on tie');
}

console.log('\n--- Splitting into two networks clears the diagnostic ---');
{
  const mk = (freq, key) => mkNetwork({
    id: 'net_' + key,
    sources: [{ portKey: 's_' + key, capacity: 300, params: { bands: ['vhf'], dutyFactor: 1 } }],
    sinks:   [{ portKey: key, demand: 50, params: { frequency: freq, band: 'vhf' } }],
  });
  const a = desc.solve(mk(162.5e6, 'k1'), {}, {});
  const b = desc.solve(mk(325e6, 'k2'), {}, {});
  assert(a.flowState.perSinkQuality.k1 === 1 && b.flowState.perSinkQuality.k2 === 1,
    'both networks fully served');
  assert(a.errors.length === 0 && b.errors.length === 0, 'no errors on either network');
}

console.log('\n--- Overload still works ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 30, params: { bands: ['lband'], dutyFactor: 1 } }],
    sinks:   [{ portKey: 'k1', demand: 60, params: { frequency: 1300e6, band: 'lband' } }],
  });
  const r = desc.solve(net, {}, {});
  assert(approx(r.flowState.perSinkQuality.k1, 0.5), 'quality 0.5 under 2x overload');
  assert(r.errors.some(e => e.code === 'rf_overload'), 'rf_overload raised');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-utility-solve-rfWaveguide.js`
Expected: FAIL — the old bucket solver ignores `bands`, so out-of-band sources still feed sinks and no `rf_frequency_split` code exists.

- [ ] **Step 3: Implement**

Rewrite the body of `solve()`. Keep the duty/peak-power block and `distributePower` as they are. The new shape:

```js
  solve(network, persistent, worldState) {
    const errors = [];
    const perSinkQuality = {};
    const perSinkPower = {};

    // 1. Group sinks by frequency; the largest-demand frequency is the one
    //    this network carries. Ties go to the lower frequency so the result
    //    is stable across rebuilds.
    const byFreq = new Map();
    let totalDemand = 0;
    for (const sink of network.sinks) {
      const f = (sink.params && sink.params.frequency) || 0;
      if (!byFreq.has(f)) byFreq.set(f, []);
      byFreq.get(f).push(sink);
      totalDemand += sink.demand || 0;
    }
    const freqs = [...byFreq.keys()].sort((a, b) => a - b);
    const demandAt = (f) => byFreq.get(f).reduce((a, s) => a + (s.demand || 0), 0);
    let served = null;
    for (const f of freqs) {
      if (served === null || demandAt(f) > demandAt(served)) served = f;
    }

    if (served === null) {
      return {
        flowState: {
          networkId: network.id, utilityType: network.utilityType,
          totalCapacity: 0, totalDemand: 0, perSinkQuality, perSinkPower,
        },
        errors,
      };
    }

    // 2. Everything not on the served frequency is starved, with a diagnostic
    //    naming both sides so the fix ("run a second network") is obvious.
    const servedBand = bandForFrequencyHz(served);
    for (const f of freqs) {
      if (f === served) continue;
      for (const s of byFreq.get(f)) {
        perSinkQuality[s.portKey] = 0;
        perSinkPower[s.portKey] = 0;
      }
      errors.push({
        severity: 'soft',
        code: 'rf_frequency_split',
        message: `This network carries ${(served / 1e6).toFixed(1)} MHz; `
          + `${(f / 1e6).toFixed(1)} MHz needs its own network and source.`,
        location: { networkId: network.id },
      });
    }

    // 3. Only sources covering the served band contribute.
    let capacity = 0, dutyWeighted = 0, dutyTotalCap = 0;
    for (const s of network.sources) {
      const bands = (s.params && s.params.bands) || [];
      if (!servedBand || !bands.includes(servedBand)) continue;
      const cap = s.capacity || 0;
      capacity += cap;
      dutyWeighted += cap * ((s.params && s.params.dutyFactor) || 1.0);
      dutyTotalCap += cap;
    }
    const meanDuty = dutyTotalCap > 0 ? dutyWeighted / dutyTotalCap : 1.0;
    const peakFactor = Math.min(1 / Math.max(meanDuty, 1e-4), 10000);

    const sinks = byFreq.get(served);
    const demand = demandAt(served);

    if (capacity === 0 && demand > 0) {
      for (const s of sinks) { perSinkQuality[s.portKey] = 0; perSinkPower[s.portKey] = 0; }
      errors.push({
        severity: 'soft',
        code: 'rf_frequency_mismatch',
        message: `No RF source covering ${servedBand || 'this frequency'} `
          + `(${(served / 1e6).toFixed(1)} MHz).`,
        location: { networkId: network.id },
      });
    } else {
      const q = demand > 0 ? Math.min(1, capacity / demand) : 1;
      for (const s of sinks) perSinkQuality[s.portKey] = q;
      Object.assign(perSinkPower, distributePower(sinks, capacity, demand, peakFactor));
      if (demand > capacity) {
        errors.push({
          severity: 'soft',
          code: 'rf_overload',
          message: `RF overload at ${(served / 1e6).toFixed(1)} MHz `
            + `(${demand}/${capacity} kW).`,
          location: { networkId: network.id },
        });
      }
    }

    return {
      flowState: {
        networkId: network.id, utilityType: network.utilityType,
        totalCapacity: capacity, totalDemand, perSinkQuality, perSinkPower,
      },
      errors,
    };
  },
```

Rewrite the file header comment to describe band matching and the one-frequency-per-network lock, replacing the bucket/broadband description.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-utility-solve-rfWaveguide.js`
Expected: PASS.

- [ ] **Step 5: Check for consumers of the removed behaviour**

Run: `grep -rn "broadband\|rf_frequency_mismatch\|rf_frequency_split" src/ test/`
Expected: no remaining producer or reader of `params.broadband`. Any UI string table listing error codes (check `src/ui/` for `rf_overload`) must gain `rf_frequency_split` with a player-facing message.

- [ ] **Step 6: Verify the whole suite**

Run: `npm test`
Expected: no regressions outside the files touched. `test-utility-descriptor-params.js` and `test-utility-solve-runner.js` are the likely collateral — fix by updating their fixtures to `bands`, not by weakening assertions.

---

## Task 4: Source band coverage

**Files:**
- Modify: `src/data/infrastructure.raw.js` (nine `rfPower` entries)
- Modify: `src/data/utility-ports-v2.js` (drop `broadband: true` from source port params if declared inline)
- Test: `test/test-components-utility-ports.js`

**Interfaces:**
- Produces: `rfBands: string[]` on every `rfPower` component. `rfFrequency` remains for display but is no longer the matching key.

- [ ] **Step 1: Write the failing test**

Append to `test/test-components-utility-ports.js`:

```js
console.log('\n--- Every RF source declares bands; every band is covered ---');
{
  const bandIds = RF_BANDS.map(b => b.id);
  const covered = new Set();
  let sources = 0;
  for (const [id, c] of Object.entries(COMPONENTS)) {
    if (c.category !== 'rfPower') continue;
    const ports = getUtilityPortsV2(id);
    const out = Object.values(ports).find(p => p.utility === 'rfWaveguide' && p.role === 'source');
    if (!out) continue;
    sources++;
    const bands = out.params.bands;
    assert(Array.isArray(bands) && bands.length > 0, `${id} declares rfBands`);
    for (const b of bands) {
      assert(bandIds.includes(b), `${id} band '${b}' is a real band`);
      covered.add(b);
    }
  }
  assert(sources === 9, `9 RF sources (got ${sources})`);
  for (const b of bandIds) assert(covered.has(b), `band ${b} has at least one source`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-components-utility-ports.js`
Expected: FAIL — no source declares `rfBands`.

- [ ] **Step 3: Implement**

Add `rfBands` to each `rfPower` entry in `src/data/infrastructure.raw.js`. Keep each existing `rfFrequency` for display. Add a short comment above the block explaining that bands, not frequencies, decide what a source can drive.

| id | `rfBands` | rationale for the comment |
|---|---|---|
| `solidStateAmp` | `['vhf', 'uhf']` | SSAs are the standard 350–700 MHz choice |
| `twt` | `['vhf','uhf','lband','sband','cband','xband']` | genuinely wideband, capacity 20 — the unblocker, never the answer |
| `magnetron` | `['sband']` | 2.45 GHz industrial magnetron |
| `pulsedKlystron` | `['sband', 'cband']` | |
| `cwKlystron` | `['uhf', 'lband']` | |
| `iot` | `['uhf', 'lband']` | IOTs are 470–700 MHz in broadcast, plus L-band |
| `multibeamKlystron` | `['sband', 'cband']` | |
| `highPowerSSA` | `['vhf', 'uhf', 'lband']` | |
| `gyrotron` | `['cband', 'xband']` | gyrotrons are inherently high-frequency |

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-components-utility-ports.js && node test/test-utility-ports-v2.js`
Expected: PASS both (this also greens Task 2's `gyrotron`/`iot` assertions).

---

## Task 5: Low-band frequency consolidation

**Files:**
- Modify: `src/data/beamline-components.raw.js` (`buncher`, `pillboxCavity`, `halfWaveResonator`, `rfq`)
- Test: `test/test-beamline-type-coverage.js` is created in Task 10; verify here by inspection plus the existing suite.

**Rationale to put in the code comment:** one-frequency-per-network would otherwise force a tier-2 proton line onto four separate RF networks (200 / 161 / 325 / 400 MHz) at exactly the tier where the player first meets the utility system. PIP-II runs its RFQ, buncher and half-wave resonators all at 162.5 MHz and its spoke resonators at 325, so consolidating onto the real values drops a proton line to three networks and a test stand to one.

- [ ] **Step 1: Apply the retune**

| component | `rfFrequency` before | after | `rfBand` |
|---|---|---|---|
| `buncher` | 200 | 162.5 | `vhf` (unchanged) |
| `pillboxCavity` | 200 | 162.5 | `vhf` (unchanged) |
| `halfWaveResonator` | 161 | 162.5 | `vhf` (unchanged) |
| `rfq` | 400 | 162.5 | `vhf` (unchanged) |
| `spokeCavity` | 325 | 325 (unchanged) | `vhf` (unchanged) |

Also update each `params.rfFrequency` where the component declares one (`halfWaveResonator` has `rfFrequency: 161` in `params`; `rfq` and `buncher` do not).

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS. Then confirm the consolidation by inspection:

Run: `node -e "import('./src/data/components.js').then(({COMPONENTS})=>{for (const k of ['buncher','pillboxCavity','halfWaveResonator','rfq','spokeCavity']) console.log(k, COMPONENTS[k].rfFrequency, COMPONENTS[k].rfBand);})"`
Expected: four at 162.5/vhf, `spokeCavity` at 325/vhf.

---

## Task 6: Research gating and allowlist fixes

**Files:**
- Modify: `src/data/beamline-types.js`
- Test: `test/test-beamline-types.js`

- [ ] **Step 1: Write the failing test**

Append to `test/test-beamline-types.js`:

```js
console.log('\n--- Types unlock with their defining hardware available ---');
{
  const closure = (ids) => {
    const out = new Set(); const stack = [...ids];
    while (stack.length) {
      const id = stack.pop(); if (out.has(id)) continue; out.add(id);
      const n = RESEARCH[id]; if (!n) continue;
      const r = n.requires;
      for (const p of (!r ? [] : Array.isArray(r) ? r : [r])) stack.push(p);
    }
    return out;
  };
  const reqOf = (t) => Array.isArray(t.requires) ? t.requires : (t.requires ? [t.requires] : []);

  for (const [need, types] of Object.entries({
    protonAcceleration: ['spallation', 'therapy'],
    bunchCompression:   ['collider'],
    srfTechnology:      ['collider'],
    targetPhysics:      ['isotopeIrradiation'],
  })) {
    for (const tid of types) {
      const done = closure(reqOf(BEAMLINE_TYPES[tid]));
      assert(done.has(need), `${tid} unlock implies ${need}`);
    }
  }

  const eb = BEAMLINE_TYPES.ebeamProcessing.excludes;
  assert(eb.includes('velocitySelector'), 'ebeamProcessing excludes velocitySelector');
  assert(eb.includes('emittanceFilter'), 'ebeamProcessing excludes emittanceFilter');

  assert(BEAMLINE_TYPES.collider.spec.energyGeV[1] === 500, 'collider band tops at 500 GeV/beam');
}
```

Add `import { RESEARCH } from '../src/data/research.js';` if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-beamline-types.js`
Expected: FAIL on all four closure checks, both excludes, and the band top.

- [ ] **Step 3: Implement**

In `src/data/beamline-types.js`:

- `spallation.requires`: `['cwLinacDesign', 'targetPhysics']` → `['cwLinacDesign', 'targetPhysics', 'protonAcceleration']`
- `therapy.requires`: `['isochronousCyclotron', 'machineProtection']` → `+ 'protonAcceleration'`
- `collider.requires`: `'colliderTech'` → `['colliderTech', 'bunchCompression', 'srfTechnology']`
- `isotopeIrradiation.requires`: `'protonAcceleration'` → `['protonAcceleration', 'targetPhysics']`
- `ebeamProcessing.excludes`: `['sextupole']` → `['sextupole', 'velocitySelector', 'emittanceFilter']`
- `collider.spec.energyGeV`: `[45, 120]` → `[45, 500]`

Replace the comment above the collider band explaining the 120 ceiling with the new reasoning: 45 GeV/beam is the Z pole, 500 GeV/beam is 1 TeV centre-of-mass (CLIC stage 2), reached via `plasmaAfterburner`. Note in the comment that this is the widest band in the roster at 1.05 decades and that the trade was made deliberately for the monument type.

Add a `TODO(balance)` comment on `collider.fomRef` noting `1e32` was measured for a 45–120 machine and must be re-measured against the wider band in `scripts/balance-sim.mjs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-beamline-types.js && node test/test-beamline-picker.js`
Expected: PASS.

- [ ] **Step 5: Verify no type became unreachable**

Run: `node -e "import('./src/data/beamline-types.js').then(async m=>{const {RESEARCH}=await import('./src/data/research.js');const all=new Set(Object.keys(RESEARCH));console.log(m.beamlineTypesFor([...all]).map(t=>t.id).join(', '));})"`
Expected: all nine type ids listed.

---

## Task 7: The nine RF components — data

**Files:**
- Modify: `src/data/beamline-components.raw.js`
- Modify: `src/data/utility-ports-v2.js`
- Modify: `src/data/research.js`
- Test: `test/test-registry-integrity.js` (must pass unchanged)

**Interfaces:**
- Produces: component ids `cbandStructure`, `xbandStructure`, `srf650Cryomodule`, `srf805Cryomodule`, `cwCryomodule`, `nbSnCryomodule`, `srfLinacSector`, `twoBeamModule`, `plasmaAfterburner`.

**Data table** — everything not listed follows the `cryomodule` entry (`beamline-components.raw.js:1436`) as template:

| id | physicsType | subsection | GeV | cost $M | subL | rfFreq MHz | rfBand | requires | beamlineTypes |
|---|---|---|---|---|---|---|---|---|---|
| `cbandStructure` | `rfCavity` | normalConducting | 0.12 | 6 | 6 | 5712 | cband | `highGradientRf` | lightSource, xfel, collider |
| `xbandStructure` | `rfCavity` | normalConducting | 0.30 | 14 | 6 | 11424 | xband | `highGradientRf` | lightSource, xfel, collider |
| `srf650Cryomodule` | `cryomodule` | superconducting | 0.15 | 9 | 20 | 650 | uhf | `cwLinacDesign` | spallation |
| `srf805Cryomodule` | `cryomodule` | superconducting | 0.40 | 20 | 24 | 805 | uhf | `superconducting` | spallation |
| `cwCryomodule` | `cryomodule` | superconducting | 0.50 | 22 | 24 | 1300 | lband | `cryomoduleDesign` | lightSource, xfel, euvFel, collider |
| `nbSnCryomodule` | `cryomodule` | superconducting | 1.2 | 42 | 24 | 1300 | lband | `nDopedSrf` | lightSource, xfel, euvFel, collider |
| `srfLinacSector` | `cryomodule` | superconducting | 3.5 | 91 | 32 | 1300 | lband | `colliderTech` | xfel, collider |
| `twoBeamModule` | `rfCavity` | normalConducting | 6.0 | 126 | 24 | 11994 | xband | `highLuminosity` | collider |
| `plasmaAfterburner` | `rfCavity` | normalConducting | 15 | 255 | 20 | — | — | `plasmaAcceleration` | collider |

`stats.energyGain` is the GeV column. `stats.gradient` is the implied gradient from the table in "Resolved tension" above. `subW`/`subH` = 4, `gridW` = 4, `gridH` = `subL`, `geometryType: 'cylinder'` for the SRF family and `plasmaAfterburner`, `'box'` for `cbandStructure`/`xbandStructure`/`twoBeamModule`. `placement: 'module'`, `role: 'placement'`, `ports: { entry: { side: 'back' }, exit: { side: 'front' } }`.

`requiredConnections`: `['powerCable','coolingWater','rfWaveguide']` for NC; `['powerCable','cryoTransfer','rfWaveguide']` for SRF; **`['powerCable','coolingWater','dataFiber']` for `plasmaAfterburner`** — it is not RF hardware, has no `rfFrequency`/`rfBand`, and its drive-laser draw lands on `powerCable`.

- [ ] **Step 1: Write the failing test**

Create the coverage assertions as part of Task 10; for this task, the gate is `test-registry-integrity.js`, which already fails on an ungated or unadvertised component. First add a presence check to `test/test-beamline-types.js`:

```js
console.log('\n--- New RF ladder present and allowlisted ---');
{
  const LADDER = ['cbandStructure','xbandStructure','srf650Cryomodule','srf805Cryomodule',
                  'cwCryomodule','nbSnCryomodule','srfLinacSector','twoBeamModule','plasmaAfterburner'];
  for (const id of LADDER) {
    const c = COMPONENTS[id];
    assert(!!c, `${id} exists`);
    assert(c.category === 'rf', `${id} is category rf`);
    assert(Array.isArray(c.beamlineTypes) && c.beamlineTypes.length > 0, `${id} is allowlisted`);
  }
  assert(COMPONENTS.plasmaAfterburner.requiredConnections.includes('dataFiber'),
    'plasmaAfterburner needs dataFiber, not rfWaveguide');
  assert(!COMPONENTS.plasmaAfterburner.requiredConnections.includes('rfWaveguide'),
    'plasmaAfterburner is not RF-fed');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-beamline-types.js`
Expected: FAIL — none of the nine exist.

- [ ] **Step 3: Add the catalogue entries**

Add all nine to `src/data/beamline-components.raw.js`, in the `rf` section, ordered by `energyGain` within their subsection so the file reads as a ladder. Each needs a `desc` following the house voice — concrete hardware, a real machine named, and the honest gradient statement required by "Resolved tension" above. `energyCost`, `apertureRadius` and `interiorVolume` scale from the nearest existing neighbour (`cryomodule` for the SRF family, `sbandStructure` for NC).

- [ ] **Step 4: Add utility port entries**

Add nine entries to `BEAMLINE_UTILITY_PORTS` in `src/data/utility-ports-v2.js`, following the `cryomodule` entry (line ~289) for SRF and `sbandStructure` (line ~257) for NC. Scale `demand` / `heatLoad` / `srfHeatW` / RF `demand` from the neighbour in proportion to `energyGain`. `plasmaAfterburner` gets `pwr_in` (large — the drive laser), `cool_in`, and `data_in`; **no `rf_in`**.

- [ ] **Step 5: Add research unlocks**

In `src/data/research.js`, append each id to exactly one node's `unlocks` array, matching the `requires` column of the data table. Nodes: `highGradientRf` (two entries), `cwLinacDesign`, `superconducting`, `cryomoduleDesign`, `nDopedSrf`, `colliderTech`, `highLuminosity`, `plasmaAcceleration`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node test/test-beamline-types.js && node test/test-registry-integrity.js && node test/test-utility-ports-v2.js`
Expected: PASS, with `KNOWN_OPEN_GATING` still empty.

- [ ] **Step 7: Verify physics accepts every new component**

Run: `python3 -m pytest test/ -q`
Expected: PASS — no `ValueError` from `beamline_config_from_game` on an unknown `physicsType`.

---

## Task 8: The three non-RF components — data

**Files:**
- Modify: `src/data/beamline-components.raw.js`, `src/data/utility-ports-v2.js`, `src/data/research.js`

| id | physicsType | category/subsection | cost $M | subL | requires | beamlineTypes |
|---|---|---|---|---|---|---|
| `fastKicker` | `dipole` | optics/focusing | 2.5 | 4 | `storageRingTech` | lightSource, collider |
| `recirculationArc` | `chicane` | optics/manipulation | 18 | 12 | `energyRecovery` | euvFel, lightSource |
| `finalFocusDoublet` | `quadrupole` | optics/focusing | 35 | 6 | `highLuminosity` | collider |

`recirculationArc` uses `role: 'junction'` with a `routing` array, following `injectionSeptum` (`beamline-components.raw.js`, search `injectionSeptum`) — a lateral bypass that leaves and rejoins the axis. It must not require new routing primitives; if it does, stop and raise it rather than extending the router.

`fastKicker` and `finalFocusDoublet` use `role: 'placement'`, `placement: 'module'`, `ports: { entry: { side: 'back' }, exit: { side: 'front' } }`.

`requiredConnections`: `fastKicker` `['powerCable','coolingWater','dataFiber']` (the PFN needs timing); `recirculationArc` `['powerCable','coolingWater']`; `finalFocusDoublet` `['powerCable','cryoTransfer']` (superconducting final-focus quads).

- [ ] **Step 1: Write the failing test**

Append to `test/test-beamline-types.js`:

```js
console.log('\n--- Non-RF additions ---');
{
  assert(COMPONENTS.fastKicker.beamlineTypes.includes('lightSource'),
    'lightSource can build a fast kicker');
  assert(COMPONENTS.recirculationArc.role === 'junction', 'recirculationArc is a junction');
  assert(Array.isArray(COMPONENTS.recirculationArc.routing), 'recirculationArc declares routing');
  assert(COMPONENTS.finalFocusDoublet.physicsType === 'quadrupole',
    'finalFocusDoublet models as a quadrupole');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-beamline-types.js`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement**

Add the three catalogue entries, three `BEAMLINE_UTILITY_PORTS` entries (scale from `injectionSeptum`, `chicane` and `quadrupole` respectively), and three `unlocks` additions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-beamline-types.js && node test/test-registry-integrity.js && npm test`
Expected: PASS.

---

## Task 9: Physics defaults

**Files:**
- Modify: `beam_physics/gameplay.py:21-27` (`COMPONENT_DEFAULTS`)
- Test: `test/test_all_modules.py`

- [ ] **Step 1: Rekey the dead entries**

`COMPONENT_DEFAULTS` carries three keys for components that have never existed in the JS catalogue. Rekey and revalue them to match this ladder:

| old key | new key | new `energyGain` |
|---|---|---|
| `cbandCavity` (0.8) | `cbandStructure` | 0.12 |
| `xbandCavity` (1.2) | `xbandStructure` | 0.30 |
| `srf650Cavity` (1.5) | `srf650Cryomodule` | 0.15 |

Leave `harmonicLinearizer` alone — it has no counterpart in this work.

Add entries for the remaining six RF components with their `energyGain` from Task 7's table. These are fallbacks only (catalogue `stats` win), so they must **agree** with the catalogue, never diverge.

- [ ] **Step 2: Verify**

Run: `python3 -m pytest test/ -q`
Expected: PASS.

Run: `grep -n "cbandCavity\|xbandCavity\|srf650Cavity" beam_physics/ src/ -r`
Expected: no hits — the dead keys are gone.

---

## Task 10: The coverage regression guard

**Files:**
- Create: `test/test-beamline-type-coverage.js`

This is the test that would have caught the original 220–595 figure. It is the acceptance gate for the whole spec.

**Interfaces:**
- Consumes: `BEAMLINE_TYPES`, `COMPONENTS`, `RESEARCH`, `beamlineTypeHidesComponent`, `BEAMLINE_CATEGORIES`.

- [ ] **Step 1: Write the test**

Create `test/test-beamline-type-coverage.js` following the plain-assert style of `test-registry-integrity.js` (module-level `assert`, `process.exit(1)` on failure). It asserts, for each of the nine types:

1. **Palette integrity** — at least one source, one `rf` component, and one id from `requiredEndpoint` are visible.
2. **Reach at full research** — the band top is reachable in **≤ 35** placements, computed as `ceil((bandHi - bestExtractionEnergy) / bestEnergyGain)` over components visible in that type's palette.
3. **Reach at unlock** — the same figure computed over only those palette components whose `requires` is satisfied by the research closure of the type's own `requires`, must be **≤ 40**.
4. **No orphans** — every beamline-category component is visible to at least one type.
5. **Denylist hygiene** — no `excludes` entry names an unknown component or one the allowlist already hides.

Source energy comes from the top-level `extractionEnergy` field (**not** `stats`); RF energy from `stats.energyGain`. Print the computed placement count per type so a regression reads as a number, not just a failure.

- [ ] **Step 2: Run it**

Run: `node test/test-beamline-type-coverage.js`
Expected: PASS, printing counts matching the spec's table — spallation 10–20, lightSource 5–12, euvFel 2–3, xfel 5–15, collider base 8–34, collider top ~33.

- [ ] **Step 3: Verify it actually guards**

Temporarily remove `srf650Cryomodule` from `spallation`'s reachable set (comment out its `beamlineTypes` entry), re-run, confirm the test FAILS with a spallation count in the hundreds, then restore.

Run: `node test/test-beamline-type-coverage.js`
Expected: PASS again after restoring.

---

## Task 11: Schematics — SRF cryomodule family

**Files:**
- Modify: `src/ui/overlays.js` (schematic drawer table)

Five drawers: `srf650Cryomodule`, `srf805Cryomodule`, `cwCryomodule`, `nbSnCryomodule`, `srfLinacSector`.

Signature `<id>(p, px, dot, W, H, cy, C, params)`, drawing at 70×30. References: `spokeCavity` (line ~2784) and `halfWaveResonator` (line ~2798). Use `_drawBeamPipe(px, dot, W, cy, C, { skipFrom, skipTo })` where the structure interrupts the pipe, and the shared palette `C` (`scMagnet` / `scMagDk` for superconducting).

- [ ] **Step 1: Implement the five drawers**

Per the spec's visual identities. They are the same family at different scales, so **the discriminator must be legible at 70×30**:
- `srf650Cryomodule` — 5 large elliptical cells, single cryo port stub on top.
- `srf805Cryomodule` — 6 visibly smaller cells, twin cryo port stubs. Must read as "one rung up" from 650.
- `cwCryomodule` — `cryomodule` cell count with a heavy cryogenic header bar along the top edge and doubled coupler boxes.
- `nbSnCryomodule` — same silhouette, warmer accent colour (4.5 K not 2 K) and a visibly smaller cryo connection.
- `srfLinacSector` — multiple cell groups separated by interconnect bellows, a distribution line spanning the full width, a row of coupler boxes.

- [ ] **Step 2: Verify each renders**

Run: `npm run test:browser -- --grep schematic` if a schematic spec exists; otherwise verify in the running app by opening the build palette for a type that can see each component and confirming a non-blank, non-generic schematic.

- [ ] **Step 3: Verify no drawer is missing**

Run: `node -e "import('./src/data/components.js').then(async ({COMPONENTS})=>{const src=await import('fs').then(f=>f.readFileSync('src/ui/overlays.js','utf8'));const ids=['srf650Cryomodule','srf805Cryomodule','cwCryomodule','nbSnCryomodule','srfLinacSector'];for(const i of ids)console.log(i, src.includes(i+'(p, px, dot')?'OK':'MISSING');})"`
Expected: all OK.

---

## Task 12: Schematics — NC structures and exotics

**Files:**
- Modify: `src/ui/overlays.js`

Four drawers: `cbandStructure`, `xbandStructure`, `twoBeamModule`, `plasmaAfterburner`.

- [ ] **Step 1: Implement the four drawers**

References: `sbandStructure`'s drawer for disc-loaded copper. Identities:
- `cbandStructure` — copper disc-loaded waveguide, cell pitch visibly finer than `sbandStructure`, one waveguide feed, water manifold along the top.
- `xbandStructure` — finest cell pitch on the ladder, small bore, waveguide manifolds above **and** below. Reads as a dense copper comb.
- `twoBeamModule` — two parallel beam lines at different heights (drive above, main below) linked by PETS transfer structures. The doubled axis is the identity.
- `plasmaAfterburner` — short capillary cell, large laser enclosure box beside the axis, turning-mirror housing. No waveguide anywhere — it must not read as RF hardware.

- [ ] **Step 2: Verify** — as Task 11 Step 3, with these four ids.

---

## Task 13: Schematics — non-RF

**Files:**
- Modify: `src/ui/overlays.js`

Three drawers: `fastKicker`, `recirculationArc`, `finalFocusDoublet`. References: `quadrupole` (line ~708), `chicane` (line ~1558), `dipole` (line ~664).

- [ ] **Step 1: Implement**

- `fastKicker` — small ferrite window-frame magnet dwarfed by its pulse-forming-network cabinet, thick coaxial pulse cables. The cables are the identity; do not let it read as a plain dipole.
- `recirculationArc` — pipe splits, arcs laterally, rejoins; small dipoles along the arc.
- `finalFocusDoublet` — two large quads back-to-back at different apertures in a shared cryostat, conical taper toward the IP (right edge).

- [ ] **Step 2: Verify** — as Task 11 Step 3, with these three ids.

---

## Task 14: 3D builders — SRF cryomodule family

**Files:**
- Modify: `src/renderer3d/component-builder.js`

Five `ROLE_BUILDERS` entries for the Task 11 components.

**Contract:** a builder takes no arguments and returns role buckets — `{ accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] }` — of already-transformed `BufferGeometry`. Reference: `_buildEllipticalSrfCavityRoles` (line ~2020), which is the closest existing analogue.

**Conventions that are not optional:**
- Axis at `BEAM_HEIGHT`; beam-pipe stubs plus CF flanges at the tile edges (`PIPE_R`, `FLANGE_R`, `FLANGE_H`).
- `applyTiledCylinderUVs` / `applyTiledBoxUVs` on **every** geometry — an untextured mesh reads as a bug.
- Support pedestals go in the `stand` bucket; LOD-droppable trim in `detail`.
- Register with `ROLE_BUILDERS.<id> = _build<Name>Roles;` beside the other RF builders.

- [ ] **Step 1: Implement the five builders**

Visual identities per the spec. Scale each to its `subL` from Task 7 (`subL * 0.5` metres).

- [ ] **Step 2: Verify no fallback geometry**

Run: `npm run dev` is **not** required — instead run the app's existing console check. Load any page that imports `component-builder.js` and read the `[content] N beamline component(s) using fallback box/cylinder geometry` info line (`component-builder.js:2227`).
Expected: none of the five appear in that list.

- [ ] **Step 3: Verify templates build without throwing**

Run: `npm run test:browser` if a renderer spec covers component templates; otherwise place one of each in the designer and confirm no console error.

---

## Task 15: 3D builders — NC structures and exotics

**Files:**
- Modify: `src/renderer3d/component-builder.js`

Four builders for the Task 12 components. Reference: `_buildSbandStructureRoles` (line ~1500) for disc-loaded copper, `_buildRFCavityRoles` (line ~1400).

- [ ] **Step 1: Implement**

`twoBeamModule` needs two parallel axes — the drive beam offset above `BEAM_HEIGHT`, main beam on it — with PETS blocks between. `plasmaAfterburner` is the one that must **not** look like RF: a small capillary on-axis, a large `detail`-role laser enclosure box offset to one side, and turning-mirror housings.

- [ ] **Step 2: Verify** — as Task 14 Steps 2-3, with these four ids.

---

## Task 16: 3D builders — non-RF

**Files:**
- Modify: `src/renderer3d/component-builder.js`

Three builders for the Task 13 components. References: `_buildQuadrupoleRoles` (line 1015), `_buildDipoleRoles` (line ~950).

- [ ] **Step 1: Implement**

`finalFocusDoublet` reuses the quadrupole yoke idiom at two different apertures in one cryostat. `fastKicker` is mostly cabinet and cable, not magnet. `recirculationArc` must render its lateral bypass consistently with the `routing` it declares in Task 8 — the geometry and the router must agree on which side the arc leaves.

- [ ] **Step 2: Verify** — as Task 14 Steps 2-3, with these three ids.

- [ ] **Step 3: Full-suite verification**

Run: `npm test`
Expected: all suites PASS.

Run: `node scripts/build-wiki.mjs`
Expected: clean; if any wiki article references the new components, `src/data/wiki/articles.generated.js` regenerates and the staleness check at `build-wiki.mjs:75` passes.

---

## Post-implementation: calibration (not part of the build)

These are measurements, deliberately excluded from the tasks above because they must be taken against the finished catalogue, not guessed during implementation:

- Re-measure `collider.fomRef` against the `[45, 500]` band in `scripts/balance-sim.mjs` and replace `1e32`.
- Check per-rung costs against total capital per type. Expect ~$1.2–2.5B per arm for a base collider and ~$8.4B for the TeV configuration, against a `colliderTech` research cost of $41M. This is the number most likely to need adjusting after a play pass.
- Regenerate `src/data/stock-designs.measured.json` via its existing script for any stock design touching a changed component. Do not hand-edit it.
