# Beamline Tycoon

A tycoon/management simulation game where you design, build, and operate particle accelerator beamlines — with real physics under the hood.

Start with a simple electron linac and work your way up through photoinjectors, free electron lasers, and eventually a full particle collider. Manage funding, reputation, staff, and infrastructure while keeping your beam quality high and your facility running.

## Getting Started

### Prerequisites

- Node.js (for Vite dev server)
- Python 3 (for the asset dev server)

No npm dependencies beyond Vite — the game runs entirely in the browser using PIXI.js and Pyodide loaded from CDN.

### Running Locally

```bash
# Start the Vite dev server
npm run dev

# Open http://localhost:5173
```

For the tile asset dashboard (optional):

```bash
python3 server.py
# Opens on http://localhost:8001
```

### Building for Production

```bash
npm run build     # Output: dist/
npm run preview   # Preview the production build
```

## How to Play

### Core Loop

1. **Place components** on the isometric grid to build a beamline (sources, RF cavities, magnets, diagnostics, undulators, targets)
2. **Connect infrastructure** — power, vacuum, RF waveguides, cooling water, cryogenics, and data fiber
3. **Run beam simulations** — the Python physics engine computes real 6D beam dynamics
4. **Complete objectives** to earn funding, reputation, and research data
5. **Research upgrades** across 8 tech categories to unlock advanced components
6. **Scale up** from a basic linac to a full collider

### Machine Tiers

| Tier | Machine | Goal |
|------|---------|------|
| 1 | Linac | Deliver beam to a target |
| 2 | Photoinjector | Maximize beam brightness |
| 3 | Free Electron Laser | Achieve FEL saturation |
| 4 | e+e- Collider | Accumulate discoveries |

### Resources

- **Funding ($)** — spend on components and infrastructure
- **Reputation** — unlocks prestige components
- **Research Data** — earned from beams and objectives, spent on the tech tree
- **Power (kW)** — each component draws energy
- **Staff** — operators, technicians, scientists, engineers

### Controls

- **Click** on the grid to place components
- **Tab** to cycle through game modes (build, infrastructure, research)
- **Click beamline nodes** to open diagnostic probes with real-time plots

## Physics Engine

The game simulates real accelerator physics via a Python engine running in-browser through Pyodide (with NumPy and SciPy). The beam is represented as a 6D sigma matrix tracking position, angle, time, and energy spread.

**Physics modules:**

- **Linear optics** — Twiss parameter transport through FODO lattices
- **RF acceleration** — energy gain, phase slip, bunching
- **Synchrotron radiation** — energy loss in bending magnets
- **Space charge** — repulsive beam self-forces
- **Bunch compression** — chicane and harmonic linearizer dynamics
- **Collimation & aperture loss** — beam scraping and geometry limits
- **FEL gain** — free electron laser saturation modeling
- **Beam-beam effects** — interaction point dynamics for colliders

## Project Structure

```
beamline-tycoon/
├── index.html                 # Entry point
├── style.css                  # All game styles
├── vite.config.js             # Build config
├── server.py                  # Asset dev server
│
├── src/
│   ├── main.js                # Game initialization
│   ├── store.js               # Reactive state store
│   ├── game/                  # Core game logic (tick loop, economy, research, objectives)
│   ├── beamline/              # Beamline state, registry, physics bridge
│   ├── data/                  # Component library, research tree, machine definitions
│   ├── renderer/              # PIXI.js rendering (grid, sprites, HUD, overlays)
│   ├── input/                 # Keyboard/mouse handling
│   ├── networks/              # Infrastructure network discovery & validation
│   └── ui/                    # Context windows, diagnostic probes, plots
│
├── beam_physics/              # Python physics backend (runs via Pyodide)
│   ├── beam.py                # 6D BeamState (sigma matrix)
│   ├── lattice.py             # Beamline propagation
│   ├── gameplay.py            # Game-facing API
│   ├── elements.py            # Component definitions
│   ├── constants.py           # Physical constants
│   └── modules/               # Physics modules (optics, RF, radiation, FEL, etc.)
│
├── docs/
│   ├── physics-wiki/          # In-game physics documentation (14 articles)
│   └── infra-wiki/            # In-game infrastructure documentation
│
├── test/                      # JS + Python test suites
└── assets/                    # Sprites and tiles
```

## Tech Stack

- **JavaScript (ES Modules)** — all frontend code
- **[PIXI.js 8](https://pixijs.com/)** — 2D rendering (WebGL/Canvas)
- **[Pyodide](https://pyodide.org/)** — Python runtime in the browser (NumPy, SciPy)
- **[Vite](https://vite.dev/)** — dev server and bundler
- **Python 3** — physics simulation backend
- **HTML5 Canvas** — diagnostic probe plots

## Running Tests

```bash
# JavaScript
node test/test-beamline.js
node test/test-networks.js
node test/test-component-physics.js
node test/test-machines.js

# Python
python3 test/test_all_modules.py
```

## In-Game Documentation

The game includes two built-in wiki systems:

- **Physics Wiki** — covers beam fundamentals through tier 4 physics, with real-world machine references and equations
- **Infrastructure Wiki** — explains utility networks, connection types, and system requirements

## License

All rights reserved.
