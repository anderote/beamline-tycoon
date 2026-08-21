// Transactional commands for committing a validated multi-selection preview.
// UI/input code owns gestures and messages; this module owns the state changes
// so InputHandler remains an event coordinator rather than a domain service.

import { placeableMutationEvent } from '../game/placeable-events.js';

export function copySelectionGroup(game, payload, preview) {
  const newIds = [];
  const placeholderToId = new Map();
  const lineCost = Object.keys(preview.lineCost || {}).length ? preview.lineCost : undefined;
  const result = game.commitGesture({
    cost: lineCost,
    mutate: () => {
      const rollback = game.snapshotBeamlineState();
      return game.batchEvents(() => {
        for (const target of preview.targets) {
          const id = game.placePlaceable({
            type: target.type,
            col: target.col,
            row: target.row,
            subCol: target.subCol,
            subRow: target.subRow,
            dir: target.dir,
            portsFlipped: target.portsFlipped === true,
            wallMount: target.wallMount,
            params: target.params,
            variant: target.variant,
            silent: true,
          });
          if (!id) {
            game.restoreBeamlineState(rollback);
            return false;
          }
          newIds.push(id);
          placeholderToId.set(target.placeholderId, id);
        }
        for (const connection of preview.connections) {
          const remap = endpoint => endpoint && ({
            ...endpoint,
            placeableId: placeholderToId.get(endpoint.placeableId),
          });
          const lineId = game.utilityLineSystem.addLine({
            utilityType: connection.utilityType,
            start: remap(connection.start),
            end: remap(connection.end),
            path: connection.path,
            cablePath: connection.cablePath,
            routeHeightMeters: connection.routeHeightMeters,
          });
          if (!lineId) {
            game.restoreBeamlineState(rollback);
            return false;
          }
        }
        return newIds;
      });
    },
    failed: value => !value,
  });
  return { ok: !!result, ids: result ? newIds : [] };
}

export function moveSelectionGroup(game, payload, preview) {
  const rollback = game.snapshotBeamlineState();
  let dangled = 0;
  const result = game.runUndoableMutation(() => game.batchEvents(() => {
    const selected = new Set(payload.items.map(item => item.id));

    for (const item of payload.items) {
      const entry = game.getPlaceable(item.id);
      if (!entry) {
        game.restoreBeamlineState(rollback);
        return false;
      }
      for (const cell of (entry.cells || [])) {
        const key = `${cell.col},${cell.row},${cell.subCol},${cell.subRow}`;
        if (selected.has(game.state.subgridOccupied[key]?.id)) {
          delete game.state.subgridOccupied[key];
        }
      }
    }

    for (const target of preview.targets) {
      if (!game.movePlaceable(target.id, {
        col: target.col,
        row: target.row,
        subCol: target.subCol,
        subRow: target.subRow,
        dir: target.dir,
      })) {
        game.restoreBeamlineState(rollback);
        return false;
      }
    }

    for (const connection of preview.connections) {
      const line = game.state.utilityLines.get(connection.sourceId);
      if (!line) {
        game.restoreBeamlineState(rollback);
        return false;
      }
      line.path = connection.path.map(point => ({ ...point }));
      if (Number.isFinite(connection.routeHeightMeters)) {
        line.routeHeightMeters = connection.routeHeightMeters;
      }
      if (Array.isArray(connection.cablePath)) {
        line.cablePath = connection.cablePath.map(point => ({ ...point }));
      }
      line.subL = connection.subL;
    }
    for (const item of payload.items) {
      dangled += game.reanchorUtilityLinesForPlaceable(item.id, {
        skipLineIds: preview.internalLineIds,
      });
    }

    game.syncPlaceableViews();
    game.computeSystemStats();
    const movedEntries = payload.items.map(item => game.getPlaceable(item.id)).filter(Boolean);
    const mutationEvent = placeableMutationEvent(
      movedEntries[0], 'moved', {
        terrainChanged: true,
        affectedEntries: movedEntries.slice(1),
      },
    );
    game.emit('placeableChanged', mutationEvent);
    game.emit('utilityLinesChanged', {});
    if (payload.items.some(item => item.kind === 'equipment')) {
      game.emit('facilityChanged', mutationEvent);
    }
    if (payload.items.some(item => item.kind === 'furnishing')) {
      game.emit('zonesChanged', mutationEvent);
    }
    return true;
  }));
  return { ok: !!result, dangled: result ? dangled : 0 };
}

export function demolishSelection(game, ids) {
  const existing = ids.filter(id => game.getPlaceable(id));
  if (!existing.length) return [];
  game.runUndoableMutation(() => game.batchEvents(() => {
    for (const id of existing) {
      const entry = game.getPlaceable(id);
      if (entry) game.demolishTarget({ kind: entry.kind || entry.category, id });
    }
  }));
  return existing;
}
