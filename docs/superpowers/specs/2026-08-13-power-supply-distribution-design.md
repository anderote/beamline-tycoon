# Power: supply → distribution, and what a shared subtile means

**Date:** 2026-08-13
**Status:** Approved for planning

## Problem

### 1. There is no power chain

Every power component in the catalogue is a standalone `source` that conjures
capacity out of nothing:

| type | capacity | role today |
|---|---|---|
| `hvTransformer` | 1200 kW | source |
| `switchgear` | 400 kW | source |
| `mcc` | 250 kW | source |
| `padMountTransformer` | 150 kW | source |
| `ups` | 100 kW | source |
| `powerPanel` | 40 kW | source |

Six panels is 240 kW from thin air. Worse, `availablePorts`
(`src/utility/ports.js:75`) exempts `source` ports from the claimed-port
filter, so **one** port fans out to the entire facility. Nothing is scarce:
not capacity, not outlets, not position. "How much power plant, and where"
is not a question the player is ever asked.

### 2. A shared subtile means exactly one thing, and it is the wrong thing

`discoverNetworks`' spatial-union pass (`network-discovery.js:274`) merges any
two same-type lines that share a 0.25 subtile. Because that is the *only*
meaning available, `pathOverlapsSameType` has to reject every shared subtile —
so two power cables may not cross, ever. In a hall with a few runs in it that
makes whole regions unroutable, and the refusal is the same one the player gets
for genuinely running down an existing trunk.

The two ideas are conflated. A cable crossing over another cable is not
connected to it. A cooling line teed into another cooling line is.

## Design

### A. What a shared subtile means, by geometry

| shared subtile | reading | permitted |
|---|---|---|
| an **endpoint** of one run, interior of the other | a tee — the two are joined | only when the descriptor declares `allowsTap` |
| interior of both, runs **perpendicular** | a crossing — never joined | always |
| interior of both, runs **collinear** | laying cable down an existing run | never |

`allowsTap` — cooling, vacuum, cryo: **yes**, they are pipes and you tee into
them with a fitting. Power, RF, data: **no**. A cable, a waveguide and a fibre
are point-to-point runs terminated at both ends; you do not cut one open in the
middle, you go back to a distribution device.

This retires the current blanket ban. Crossings become legal for every utility,
which is most of what makes routing feel boxed in, and the spatial union is
narrowed to endpoint contact so a crossing cannot silently merge two networks.

### B. Power is a two-stage chain

A new utility type, `hvCable` — **black**, thick, expensive per metre. It runs
supply → distribution and nothing else, enforced by the port tables rather than
by convention:

```
  supply                  hvCable (black)              distribution
  hvTransformer  ─────────────────────────────────►  powerPanel   ─┬─ powerCable ─► magnet
  switchgear                                          mcc          ├─ powerCable ─► cavity
  padMountTransformer                                 ups          └─ powerCable ─► rack
                                                      powerBus
```

- **Supply** holds all the capacity and exposes HV outlets. Three tiers, so
  "how big a grid connection" is a decision that scales with the facility:
  `padMountTransformer` 150 kW / 1 HV outlet, `switchgear` 400 kW / 2,
  `hvTransformer` 1200 kW / 4.
- **Distribution** takes one HV inlet and exposes N branch outlets. It adds
  **no capacity** — the supply still has to carry everything downstream. That
  is not a new principle: it is exactly what `network-discovery` already
  documents for distribution buses ("The bus adds NO capacity").
- Outlet counts: `powerPanel` 4, `mcc` 8, `ups` 2 (its identity is that only
  the critical circuits go on it), `powerBus` keeps its four bus faces and its
  `serviceRadius` coverage of on-pipe sinks.

### C. Outlets are countable

A power cable is point to point: one plug, one socket. Power ports therefore
stop fanning out — every outlet takes exactly one cable, and a 4-way panel
feeds exactly four machines.

This needs almost no new machinery: `availablePorts` already drops a claimed
port unless its role is `source`, so the exemption becomes conditional on a
descriptor flag (`fansOut`, true for the fluid utilities where a manifold
genuinely feeds several branches, false for power and HV).

Consequences worth stating:
- The fifth machine needs a second panel, and a panel has to be *near* what it
  feeds — that is the placement decision the current model doesn't have.
- Shift-drag run-wiring keeps working: it walks the panel's free outlets and
  reports when it runs out, instead of fanning one port infinitely.

### D. A distribution device delivers only what it is fed

An unfed panel must not power anything. The HV network and the branch networks
are separate networks of separate types, so the coupling is explicit: a
distribution device's outlet capacity is scaled by the quality its own HV sink
last solved to. Quality 0 (no HV feed, or a starved one) → outlets deliver
nothing.

The mechanism already exists — `state.nodeQualities`, the gate's fail-closed
aggregation (`UTILITY_TO_QUALITY_FIELD`, `sinkQualityFloorFrom`). What is
missing is the solver's access to it, which is the bug below.

### E. `worldState` is not the world

`UtilityGate.run` calls `runSolve({ tick: state.tick })`, and that object is
handed to every descriptor as `worldState`. But `vacuumPipe.solve` and
`cryoTransfer.solve` call `endpointsById(worldState)`, which reads
`worldState.placeables` and `worldState.beamPipes` — both `undefined` in the
live game. So `isBaked` is permanently false and beam-pipe outgassing is
permanently 0: bakeout is a purchasable upgrade that does nothing, and vacuum
pumps down more easily than the model says. The solver unit tests pass a real
state, which is why it has never surfaced.

Fix: pass `state` itself (it already carries `tick`, so nothing else changes).
Vacuum will get harder — that is the model working, and the vacuum tests pin
the physics, not the plumbing.

`hvCable` must solve before `powerCable` in `UTILITY_TYPE_LIST` so a panel's
gate reads the same tick's HV result rather than the previous one.

## Deliberate non-goals

- **No per-outlet metering.** An outlet delivers what its network needs; the
  supply either covers the total or the whole network is overloaded. Modelling
  breaker trips per circuit is a different game.
- **No voltage as a number.** HV vs branch is a topology distinction, not a
  quantity to balance.
- **UPS does not store energy yet.** It is distribution with two outlets. Real
  ride-through during an outage is a separate feature and wants an outage to
  ride through first.
- **No migration.** Pre-release, single user — old saves and existing scenario
  wiring break and get re-wired (CLAUDE.md).

## Acceptance criteria

1. Two power cables may cross without joining networks; two cooling lines that
   cross do not join either, but one that *ends on* another does.
2. A drag that runs down an existing line of the same utility is still refused,
   and says so in the drag tooltip before release.
3. A machine cabled to a panel is powered only while that panel has a live HV
   feed from a supply with capacity to spare.
4. A panel's outlets are exhaustible: the (N+1)th machine has no port to take,
   and the port markers show it.
5. Total facility capacity equals the sum of *supply* ratings — no arrangement
   of distribution gear increases it.
6. `worldState` reaches the solvers, and the vacuum suite still passes with the
   beam-pipe outgassing term live.
