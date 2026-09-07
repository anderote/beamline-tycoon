# Balance and progression audit — 7 September 2026

**Verdict:** the game has a promising engineering loop, but the current content and economy do not yet establish a coherent 10–20-hour career. The existing lab starts easily; the transition from that lab into profitable, research-producing expansion is the weak point. Raising research prices now would risk stretching broken or unrewarding steps.

Owner target: getting a lab running should be relatively simple; late-stage accelerators should take roughly 10–20 hours. Proposed milestones below are design targets, not measured completion times. Assume elapsed player time at normal play, including construction and tuning. The game supports 1×/2×/4× speed; 36,000–72,000 ticks corresponds to 10–20 hours only at 1×. A career must also be evaluated with normal use of fast-forward.

## Changes implemented after the baseline audit

The findings below describe the starting revision, not unresolved failures in every current recipe. This pass implements the following improvements:

- Sixteen former beam-stop or generic-target endings now use purpose-built materials stations, X-ray converters, irradiation vaults, isotope targets, treatment gantries, XFEL endstations or EUV collectors. These existing components already have rendered hardware, research gates and power/cooling/data ports. Their integrated scanners, dosimetry and sample/target handling made duplicate new component definitions unnecessary.
- All **30/30 stock designs now pass native energy/current/endpoint-band checks**, up from 15/30. Repaired injector matching, transport optics and source settings restore useful current. The 70 MeV isotope upgrade uses a higher-current cyclotron and production target; the full-depth therapy line uses five spoke cavities and a 650 MHz booster before its selection stage and gantry. The 650 MHz module is now available to therapy as well as spallation, retaining its research and utility gates.
- All **24 commercial/commissioning stock designs produce positive service revenue and research data** under the native ideal-utility evaluation. Commercial acceptance now tests those outcomes as well as operating bands. The fundamental-research families intentionally do not receive commercial-service income.
- Processing service calibration now uses a 500 kW reference rather than 100 kW, so normal in-band upgrades do not immediately hit the output cap. Measured X-ray/irradiation service income progresses from approximately **$618 → $1,129 → $1,631/t**. These are service revenues, not net facility profits.
- Minor Lab automatically hires its starting scientist through the normal hiring contract, including the $2,500 hiring cost and ongoing salary. The native opening regression requires first beam within 60 ticks, usable data within 100 ticks and a positive operating balance without further staffing intervention.
- Research cannot overwrite an active paid project; the all-research milestone requires every visible node. Inclusive mission bands share a floating-point roundoff tolerance across evaluation, revenue and the Designer display. A computed 70.00000000000006 MeV is accepted at a 70 MeV ceiling; materially excessive energy still fails and hard-ceiling contracts still pay zero.
- Generated stock measurements have been refreshed. The simulation lane now exercises native stock-service and opening contracts alongside the existing economy scenario test.

Current measurements are saved in [`2026-09-07-results.json`](2026-09-07-results.json). Reproduce them with `node scripts/audit-progression.mjs --native --stock-native --ticks=600`.

**Still open:** the full 10–20-hour career has not been simulated. Minor Lab still uses legacy untyped beamline income. The native frontier black-hole recipes retain negligible delivered current, and the FEL recipes do not establish saturation; neither a band pass nor a positive endpoint data floor proves their intended scientific performance. The photon-service model is also still a simplified delivery/availability proxy. Those are material limits, not resolved by adding useful endpoints. Higher-tier service prices, infrastructure payback and milestone semantics still need the staged career validation below.

## What was measured

Baseline: `dev` commit `6af0efbe`. Fixed seed `20260907`. Source-authored Minor Lab, using `launchScenario`, the actual Game tick loop, real utility solving, and native Python gameplay physics through the public engine seam. No browser, saved browser-local scenario, or manual interaction was inspected. Native execution checks simulation logic, not Pyodide scheduling or browser playability.

- Opening A: start available beams, 300 ticks, no purchases or interventions.
- Opening B: same start plus one scientist hired through `Game.hireStaff`, 600 ticks. No repairs, new construction, research purchases, or automatic refills.
- Stock designs: all 30 through `scripts/eval-design.mjs` using ideal utilities and no research bonuses. Revenue projections use the production revenue function, full data connectivity, and the measured beam. These are **gross**, before utilities, staffing and consumables; they do not prove profitability or buildability.
- Research/blueprint cost traversal: unique transitive component-research prerequisites. Hardware sums exclude pipes, utility equipment/wiring, floors, buildings, land and commissioning. Utility research gates are also excluded, so these are lower bounds.
- Existing economy simulation: the legacy starter and larger two-line fixtures pass their operating-balance thresholds. This does not test an advancing career.

The pre-change opening is retained in [`2026-09-07-baseline.json`](2026-09-07-baseline.json). Commands below exercise the updated content; the additional-hire flag now adds a second scientist because the starter already includes one.

Reproduce current measurements:

```sh
node scripts/audit-progression.mjs --native --ticks=300
node scripts/audit-progression.mjs --native --stock-native --ticks=600
node scripts/eval-design.mjs
npm run test:simulation
```

