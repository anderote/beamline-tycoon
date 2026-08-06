# RimWorld-Inspired Staff System — Design Spec

**Date:** 2026-08-05
**Scope:** Game loop, facility, staff agency
**Status:** Draft for muse-edits

## Problem

Current staff is 4 counters (`operators:1, technicians:0, scientists:0, engineers:0`) with flat `$/tick` costs and two behaviors:
- `technicians` auto-repair (`_autoRepair` 2 HP/5 ticks)
- `scientists` multiply data `* (1 + 0.1*n)`

No individuality, no facility linkage, no RimWorld-like story. The beautiful facility zones (controlRoom, cafeteria, labs) have no gameplay reason to exist. Players hire counts, not people.

Beamline Tycoon wants RimWorld's intimate staff drama — but scoped to a facility sim, not a colony combat game.

## Goals

1. **Individuals, not counts** — each hire is a named pawn with traits/skills/mood
2. **Facility matters** — zones and furnishings affect staff needs and work efficiency (cafeteria → food/morale, officeSpace → rest, labs → research speed)
3. **Work assignments** — staff assigned to zones/roles; unstaffed beamlines-labs underperform or trip
4. **Tycoon aesthetic preserved** — chibi isometric pawns, `Press Start 2P`, pixelated, same `ThreeRenderer` entities system (already has deer)
5. **Scales** — 5 staff early, 25 late; tick cost O(n) with cheap needs loop

## Non-Goals

- Combat, raids, or RimWorld ideology/relationships graph (no romance, no factions)
- Full pathfinding or 3D pawn movement (pawns are HUD portraits + abstracted location, not walkers)
- Save compatibility (project is pre-release; break saves)

## Design

### 1. Data Model

**StaffMember** (`src/game/staff/StaffMember.js`):

```js
{
  id: 'staff_1',
  name: 'A. Kowalski',    // generated from first/last pools
  role: 'operator' | 'technician' | 'scientist' | 'engineer', // hiring category
  traits: ['careful', 'nightOwl'], // 1-2 traits, see below
  skills: { operating: 3, technical: 5, research: 2, construction: 4 }, // 0-10
  needs: {
    fatigue: 0.0,   // 0 rested → 1 exhausted; +0.02/tick working, -0.05/tick resting
    hunger: 0.0,    // 0 fed → 1 starving; +0.01/tick, resets on cafeteria break
    morale: 0.5,    // 0 miserable → 1 ecstatic; affected by room quality, recent events
  },
  assignment: {
    zoneId: 'controlRoom' | 'vacuumLab' | null, // facility zone they work in
    beamlineId: 'bl-1' | null,                  // optional beamline they crew
  },
  shift: 'day' | 'night' | 'flex', // affects fatigue curve
  status: 'working' | 'onBreak' | 'resting' | 'idle',
  mood: 'content' | 'tired' | 'stressed' | 'inspired', // derived from needs
  history: [{ tick, event: 'hired' | 'breakthrough' | 'breakdown', note }],
}
```

**Traits** (pick 1-2 at hire, small modifiers, RimWorld-like but facility-flavored):

| Trait | Effect |
|---|---|
| careful | −20% breakdown chance, −10% work speed |
| fastLearner | +25% skill gain |
| nightOwl | −30% fatigue at night, +30% by day |
| gourmand | morale +0.1 after cafeteria, hunger +20% faster |
| stoic | morale decays 50% slower |
| perfectionist | +15% beam quality when operating, stress +10% faster |

Skills are 0-10, start `2 + rand(0..4)` per role-primary skill, `1 + rand(0..3)` others. Work uses primary: operating→beam stability, technical→repair, research→data/lab speed, construction→build speed (future).

### 2. Hiring & Progression

**Hiring pool**: 3 candidates offered at a time, reroll daily (or pay to reroll). Each candidate shows name, role, traits, skills, hire cost (`staffCosts[role]*12` upfront + `staffCosts[role]`/tick salary). `Game.hireStaff(role)` becomes `Game.hireStaffMember(candidateId)` — keep old `hireStaff(role)` as wrapper that generates a random candidate for backward compat.

