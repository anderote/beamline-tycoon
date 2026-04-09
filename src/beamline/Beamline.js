// === BEAMLINE DIRECTED GRAPH ===
// Core data model: directed graph of placed components with grid positions.
// Nodes are components with tiles; edges connect parent -> child.

import { DIR_DELTA, turnLeft, turnRight } from '../data/directions.js';
import { COMPONENTS } from '../data/components.js';
import { PARAM_DEFS } from './component-physics.js';

export class Beamline {
  constructor() {
    this.nodes = [];       // { id, type, col, row, dir, entryDir, parentId, bendDir, tiles: [{col,row}] }
    this.occupied = {};    // "col,row" -> nodeId
    this.nextId = 1;
  }

  // --- Internal helpers ---

  _calcTiles(col, row, dir, subL, subW) {
    const tiles = [];
    const delta = DIR_DELTA[dir];
    const tilesAlong = Math.ceil(subL / 4);
    const tilesAcross = Math.ceil(subW / 4);

    const perpDir = turnLeft(dir);
    const perpDelta = DIR_DELTA[perpDir];

    const widthOffsets = [];
    for (let j = 0; j < tilesAcross; j++) {
      widthOffsets.push(j - (tilesAcross - 1) / 2);
    }

    for (let i = 0; i < tilesAlong; i++) {
      for (const wOff of widthOffsets) {
        tiles.push({
          col: col + delta.dc * i + perpDelta.dc * wOff,
          row: row + delta.dr * i + perpDelta.dr * wOff,
        });
      }
    }
    return tiles;
  }

  _tilesAvailable(tiles) {
    for (const t of tiles) {
      if (this.occupied[t.col + ',' + t.row] !== undefined) return false;
    }
    return true;
  }

  _occupyTiles(tiles, nodeId) {
    for (const t of tiles) {
      this.occupied[t.col + ',' + t.row] = nodeId;
    }
  }

  _freeTiles(tiles) {
    for (const t of tiles) {
      delete this.occupied[t.col + ',' + t.row];
    }
  }

  // --- Public API ---

  placeSource(col, row, dir, sourceType = 'source') {
    const comp = COMPONENTS[sourceType] || COMPONENTS.source;
    const tiles = this._calcTiles(col, row, dir, comp.subL || 4, comp.subW || 4);
    if (!this._tilesAvailable(tiles)) return null;

    const node = {
      id: this.nextId++,
      type: sourceType,
      col: col,
      row: row,
      dir: dir,
      entryDir: null,
      parentId: null,
      bendDir: null,
      tiles: tiles,
    };
    // Initialize tunable params from PARAM_DEFS defaults
    if (PARAM_DEFS[sourceType]) {
      node.params = {};
      for (const [k, def] of Object.entries(PARAM_DEFS[sourceType])) {
        if (!def.derived) node.params[k] = def.default;
      }
    }
    // Copy default params from component definition (for paramOptions etc.)
    if (comp.params) {
      if (!node.params) node.params = {};
      for (const [k, v] of Object.entries(comp.params)) {
        if (!(k in node.params)) node.params[k] = v;
      }
    }
    this.nodes.push(node);
    this._occupyTiles(tiles, node.id);
    return node.id;
  }

  placeAt(cursor, compType, bendDir) {
    const comp = COMPONENTS[compType];
    if (!comp) return null;

    const { col, row, dir, parentId } = cursor;

    // Calculate exit direction
    let exitDir = dir;
    if (comp.isDipole && bendDir) {
      exitDir = bendDir === 'left' ? turnLeft(dir) : turnRight(dir);
    }

    const tiles = this._calcTiles(col, row, exitDir, comp.subL || 4, comp.subW || 2);
    if (!this._tilesAvailable(tiles)) return null;

    const node = {
      id: this.nextId++,
      type: compType,
      col: col,
      row: row,
      dir: exitDir,
      entryDir: dir,
      parentId: parentId,
      bendDir: bendDir || null,
      tiles: tiles,
    };
    // Initialize tunable params from PARAM_DEFS defaults
    if (PARAM_DEFS[compType]) {
      node.params = {};
      for (const [k, def] of Object.entries(PARAM_DEFS[compType])) {
        if (!def.derived) node.params[k] = def.default;
      }
    }
    // Copy default params from component definition (for paramOptions etc.)
    if (comp.params) {
      if (!node.params) node.params = {};
      for (const [k, v] of Object.entries(comp.params)) {
        if (!(k in node.params)) node.params[k] = v;
      }
    }
    this.nodes.push(node);
    this._occupyTiles(tiles, node.id);
    return node.id;
  }

