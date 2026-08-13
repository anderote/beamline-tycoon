# Growable Map & the Black Hole Factory

**Date:** 2026-08-12
**Status:** Approved for planning

## Problem

`collider-zpole`, `collider-higgs` and `collider-tev` measure in band through the real physics engine and **cannot be placed on the map**. `test-stock-designs.js` and `test-design-layout-fidelity.js` are red because of it.

The cause is not area, it is **straight-run length**:

| blueprint | path | bend components | places? |
|---|---|---|---|
| `collider-zpole` | 118 tiles | **0** | ❌ |
| `collider-higgs` | 160 tiles | **0** | ❌ |
| `collider-tev` | 198 tiles | **0** | ❌ |
| `xfel-flagship` | 111 tiles | 2 | ✅ |

A design lays out by following its own components' routing: straight modules continue, dipoles and chicanes turn. The XFEL carries chicanes, so its 111 tiles fold into a 71-tile map. The collider carries no bending element at all, so its path is a straight line longer than the map.

**This is the correct physics and should not be worked around.** A linear collider must not bend: synchrotron loss goes as E⁴/ρ, so folding a 500 GeV electron beam radiates away the energy you just spent 34 placements building. The land genuinely has to be there.

That makes map size a real constraint on the top-tier machines, and therefore a thing worth selling to the player.

## Design

Three pieces, in dependency order.

### A. The map becomes growable

Today `MAP_EXTENT = 35` is a compile-time constant meaning "half-side of the square map region" (`|col| <= 35`, i.e. 71×71 tiles). It is duplicated in three places that must agree:

- `src/game/map-generator.js:108` — the generator's own bound, plus `WORLD_BOUND`, `LONG_EXTENT`, `NARROW_EXTENT`
- `src/renderer3d/world-snapshot.js:12` — `GRASS_RANGE`, which iterates the drawn ground
- `src/game/agent/observation.js:1` — a second independent `MAP_EXTENT = 35`

Replace the constant with **`state.mapHalfExtent`**, a saved number. All three sites read it rather than a literal.

| `mapHalfExtent` | tiles per side | max straight run | what it makes siteable |
|---|---|---|---|
| **30** *(start)* | **61** | 61 | everything through tier 4 |
| 60 | 121 | 121 | `collider-zpole` (118 tiles) |
| 90 | 181 | 181 | `collider-higgs` (160) |
| 120 | 241 | 241 | `collider-tev` (198) **and** the Black Hole Factory (209) |

Each purchase adds **+30 half-extent = +60 tiles per side**, and there are exactly three of them. The ladder is sized so **every purchase unlocks precisely one collider tier**, and the last also unlocks the tier-6 machine — the land ladder and the machine ladder are the same progression seen from two sides.

The map stays square. Growth is symmetric on both axes — simpler than an elongated map, and the straight-run budget rises just as fast because a run may lie along either axis.

**The starting map shrinks.** 61×61 is 3,721 tiles against today's 71×71 = 5,041, a 26% reduction. This is deliberate — a starting map you outgrow is what makes land worth buying — but it is a real change to every existing save and to the first hour of play. Task 1 must verify that every *non-collider* blueprint still places at 61 tiles; `xfel-flagship` is the one at risk, at 111 tiles of path folded through 2 bends.

### B. Land is purchasable

A tycoon-genre land purchase, in RCT2's shape: **pure money, no research gate**, escalating per chunk. It is the only large late-game cash sink in the game and the only route to the tier-5 and tier-6 machines.

Costs escalate steeply because each chunk is a bigger annulus of land than the last (the area added by +15 half-extent grows linearly with the current extent):

| purchase | half-extent | tiles/side | cost | unlocks |
|---|---|---|---|---|
| Land Acquisition | 60 | 121 | $500M | Z-pole collider |
| Compulsory Purchase | 90 | 181 | $3B | Higgs factory |
| *Site Condemnation* | 120 | 241 | $15B | TeV collider · Black Hole Factory |

Provisional, per the project's standing rule: measure against the economy in `scripts/balance-sim.mjs` before shipping.

**Terrain for newly-bought land is generated on purchase**, from the existing `terrainSeed` and `terrainBlobs`, so the annulus is deterministic and matches what the generator would have produced had the map always been that size. A save records only `mapHalfExtent`; the ground regenerates.

### C. The Black Hole Factory — tier 6

**1000 TeV centre-of-mass = 500,000 GeV per beam.** At the current best rung (`plasmaAfterburner`, 15 GeV per 5 tiles = 3 GeV/tile) that is 166,667 tiles. It needs hardware three orders of magnitude beyond the RF ladder.