The audit prints observations as JSON; out-of-band stock designs are findings in `bandCheck`. The separate design evaluator exits nonzero for them. Native physics errors fail the audit rather than silently accepting fallback results.

## Baseline findings, in priority order

### 1. The stock commercial expansion path often has no customer

Every e-beam, therapy, XFEL and EUV stock design terminates in `beamStop`. So do two of three test stands. These endpoints are permitted by their mission, but `ENDPOINT_CONTRACTS.beamStop.baseRevenue` is zero. A blueprint can therefore pass the physics/mission check without doing the work its name implies.

Examples, ideal gross dollars per tick:

| Stock design | Gross | Endpoint-service revenue | Implication |
|---|---:|---:|---|
| Gun Test Bench | 99 | 9 | Cheap commissioning, not an expansion engine |
| E-beam Sterilisation | 70 | 0 | An in-band sterilisation line has no paying processing endpoint |
| Therapy Spoke 145 | 218 | 0 | An in-band therapy line earns no treatment fee |
| XFEL Hard X-ray | 290 | 0 | An in-band XFEL has no paying experimental endstation |
| EUV Fab | 200 | 0 | No fab contract at the beam stop; also out of current band |
| Isotope Cyclone 30 | 1,150 | 1,069 | Demonstrates an endpoint that actually pays |

This is a content/economy mismatch rather than evidence that every noncommercial accelerator should pay for itself. Fundamental-research machines deliberately have no commercial endpoint revenue and should be financed by other facility work.

**Action:** retain beam-stop variants as explicitly named commissioning designs; provide separately validated service designs with the intended endpoints, utilities and scientific output. Do not simply replace endpoints without rechecking optics, cooling, current and construction legality.

Sources: `src/data/stock-designs/*`, `src/game/endpoint-economy.js`, `src/game/economy.js`.

### 2. Half the stock designs miss their operating bands

Native evaluation: **15/30 pass**. Passing a band is not proof of a successful business or useful research output.

| Family | Passing | Main failure |
|---|---:|---|
| Test stand | 1/3 | Upgrades lose almost all transmitted current |
| E-beam | 1/3 | Starter slightly exceeds current band; top upgrade loses current |
| Isotope | 1/3 | Both booster upgrades fall below current band |
| Therapy | 1/3 | First over-current; final almost no transmitted current |
| Spallation | 3/3 | No band failures in this evaluation |
| Light source | 0/3 | Current far below 200–500 mA specification |
| XFEL | 3/3 | Band pass does not establish endpoint revenue |
| EUV | 0/3 | Current declines further below band with each upgrade |
| Collider | 3/3 | Band pass does not establish discovery/data throughput |
| Black-hole factory | 2/3 | Final design exceeds the 500,000 GeV ceiling |

These span small threshold misses and severe beam-loss failures; they are not all equally broken. For example, the first e-beam design produces 104.83 mA against a 100 mA ceiling, while the final therapy design has essentially no transmitted current. Fix the recipe or model responsible, not the acceptance bands merely to make the report green.

**Action:** repair the entry/upgrade content before deriving payback curves. Include useful delivered output in acceptance criteria, especially for families whose specification has no current band. The follow-up implementation above repairs the band failures through native evaluation; frontier scientific-yield validation remains separate.

### 3. Minor Lab runs immediately but teaches a different economy

The baseline supplies **1,440 placeables, 287 utility lines, two untyped beamlines and $5M**, with one operator and no scientist. It is a ready-built campus, not a simple first construction exercise. Starting available beams worked at the first tick; this measures readiness, not how easily a new player finds the controls.

At tick 300, native physics gives about **$3,902/t gross, $1,214/t upkeep, $2,689/t net**. The two beams have roughly 0.94 and 0.91 quality. Their `typeId` is null: they receive legacy hardware-count revenue, not typed endpoint-service revenue. They are financially much stronger than several named stock upgrades before the latter even pay upkeep.

The untouched start accumulates raw data but **zero spendable research data**, because there is no scientist. It has 48/t ingest and 48/68 CPU/GPU capacity against only 0.2/t incoming raw data. Buying more computing equipment is not the next useful step.

Hiring one scientist produces first spendable data at tick 8 and **118.1 data by tick 600**, while net remains positive (about $2,479/t at the final checkpoint). A staff break temporarily stops processing; buffered data is later recovered. Every entry research node costs at least 65 data, so the missing scientist is a real onboarding dependency, but not a permanent deadlock.

**Action:** make “hire/assign a scientist → collect usable data → first research” an explicit opening sequence. Prefer one small typed, useful machine with a serviceable utility package for a future career starter. Preserve the current campus as an advanced/editor scenario if desired. Do not silently retype the existing save without checking its physics and income.

### 4. The late-game funding bridge is not demonstrated

Visible research totals **70 nodes, $597.96M, 18,499 data**, maximum reputation gate 2,200. Sum of nominal research durations is 5,005 seconds (83.4 minutes); actual time depends on lab gates, quality, morale and scientist work. Lab tier zero makes early research slower; deep nodes need labs and leaf nodes require tier 2. Timer duration alone is not the intended 10–20-hour progression.