  getBuildCursors() {
    const childParentIds = new Set();
    for (const n of this.nodes) {
      if (n.parentId != null) childParentIds.add(n.parentId);
    }

    const cursors = [];
    for (const node of this.nodes) {
      const comp = COMPONENTS[node.type];
      if (comp.isEndpoint) continue;

      if (comp.isSplitter) {
        // Splitters need TWO cursors: straight + branched (turnLeft)
        // Check how many children already exist for this node
        const children = this.nodes.filter(n => n.parentId === node.id);
        const childDirs = new Set(children.map(c => c.entryDir));

        const lastTile = node.tiles[node.tiles.length - 1];

        // Straight cursor (same dir as node)
        const straightDelta = DIR_DELTA[node.dir];
        const straightCursor = {
          col: lastTile.col + straightDelta.dc,
          row: lastTile.row + straightDelta.dr,
          dir: node.dir,
          parentId: node.id,
        };

        // Branched cursor (turnLeft from node dir)
        const branchDir = turnLeft(node.dir);
        const branchDelta = DIR_DELTA[branchDir];
        const branchCursor = {
          col: lastTile.col + branchDelta.dc,
          row: lastTile.row + branchDelta.dr,
          dir: branchDir,
          parentId: node.id,
        };

        // Only add cursors for directions without children
        if (!childDirs.has(node.dir)) cursors.push(straightCursor);
        if (!childDirs.has(branchDir)) cursors.push(branchCursor);
      } else {
        // Regular component: one cursor if no child
        if (!childParentIds.has(node.id)) {
          const lastTile = node.tiles[node.tiles.length - 1];
          const delta = DIR_DELTA[node.dir];
          cursors.push({
            col: lastTile.col + delta.dc,
            row: lastTile.row + delta.dr,
            dir: node.dir,
            parentId: node.id,
          });
        }
      }
    }
    return cursors;
  }

  removeNode(nodeId) {
    // Only remove if leaf (no children reference it as parentId)
    const hasChildren = this.nodes.some(n => n.parentId === nodeId);
    if (hasChildren) return false;

    const idx = this.nodes.findIndex(n => n.id === nodeId);
    if (idx === -1) return false;

    const node = this.nodes[idx];
    this._freeTiles(node.tiles);
    this.nodes.splice(idx, 1);
    return true;
  }

  getOrderedComponents() {
    // BFS walk from sources
    const ordered = [];
    const visited = new Set();

    // Find sources
    const sources = this.nodes.filter(n => COMPONENTS[n.type]?.isSource);

    const queue = [...sources];
    for (const s of queue) visited.add(s.id);

    while (queue.length > 0) {
      const node = queue.shift();
      ordered.push(node);

      // Find children
      const children = this.nodes.filter(n => n.parentId === node.id);
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          queue.push(child);
        }
      }
    }
    return ordered;
  }

  getAllNodes() {
    return this.nodes;
  }

  isTileOccupied(col, row) {
    if (this.occupied[col + ',' + row] !== undefined) return true;
    // Check half-tile positions
    if (this.occupied[(col + 0.5) + ',' + row] !== undefined) return true;
    if (this.occupied[(col - 0.5) + ',' + row] !== undefined) return true;
    if (this.occupied[col + ',' + (row + 0.5)] !== undefined) return true;
    if (this.occupied[col + ',' + (row - 0.5)] !== undefined) return true;
    return false;
  }

  getNodeAt(col, row) {
    // Check exact position and nearby half-tile positions
    const candidates = [
      col + ',' + row,
      (col + 0.5) + ',' + row,
      (col - 0.5) + ',' + row,
      col + ',' + (row + 0.5),
      col + ',' + (row - 0.5),
      (col + 0.5) + ',' + (row + 0.5),
      (col - 0.5) + ',' + (row - 0.5),
      (col + 0.5) + ',' + (row - 0.5),
      (col - 0.5) + ',' + (row + 0.5),
    ];
    for (const key of candidates) {
      const nodeId = this.occupied[key];
      if (nodeId !== undefined) {
        return this.nodes.find(n => n.id === nodeId) || null;
      }
    }
    return null;
  }

  toJSON() {
    return {
      nodes: JSON.parse(JSON.stringify(this.nodes)),
      nextId: this.nextId,
    };
  }

  fromJSON(data) {
    this.nodes = data.nodes;
    this.nextId = data.nextId;
    this.occupied = {};
    for (const node of this.nodes) {
      this._occupyTiles(node.tiles, node.id);
    }
  }
}
