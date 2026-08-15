// Distribution-panel assisted wiring.
//
// A panel's `autoConnectRadius` is deliberately not a utility serviceRadius:
// service radii create implicit bus membership, while this action plans and
// purchases ordinary point-to-point powerCable lines. Each load consumes one
// real outlet, every path passes through validateDrawLine, and the result is
// one undoable gesture.

import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import {
  availablePorts,
  getPortSpec,
  placeableCenterWorld,
  portApproachVec,
  portWorldPosition,
} from '../utility/ports.js';
import { buildPortRoutedPaths, pathLengthSubUnits } from '../utility/line-geometry.js';
import { validateDrawLine } from '../utility/line-drawing.js';
import { findUtilityEndpoint, listUtilityEndpoints } from '../utility/utility-endpoints.js';
import { runWiringCost } from './utility-run-wiring.js';

export const PANEL_AUTO_CONNECT_UTILITY = 'powerCable';

const EPS = 1e-6;

function snapQ(value) { return Math.round(value * 4) / 4; }

function portTile(pos) {
  return pos && { col: snapQ(pos.x / 2), row: snapQ(pos.z / 2) };
}

function iterLines(lines) {
  if (!lines) return [];
  return typeof lines.values === 'function' ? Array.from(lines.values()) : lines;
}

export function panelAutoConnectRadius(def) {
  const radius = Number(def?.autoConnectRadius);
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
}

/**
 * Plan real power cables from one distribution panel to nearby free sinks.
 * Nearest connectors win when there are more loads than physical outlets.
 */
export function planPanelAutoConnect(state, panelId, {
  portPosition = portWorldPosition,
} = {}) {
  const empty = {
    panelId,
    radius: 0,
    candidates: 0,
    outlets: 0,
    stubs: [],
    skipped: 0,
    totalSubL: 0,
    cost: null,
  };
  if (!state || !panelId) return empty;

  const panel = findUtilityEndpoint(state, panelId);
  const panelDef = COMPONENTS[panel?.type];
  const radius = panelAutoConnectRadius(panelDef);
  if (!panel || !panelDef || radius <= 0) return empty;

  const resolvePortPosition = typeof portPosition === 'function'
    ? portPosition
    : portWorldPosition;
  const lines = state.utilityLines;
  const sourcePorts = availablePorts(
    panel, panelDef, PANEL_AUTO_CONNECT_UTILITY, lines,
  ).filter(name => getPortSpec(panelDef, name)?.role === 'source');
  const centre = placeableCenterWorld(panel, panelDef);
  if (!centre) return { ...empty, radius, outlets: sourcePorts.length };

  const outlets = sourcePorts.map(portName => {
    const pos = resolvePortPosition(panel, panelDef, portName);
    return pos && {
      portName,
      tile: portTile(pos),
      vec: portApproachVec(panel, panelDef, portName),
    };
  }).filter(Boolean);

  const candidates = [];
  for (const endpoint of listUtilityEndpoints(state)) {
    if (!endpoint || endpoint.id === panelId) continue;
    const def = COMPONENTS[endpoint.type];
    if (!def?.ports) continue;
    for (const portName of availablePorts(endpoint, def, PANEL_AUTO_CONNECT_UTILITY, lines)) {
      const spec = getPortSpec(def, portName);
      if (spec?.role !== 'sink') continue;
      const pos = resolvePortPosition(endpoint, def, portName);
      if (!pos) continue;
      const distance = Math.hypot(pos.x - centre.x, pos.z - centre.z) / 2;
      if (distance > radius + EPS) continue;
      candidates.push({
        placeableId: endpoint.id,
        portName,
        tile: portTile(pos),
        vec: portApproachVec(endpoint, def, portName),
        distance,
      });
    }
  }

  candidates.sort((a, b) => (a.distance - b.distance)
    || a.placeableId.localeCompare(b.placeableId)
    || a.portName.localeCompare(b.portName));

  // Validate against existing lines plus each line already promised by this
  // plan. That makes the button's count/cost agree with the eventual commit.
  const plannedLines = [...iterLines(lines)];
  const probeState = { ...state, utilityLines: plannedLines };
  const stubs = [];
  let skipped = 0;
  let outletIdx = 0;
  let totalSubL = 0;

  for (const sink of candidates) {
    if (outletIdx >= outlets.length) {
      skipped++;
      continue;
    }
    const outlet = outlets[outletIdx];
    const start = { placeableId: panelId, portName: outlet.portName };
    const end = { placeableId: sink.placeableId, portName: sink.portName };
    const directJumper = Math.abs(outlet.tile.col - sink.tile.col)
      + Math.abs(outlet.tile.row - sink.tile.row) <= 0.5;
    const routes = buildPortRoutedPaths(
      outlet.tile, directJumper ? null : outlet.vec,
      sink.tile, directJumper ? null : sink.vec,
      {
        allowZeroLength: true,
        portClearance: UTILITY_TYPES[PANEL_AUTO_CONNECT_UTILITY]?.portClearance !== false,
      },
    );
    const path = routes.find(candidate => validateDrawLine(probeState, {
      utilityType: PANEL_AUTO_CONNECT_UTILITY,
      start,
      end,
      path: candidate,
    }).ok);
    if (!path) {
      skipped++;
      continue;
    }

    const subL = pathLengthSubUnits(path);
    stubs.push({ start, end, path, subL });
    plannedLines.push({
      id: `__panel_auto_${stubs.length}`,
      utilityType: PANEL_AUTO_CONNECT_UTILITY,
      start,
      end,
      path,
    });
    totalSubL += subL;
    outletIdx++;
  }

  return {
    panelId,
    radius,
    candidates: candidates.length,
    outlets: outlets.length,
    stubs,
    skipped,
    totalSubL,
    cost: runWiringCost(PANEL_AUTO_CONNECT_UTILITY, totalSubL),
  };
}

/** Commit a previously calculated plan as a single paid/undoable gesture. */
export function commitPanelAutoConnect(game, plan) {
  if (!game || !plan || plan.stubs.length === 0) return [];
  const planCost = plan.cost;
  const committed = [];
  game.commitGesture({
    cost: planCost || undefined,
    mutate: () => {
      let committedSubL = 0;
      for (const stub of plan.stubs) {
        const id = game.utilityLineSystem.addLine({
          utilityType: PANEL_AUTO_CONNECT_UTILITY,
          start: stub.start,
          end: stub.end,
          path: stub.path,
        });
        if (id) {
          committed.push(id);
          committedSubL += stub.subL;
        }
      }

      // A world change between menu render and click can invalidate one line.
      // Charge only for lines that actually landed.
      if (planCost && committed.length > 0) {
        const actual = runWiringCost(PANEL_AUTO_CONNECT_UTILITY, committedSubL) || {};
        for (const [resource, amount] of Object.entries(planCost)) {
          const refund = amount - (actual[resource] || 0);
          if (refund > 0) game.state.resources[resource] += refund;
        }
      }
      return committed.length > 0 ? committed : null;
    },
    failed: result => !result,
  });

  if (committed.length > 0) {
    game.log(
      `Power Cable: auto-connected ${committed.length} nearby plug${committed.length === 1 ? '' : 's'}`,
      'good',
    );
  }
  return committed;
}

export default planPanelAutoConnect;
