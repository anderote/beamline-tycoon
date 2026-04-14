# Tutorial Checklist — Getting Started Guide

## Overview

A persistent, non-blocking checklist overlay that guides new players through building their first beamline. Visible on every new game by default, dismissable at any time. The player retains full freedom — steps are not gated or forced in order. The checklist simply tracks progress and shows hints for the next logical step.

## Goal

Guide the player through building a ~5 MeV electron linac with full infrastructure and data acquisition. The 13 steps exercise all core game systems: placement, networks (power, vacuum, RF, cooling, data), beam physics, and the objectives/economy loop.

## Tutorial Steps

Organized into 3 groups, 13 steps total. Each step has an id, display name, hint text, and a condition function evaluated against game state.

### Group 1: Beamline

| # | ID | Name | Hint | Condition |
|---|-----|------|------|-----------|
| 1 | `tut-source` | Place an Ion Source | Select Beamline > Sources and place a Source in the tunnel. | Any placeable with `kind === 'source'` exists |
| 2 | `tut-drift` | Extend the Beam Pipe | Add Beam Pipe sections to extend your beamline. | Sufficient `drift` placeables exist (total length check) |
| 3 | `tut-buncher` | Add a Buncher | Place a Buncher after the source to compress the beam into bunches. | Any placeable with `kind === 'buncher'` exists |
| 4 | `tut-cavities` | Install RF Cavities | Place Pillbox Cavities to accelerate the beam. You need ~10 to reach 5 MeV. | Enough `pillboxCavity` placeables to sum to ~5 MeV (count >= ~10) |
| 5 | `tut-quads` | Focus with Quadrupoles | Place at least 2 Quadrupole magnets to keep the beam focused. | At least 2 `quadrupole` placeables exist |
| 6 | `tut-faraday` | Place a Faraday Cup | End your beamline with a Faraday Cup to measure the beam. | Any placeable with `kind === 'faradayCup'` exists |

### Group 2: Infrastructure

| # | ID | Name | Hint | Condition |
|---|-----|------|------|-----------|
| 7 | `tut-power` | Connect Power | Place an HV Transformer, Switchgear, and Power Panels. Run Power Cable to your beamline components. | Power network connects a power source to at least one beamline component |
| 8 | `tut-vacuum` | Connect Vacuum | Place a Roughing Pump and Turbo Pumps. Run Vacuum Pipe to the beamline. | Vacuum network connects a pump to the beamline |
| 9 | `tut-rf` | Connect RF Power | Place a Magnetron or Solid-State Amplifier. Run RF Waveguide to your cavities. | RF waveguide network connects an RF source to a cavity |
| 10 | `tut-cooling` | Connect Cooling Water | Place a Chiller and run Cooling Water lines to your Quadrupoles. | Cooling water network connects a chiller to a quad |
| 11 | `tut-data` | Connect Data Fiber | Run Data Fiber from the Faraday Cup through a Patch Panel to a Rack/IOC. | Data fiber network connects the faraday cup to a rack/IOC |

### Group 3: Commission

| # | ID | Name | Hint | Condition |
|---|-----|------|------|-----------|
| 12 | `tut-beam` | First Measurement | Your beam should now be running. The Faraday Cup will collect data automatically. | `state.resources.data > 0` |
| 13 | `tut-control` | Build a Control Room | Create a Control Room zone and place an operator console inside it. | A `controlRoom` zone exists with a rack/IOC placed within it |

## Data Model

### New file: `src/data/tutorial.js`

Exports `TUTORIAL_STEPS` — an array of step objects:

```
{ id, name, hint, group, condition: (state, networks) => boolean }
```

And `TUTORIAL_GROUPS`:

```
[
  { id: 'beamline', name: 'Beamline', steps: ['tut-source', ...] },
  { id: 'infrastructure', name: 'Infrastructure', steps: ['tut-power', ...] },
  { id: 'commission', name: 'Commission', steps: ['tut-beam', ...] },
]
```

### Game state additions (`Game.js`)

Add to initial state:
- `tutorialDismissed: false` — whether the player has hidden the panel

Tutorial completion is derived each tick by evaluating step conditions against current state — no need to persist completed step IDs separately (they're recomputed from game state).

## UI Overlay

### Placement
- Top-left corner, below the HUD status bar
- Fixed position, not a draggable ContextWindow
- Pure DOM, appended to the HUD container

### Layout
- **Header:** "Getting Started" title + minimize/dismiss (x) button
- **Progress bar:** X/13 steps complete, fills left-to-right
- **Step groups:** Three collapsible sections (Beamline, Infrastructure, Commission)
- **Each step:** Checkbox + name. Completed = checkmark + greyed. First uncompleted step in each group shows hint text below it.
- **Minimized state:** Just the progress bar ("3/13 Getting Started"), click to expand

### Behavior
- Renders on every game tick (or state change) by re-evaluating conditions
- When a step completes: checkbox animates to checked state
- Dismiss (x) sets `state.tutorialDismissed = true`, hides panel
- No way to re-show once dismissed (keeps it simple; player can start a new game)
- Panel auto-hides when all 13 steps complete (with a brief "congratulations" flash)

### Styling
- Semi-transparent dark background to not obscure the game
- Compact — roughly 250px wide, variable height based on expansion
- Consistent with existing HUD aesthetic (monospace-ish, minimal chrome)

## Files Changed

| File | Change |
|------|--------|
| `src/data/tutorial.js` | **New.** Tutorial step definitions and groups. |
| `src/game/Game.js` | Add `tutorialDismissed` to initial state. Evaluate tutorial conditions each tick (or expose method for HUD to call). |
| `src/renderer/hud.js` | Render the tutorial checklist overlay. Evaluate step conditions, manage expand/collapse/dismiss state. |
| `style.css` | Styles for tutorial panel (container, progress bar, groups, checkboxes, hints, animations). |
| `src/main.js` | Wire tutorial rendering into the game loop if needed (may be handled entirely by hud.js). |

## What This Does NOT Do

- No gating of player actions — all tools/components remain available
- No rewards for tutorial steps (they're guidance, not objectives)
- No modification to placement, network, or economy systems
- No new 3D/sprite assets needed
- No changes to existing objectives
- No save/load changes beyond the `tutorialDismissed` flag