**`crystalChannelStage`** — acceleration by channeling between crystal lattice planes. The theoretical accelerating field in a bent crystal is **1–10 TeV/m**, roughly a thousand times a plasma wakefield. It is a real proposal in the literature, which is what makes it the right top rung: absurd in effect, not invented.

| rung | GeV/placement | subL | gradient | GeV/tile |
|---|---|---|---|---|
| `plasmaAfterburner` *(existing)* | 15 | 20 | 1.5 GV/m | 3 |
| **`crystalChannelStage`** | **12,000** | 20 | **1.2 TeV/m** | **2,400** |

500,000 GeV ÷ 12,000 = **42 placements = 210 tiles**, leaving ~31 tiles of the 241-tile map for the injector chain and the interaction region. That requires `mapHalfExtent` 120 — Site Condemnation, the final purchase. The machine and the last chunk of land are designed against each other: nothing else in the game needs that land, and the Black Hole Factory cannot exist without it.

1.2 TeV/m sits inside the 1–10 TeV/m range the channeling literature discusses, so the top rung is the most physically honest one on the whole ladder — as `plasmaAfterburner` already is at 1.5 GV/m.

Type entry:

- `id: 'blackHoleFactory'`, `tier: 6`, `machineType: 'blackHoleFactory'`
- `particle: 'p+p-'` — hadrons, because the interesting cross-section is partonic and because e+e- at 500 TeV would radiate impossibly in the final focus
- `spec.energyGeV: [100000, 500000]` — 200 TeV to 1 PeV centre-of-mass
- `fom: 'blackHoleYield'`, band-gated like every other type
- `requires` — a new research node beyond `colliderTech`; the tech tree has 44 empty nodes, so a home almost certainly already exists (check before adding one)
- `requiredEndpoint: ['blackHoleChamber']`
- `dutyFactor` very low; this is a machine that fires rarely and spectacularly

Two new endpoint components: **`blackHoleChamber`** (the interaction region) and **`hawkingDetector`**, which pays in reputation and discovery rather than cash — consistent with the collider's "nothing commercial" identity, taken further.

## Consequences

**The three collider blueprints cannot ship as starting content.** At `mapHalfExtent` 35 all three are unplaceable, and that is now by design rather than by accident: a linear collider is a machine you buy land for. Two things follow:

1. `test-stock-designs.js` must place each blueprint on a map expanded far enough for its type, not on the default map. The assertion becomes "places on a map this type could exist on", which is the honest version of what it was already trying to check.
2. The blueprint picker must show a land requirement on cards it cannot currently site, rather than offering a design that will fail to place. Same discipline as the existing rule that a card may never advertise an energy the machine does not reach.

**The coverage guard needs a length criterion.** `test-beamline-type-coverage.js` asserts placement *count* (≤ 35 at full research) and never checks the length those placements occupy. That is precisely the hole this whole problem fell through — the collider passed at 34 placements while being physically unsiteable. Add: for each type, the band top must be reachable within the straight-run budget of the largest purchasable map, and record which `mapHalfExtent` each type needs.

## Out of scope

- Rectangular or non-square maps. Growth is symmetric; an elongated map was considered and rejected as a larger change for the same straight-run benefit.
- Selling land back.
- Terrain features (hills, water) in newly acquired land differing from the base generator's output.
- A real Hawking-radiation or black-hole-production physics model. `blackHoleYield` is a figure of merit computed from energy and luminosity, in the same spirit as the existing FoMs; `beam_physics/` gains no new module.

## Acceptance criteria

1. `mapHalfExtent` is saved state; all three former `MAP_EXTENT` sites read it and agree. No literal `35` map bound survives in `src/`.
2. A fresh game starts at 71×71 and is pixel-identical to today's starting map for the same seed.
3. Buying a chunk extends the map by 30 tiles per side, generates the new annulus deterministically from the existing seed, and survives a save/load round trip.
4. `test-stock-designs.js` and `test-design-layout-fidelity.js` are green, with collider blueprints placed on an appropriately expanded map.
5. `node scripts/eval-design.mjs` still reports every blueprint in band.
6. `test-beamline-type-coverage.js` gains the straight-run criterion and records the required `mapHalfExtent` per type.
7. `blackHoleFactory` reaches 500,000 GeV/beam in ≤ 55 placements within a 251-tile straight run, verified by a blueprint that measures in band.
8. `npm test` green.