Representative lower bounds for entire stock machines:

| Machine | Hardware | Component research | Combined lower bound |
|---|---:|---:|---:|
| E-beam Sterilisation | $1.04M | $0 | $1.04M |
| Isotope Cyclone 30 | $8.87M | $7.60M | $16.47M |
| EUV Pilot | $50.37M | $32.30M | $82.67M |
| Spallation Compact | $165.47M | $31.58M | $197.05M |
| XFEL Hard X-ray | $319.43M | $80.98M | $400.41M |
| Collider Z-pole | $1,478.53M | $119.50M | $1,598.03M |
| Black-hole Threshold | $12,122.03M | $78.00M | $12,200.03M |

A $1.60B collider requires average accumulation of roughly **$22k–44k per second** over 20–10 simulation hours, before infrastructure. The $12.20B black-hole machine requires roughly **$169k–339k/s**. These are arithmetic scale checks, not simulated career times: initial capital, shared research, objective grants, staged reinvestment and speed change the actual result. Merely holding the initial ~$2.7k/t net constant would take about 165 hours for the collider lower bound.

The present research gates do not themselves enforce the thematic order: the black-hole threshold blueprint's component prerequisites total less research and require lower reputation than the first collider (1,100 versus 2,200). Its enormous hardware cost is doing most of the gating. All mission families are intentionally selectable from the start; progression changes should gate hardware and achievements, not remove mission choices.

**Action:** first choose which machines define the 10–20-hour finish. A collider is a reasonable core-career capstone; treat the black-hole factory as an optional postgame unless its funding route is deliberately supported. Balance profitable industrial fleets and scientific facilities together, including their marginal infrastructure/staff costs. Finishing the whole tech tree is a different target from commissioning one late machine.

### 5. Milestones and research need stronger progression contracts

Confirmed small defects fixed in this audit:

- Starting another research project overwrote the paid active project and its progress. The public start command now rejects this without spending resources; a new project can begin after completion.
- “Complete all research” counted array entries, so hidden legacy research or duplicates could replace a missing visible node. It now requires every visible research id and still pays only once.

Other milestone findings to address when redesigning progression:

- “CW Operation” checks continuous running time without testing the mission's duty factor.
- “Full Catalog” says “at least once” but checks the current flattened beamline, not historical construction, and includes mutually specialized components. A career-spanning collection objective needs a saved build-history contract.
- Several operation/measurement goals check installed hardware or aggregate physics rather than proving useful delivery on the relevant running line. Tier labels do not sequence awards: the ready-built start earns higher-tier construction/utility goals immediately.
- `allResearch` and other one-time rewards should not substitute for a sustainable operating balance.

Sources: `src/data/objectives.js`, `src/game/objectives.js`, `src/game/research.js`. New boundary coverage: `test/test-progression-contracts.js`.

## Proposed experience curve

| Elapsed player time | Milestone | What should make it satisfying |
|---|---|---|
| 0–10 minutes | First useful beam | One small recipe, obvious connections, forgiving cash runway |
| 10–30 minutes | First data and research | Scientist/data bottleneck is visible; one useful upgrade completes |
| 30–120 minutes | First profitable expansion | A working service endpoint pays for incremental growth |
| 2–6 hours | Specialized facility | Choose industrial income, scientific throughput, or both |
| 6–10 hours | Large RF/SRF and facility scale | Cooling, staffing, reliability and lab specialization matter |
| 10–20 hours | Commission a late scientific accelerator | Earlier commercial investment funds a major scientific project |
| Afterward, optional | Frontier/black-hole megaproject | Explicit postgame scale and funding route |

Keep recurring choices available while a major project accumulates funds. A player should usually be able to improve delivery, repair a weak utility, staff a lab, or begin a smaller expansion instead of having only a wait button. Large fleet strategy should help, but duplicating one cheap recipe should not trivialize the career.

## Implementation order and acceptance criteria

1. **Repair stock service designs and optics.** At least one usable entry and upgrade per family; validate placement, utility topology, native delivered beam, paying/scientific endpoint and net facility cost.
2. **Establish a career opening.** Demonstrate first beam and first spendable data without knowing hidden staffing rules. Verify sufficient initial money for its complete utility package and an early mistake.
3. **Measure two advancing strategies.** A compact research-focused facility and a commercial fleet funding research. Log purchases, first beam/data/research, milestone times, bankruptcy, and time blocked separately on cash/data/reputation/labs. Include maintenance, staff breaks and consumables; use native physics and reject invalid builds before interpreting economy.
4. **Tune the curve from those runs.** Set useful upgrade/payback ranges and large-project grants or contracts only after useful services are demonstrably operating. Calibrate to the agreed finish and speed usage.
5. **Owner gameplay check.** Assess whether wiring, diagnosing the first stalled data pipeline and choosing an expansion are understandable. No browser was authorized or used for this audit; no local server was launched or changed.

The report is an audit and prioritized design plan, not a claim that the complete 10–20-hour curve has been validated. The current operating tests are necessary but insufficient evidence for that claim.
