// === BEAMLINE DIRECTED GRAPH ===
// Core data model: directed graph of placed components with grid positions.
// Nodes are components with tiles; edges connect parent -> child.

class Beamline {
  constructor() {
    this.nodes = [];       // { id, type, col, row, dir, entryDir, parentId, bendDir, tiles: [{col,row}] }
    this.occupied = {};    // "col,row" -> nodeId
    this.nextId = 1;
  }

  // --- Internal helpers ---

  _calcTiles(col, row, dir, trackLength) {
    const tiles = [];
    const delta = DIR_DELTA[dir];
    for (let i = 0; i < trackLength; i++) {
      tiles.push({ col: col + delta.dc * i, row: row + delta.dr * i });
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

  placeSource(col, row, dir) {
    const comp = COMPONENTS.source;
    const tiles = this._calcTiles(col, row, dir, comp.trackLength);
    if (!this._tilesAvailable(tiles)) return null;

    const node = {
      id: this.nextId++,
      type: 'source',
      col: col,
      row: row,
      dir: dir,
      entryDir: null,
      parentId: null,
      bendDir: null,
      tiles: tiles,
    };
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

    const tiles = this._calcTiles(col, row, exitDir, comp.trackLength);
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
    return this.occupied[col + ',' + row] !== undefined;
  }

  getNodeAt(col, row) {
    const nodeId = this.occupied[col + ',' + row];
    if (nodeId === undefined) return null;
    return this.nodes.find(n => n.id === nodeId) || null;
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

// Export for both browser (global) and Node.js (require)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Beamline;
}