**Skill growth**: `+0.01` per tick working in assigned zone, capped at 10. `fastLearner` 1.25×. Breakthrough event at skill 5/8/10 logs and gives morale boost.

**Morale events**: `+0.2` on objective complete, `−0.1` on beam trip, `−0.05` on low food, `+0.1` on high-quality cafeteria break. Morale <0.2 → `stressed` → work speed −25%; <0.1 → risk of `breakdown` (1% per tick) → idle 30 ticks.

### 3. Needs Loop & Shifts

Each `Game.tick` (1 Hz):

```
for staff in staffMembers:
  if status==working:
    fatigue += 0.02 * shiftMult
    hunger  += 0.01
    if fatigue>0.8 or hunger>0.8: status → onBreak
  else if onBreak/resting:
    fatigue = max(0, fatigue - 0.05)
    hunger  = max(0, hunger - 0.08) if in cafeteria else hunger+0.01
    morale += 0.02 if morale<0.5 else 0
    if fatigue<0.2 and hunger<0.3: status→working
  morale decay: morale -= 0.002 + facilityPenalty (e.g., no cafeteria → +0.005)
  mood = derive(fatigue, hunger, morale)
```

**Facility linkage**: `Game.state.zoneConnectivity` already tracks tier per zone (thresholds 4/8/16 tiles). Staff assigned to a zone get tier multiplier: `workEfficiency = (skill/5) * (0.5 + 0.5*tier/4) * moodMult`. No assigned zone or tier 0 → 50% efficiency. `cafeteria` tier specifically reduces hunger/morale decay.

**Beamline linkage**: `operators` assigned to `controlRoom` + `beamlineId` are required for that beamline to run. If assigned operator count <1 or all fatigued → `infraCanRun` already false? Instead add `staffingBlockers`: if beamline has no active operator, synthesize hard error `beam_unstaffed` so existing `infraCanRun` banner shows it. Similarly `technicians` assigned to `maintenance` affect `_autoRepair` rate (already `technicians*2`), scientists to `opticsLab/diagnosticsLab` affect `tickResearch` speed via `getResearchSpeedMultiplier`.

### 4. UI

- **Staff bar** (top bar, next to funding): horizontal portraits (chibi, 24px) showing mood color border (green/yellow/red), fatigue bar, click → staff inspector.
- **Staff inspector** (`ContextWindow`): name, role, traits, skills with bars, needs with pct bars + mood, assignment dropdown (zone + beamline), shift toggle, Fire button.
- **Hiring dialog**: 3 cards, each with portrait, traits, skills, cost, Hire button.
- **Keep existing `hireStaff(type)` API** for tests; new `hireStaffMember(candidate)` for UI.

### 5. Persistence & Saves

`state.staffMembers = [...]`, `state.staffCandidates = [...]`, `state.nextStaffId`. Old `state.staff` counts derived as `reduce` for save compat but not used for logic. On load, if `staffMembers` missing, migrate from counts by generating N members with random names/traits.

### 6. Tick Cost & Scale

O(n) per tick, n ≤ 30, cheap. No pathfinding. Portraits are canvas 2D, not 3D entities.

### 7. Acceptance

- Hire flow works headless: `game.hireStaff('operators')` creates a member, `game.state.staffMembers.length` increments.
- Needs loop: after 50 working ticks, `fatigue>0.8`; after 20 resting ticks, `fatigue<0.3`.
- Assignment: operator assigned to `controlRoom` tier 2 gives `judgeStaffing(beamline)` true → `infraCanRun true`; unassigned → hard error `beam_unstaffed` and `beamOn false`.
- Build passes, existing tests `test-utility-solve-*` still pass.

## Future (not in this slice)

- Relationships, social needs, random events (sick leave, quitting)
- 3D chibi walkers using `entity-renderer.js`
- Construction skill affecting `placePlaceable` speed/cost
- Exhaustion causing mistakes (beam loss) rather than just trip
