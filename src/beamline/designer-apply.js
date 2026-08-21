// src/beamline/designer-apply.js
//
// Public transaction coordinator for a Beamline Designer plan. The planner is
// deliberately pure; this module is the one mutation seam that resolves its
// symbolic ids, prepares the site, dispatches BeamlineSystem operations, and
// restores the complete pre-apply world if any step refuses.

import { physicalWallKey } from '../game/placement.js';

function resolve(value, symbols, missing) {
  if (typeof value === 'string') {
    if (value[0] !== '$') return value;
    if (symbols.has(value)) return symbols.get(value);
    missing.push(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(v => resolve(v, symbols, missing));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = resolve(item, symbols, missing);
    }
    return out;
  }
  return value;
}

function sameWallSite(entry, site) {
  if (!entry || !site) return false;
  return physicalWallKey({ ...entry, off: 0 }) === physicalWallKey({ ...site, off: 0 });
}

function tuneParams(game, op) {
  if (op.target === 'module') {
    const placeable = game.getPlaceable(op.junctionId);
    if (!placeable) return false;
    placeable.params = { ...(placeable.params || {}), ...(op.params || {}) };
    return true;
  }
  const pipe = (game.state.beamPipes || []).find(item => item.id === op.pipeId);
  const placement = pipe?.placements?.find(item => item.id === op.placementId);
  if (!placement) return false;
  placement.params = { ...(placement.params || {}), ...(op.params || {}) };
  return true;
}

function runOp(game, beam, op) {
  switch (op.kind) {
    case 'bulldozePlaceable':
    case 'clearDecoration': {
      if (!game.getPlaceable(op.placeableId)) return null;
      if (op.removalCost > 0) {
        if (!game.canAfford({ funding: op.removalCost })) return null;
        game.chargeConstruction({ funding: op.removalCost });
      }
      return game.removePlaceable(op.placeableId, { skipRefund: op.destructive === true })
        ? {} : null;
    }

    case 'bulldozeWall': {
      const site = { col: op.col, row: op.row, edge: op.edge };
      const hasHost = () => (game.state.walls || []).some(w => sameWallSite(w, site));
      const hasLayer = () => (game.state.wallOverlays || []).some(w => sameWallSite(w, site));
      if (!hasHost()) return null;
      // removeWall peels an overlay before it removes the host. Keep calling
      // the public demolition seam until the physical obstruction is gone.
      let guard = 0;
      while ((hasLayer() || hasHost()) && guard++ < 4) {
        if (!game.removeWall(site.col, site.row, site.edge)) return null;
      }
      return !hasLayer() && !hasHost() ? {} : null;
    }

    case 'placeConcrete':
      return game.placeInfraTile(op.col, op.row, 'concrete', 0) ? {} : null;

    case 'removeFromPipe':
      return beam.removeFromPipe(op.pipeId, op.placementId) ? {} : null;

    case 'removeJunction':
      beam.removeJunction(op.junctionId);
      return game.getPlaceable(op.junctionId) ? null : {};

    case 'mergePipes': {
      const id = beam.mergePipes(op.pipeIdA, op.pipeIdB);
      return id ? { pipe: id } : null;
    }

    case 'splitPipe': {
      const result = beam.splitPipe(op.pipeId, op.atPosition, op.gapSubL);
      return result ? { head: result.headPipeId, tail: result.tailPipeId } : null;
    }

    case 'trimPipe':
      return beam.trimPipe(op.pipeId, op.newSubL) ? {} : null;

    case 'drawPipe': {
      const id = beam.drawPipe(op.start, op.end, op.path);
      return id ? { pipe: id } : null;
    }

    case 'extendPipe':
      return beam.extendPipe(op.pipeId, op.additionalPath) ? {} : null;

    case 'placeJunction': {
      const id = beam.placeJunction({
        type: op.type,
        col: op.col, row: op.row,
        subCol: op.subCol, subRow: op.subRow,
        dir: op.dir,
        params: op.params || {},
      });
      if (!id) return null;
      for (const connection of op.connect || []) {
        if (!beam.attachPipeEnd(
          connection.pipe, connection.end, id, connection.port,
        )) return null;
      }
      return { junction: id };
    }

    case 'placeOnPipe': {
      const id = beam.placeOnPipe(op.pipeId, {
        type: op.type,
        position: op.position,
        subL: op.subL,
        params: op.params || {},
        mode: op.mode,
      });
      return id ? { placement: id } : null;
    }

    case 'moveJunction':
      if (!beam.moveJunction(op.placeableId, {
        col: op.col, row: op.row,
        subCol: op.subCol, subRow: op.subRow,
        dir: op.dir,
      })) return null;
      return {
        danglingLineCount: game.reanchorUtilityLinesForPlaceable(op.placeableId),
      };

    case 'tuneParams':
      return tuneParams(game, op) ? {} : null;

    default:
      return null;
  }
}

/**
 * Execute `ops` atomically.
 *
 * @returns {{ok:boolean, failure:Object|null, danglingLineCount:number}}
 */
export function executeDesignerApply(game, ops) {
  const beam = game?.beamline;
  if (!game || !beam) {
    return {
      ok: false,
      failure: { index: 0, kind: '-', reason: 'no beamline system' },
      danglingLineCount: 0,
    };
  }

  const snapshot = game.snapshotBeamlineState({ includeSitePreparation: true });
  const symbols = new Map();
  let danglingLineCount = 0;
  let failure = null;

  game._batchEvents(() => {
    for (let index = 0; index < (ops || []).length; index++) {
      const raw = ops[index];
      const missing = [];
      const { out, ...args } = raw;
      const op = resolve(args, symbols, missing);
      if (missing.length) {
        failure = { index, kind: raw.kind, reason: `unbound ${missing.join(', ')}` };
        break;
      }

      let produced;
      try {
        produced = runOp(game, beam, op);
      } catch (error) {
        console.error('[designer] op threw', raw, error);
        failure = {
          index, kind: raw.kind, reason: `threw ${error && error.message}`,
        };
        break;
      }
      if (!produced) {
        failure = { index, kind: raw.kind, reason: 'refused' };
        break;
      }
      danglingLineCount += produced.danglingLineCount || 0;
      for (const [key, symbol] of Object.entries(out || {})) {
        if (!produced[key]) {
          failure = { index, kind: raw.kind, reason: `no ${key} id returned` };
          break;
        }
        symbols.set(symbol, produced[key]);
      }
      if (failure) break;
    }
  });

  if (failure) {
    game.restoreBeamlineState(snapshot);
    return { ok: false, failure, danglingLineCount: 0 };
  }
  return { ok: true, failure: null, danglingLineCount };
}

export default executeDesignerApply;
