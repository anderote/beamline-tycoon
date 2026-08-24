# Testing

Tests are split by feedback time. All commands run from the active feature or
integration worktree; none require the stable server on port 8000.

| Lane | Command | Use |
|---|---|---|
| Focused | `node test/test-name.js` | First check while changing one contract |
| Fast | `npm run test:fast` | Node unit/integration suites plus pytest, excluding economy scenarios |
| Simulation | `npm run test:simulation` | Scripted operating-economy scenarios |
| All non-browser | `npm test` or `npm run test:all` | Required integration gate before merge |
| Browser | `npm run test:browser` | Rendering, startup, and real interaction paths |
| Build | `npm run build` | Vite dependency/export resolution and production bundling |

Staff scale work also runs `npm run benchmark:staff`; see
[`docs/STAFF-SCALE-VALIDATION.md`](STAFF-SCALE-VALIDATION.md) for its contract
and the owner-authorized browser/profile checklist.

The simulation lane is required for changes to economy, staffing, utility
topology, scripted scenarios, or catalogue operating costs. The repository does
not model a prescribed full-career synthetic player. Browser tests are required
when correctness depends on DOM behavior, WebGPU/WebGL startup, pointer/keyboard
interaction, or visual integration. Repository agents run those browser checks
only after the owner explicitly authorizes browser operation for the current
task; otherwise they provide the owner with the remaining checklist.

## Test seams

- Test public commands and coordinators directly. Do not call underscored
  `Game`, `InputHandler`, renderer, or UI methods merely to avoid constructing a
  small fixture.
- Contract tests belong beside the boundary: registry mirrors, port capability
  resolution, dependency direction, snapshot shape, and published UI values.
- A balance test should fail on an invalid build before interpreting its income
  or progression result.
- `test/test-import-boundaries.js` scans local imports under `src/` and rejects
  dependency cycles. Move shared constants into dependency-neutral modules
  rather than introducing a reverse import to reuse one value.

## Isolated browser server

For an owner-authorized agent browser run, use an unused ephemeral port and
launch Vite directly with `--strictPort`, as documented in `AGENTS.md`. Track
and terminate the exact server process, close only the browser windows/tabs
opened for the run, then confirm the selected port has no listener. Never stop,
replace, or automate the stable game on port 8000.
