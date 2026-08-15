# Beamline Tycoon — Infrastructure Wiki

Player-facing documentation for facility infrastructure systems. Each article teaches real accelerator infrastructure concepts in the context of gameplay.

## Structure

Each article has three sections:
- **Quick Tip** — one-line tooltip for in-game display
- **How It Works** — plain-language explanation with real units
- **The Math** — actual equations for players who want the full picture

## Files

### Fundamentals
- [utility-networks.md](utility-networks.md) — Core concept: how isolated utility networks form and why topology matters

### Systems
- [power.md](power.md) — Electrical power: transformers, distribution panels, power cables, capacity budgeting
- [vacuum.md](vacuum.md) — Staged pump-down, conductance, gas density, gauges, and beam-gas scattering
- [rf-power.md](rf-power.md) — RF power: sources, duty factor, frequency matching, `sqrt(P)` gradient, reflected power
- [cooling.md](cooling.md) — Cooling water: chillers, LCW, cooling towers, heat load, thermal detuning
- [cryogenics.md](cryogenics.md) — Cryogenic systems: cold boxes, bath temperature, Q0(T), thermal quench
- [controls.md](controls.md) — Data, controls, and safety: IOCs, MPS wear, staffing, what is inert

### Quality & Rooms
- [infrastructure-quality.md](infrastructure-quality.md) — How each utility reaches the beam, fail-closed defaults, soft vs hard failures
- [rooms.md](rooms.md) — Room detection, auto-classification, morale, and what is inert

### Reference
- [connection-types.md](connection-types.md) — All six connection types and what they carry
- [required-connections.md](required-connections.md) — What each component needs to function
- [glossary.md](glossary.md) — Infrastructure terminology

### Maintenance
- [AUDIT.md](AUDIT.md) — Record of every claim corrected against source, with references. Not player-facing.
