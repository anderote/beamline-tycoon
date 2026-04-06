// === BEAMLINE TYCOON: NETWORK DISCOVERY ===
// Discovers connected clusters of connection tiles and identifies
// which facility equipment and beamline components belong to each network.

const CONN_TYPES = ['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'dataFiber'];

const CARDINAL = [[0, -1], [0, 1], [-1, 0], [1, 0]];

const Networks = {

  /**
   * Discover all networks for every connection type.
   * Returns { powerCable: [network, ...], rfWaveguide: [...], ... }
   */
  discoverAll(state) {
    var result = {};
    for (var i = 0; i < CONN_TYPES.length; i++) {
      result[CONN_TYPES[i]] = Networks._discoverType(state, CONN_TYPES[i]);
    }
    return result;
  },

  /**
   * Flood-fill to find connected clusters for a single connection type.
   */
  _discoverType(state, connType) {
    // Collect all tiles that have this connection type
    var tilesOfType = new Set();
    state.connections.forEach(function(typeSet, key) {
      if (typeSet.has(connType)) {
        tilesOfType.add(key);
      }
    });

    var visited = new Set();
    var networks = [];

    tilesOfType.forEach(function(key) {
      if (visited.has(key)) return;

      // Flood-fill from this tile
      var cluster = [];
      var queue = [key];
      visited.add(key);

      while (queue.length > 0) {
        var cur = queue.shift();
        var parts = cur.split(',');
        var col = parseInt(parts[0], 10);
        var row = parseInt(parts[1], 10);
        cluster.push({ col: col, row: row });

        for (var d = 0; d < CARDINAL.length; d++) {
          var nKey = (col + CARDINAL[d][0]) + ',' + (row + CARDINAL[d][1]);
          if (!visited.has(nKey) && tilesOfType.has(nKey)) {
            visited.add(nKey);
            queue.push(nKey);
          }
        }
      }

      var tileSet = new Set(cluster.map(function(t) { return t.col + ',' + t.row; }));
      networks.push({
        tiles: cluster,
        equipment: Networks._findAdjacentEquipment(state, tileSet),
        beamlineNodes: Networks._findAdjacentBeamline(state, tileSet),
      });
    });

    return networks;
  },

  /**
   * Find facility equipment whose tiles are adjacent to or overlapping with network tiles.
   */
  _findAdjacentEquipment(state, tileSet) {
    var found = [];
    for (var i = 0; i < state.facilityEquipment.length; i++) {
      var eq = state.facilityEquipment[i];
      var eqTiles = eq.tiles || [{ col: eq.col, row: eq.row }];
      var adjacent = false;
      for (var t = 0; t < eqTiles.length && !adjacent; t++) {
        var tc = eqTiles[t].col;
        var tr = eqTiles[t].row;
        // Check overlap
        if (tileSet.has(tc + ',' + tr)) {
          adjacent = true;
          break;
        }
        // Check cardinal neighbors
        for (var d = 0; d < CARDINAL.length; d++) {
          if (tileSet.has((tc + CARDINAL[d][0]) + ',' + (tr + CARDINAL[d][1]))) {
            adjacent = true;
            break;
          }
        }
      }
      if (adjacent) {
        found.push({ id: eq.id, type: eq.type, col: eq.col, row: eq.row });
      }
    }
    return found;
  },

  /**
   * Find beamline nodes whose tiles are adjacent to or overlapping with network tiles.
   */
  _findAdjacentBeamline(state, tileSet) {
    var found = [];
    for (var i = 0; i < state.beamline.length; i++) {
      var node = state.beamline[i];
      var nodeTiles = node.tiles || [{ col: node.col, row: node.row }];
      var adjacent = false;
      for (var t = 0; t < nodeTiles.length && !adjacent; t++) {
        var tc = nodeTiles[t].col;
        var tr = nodeTiles[t].row;
        if (tileSet.has(tc + ',' + tr)) {
          adjacent = true;
          break;
        }
        for (var d = 0; d < CARDINAL.length; d++) {
          if (tileSet.has((tc + CARDINAL[d][0]) + ',' + (tr + CARDINAL[d][1]))) {
            adjacent = true;
            break;
          }
        }
      }
      if (adjacent) {
        found.push(node);
      }
    }
    return found;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Networks;
}
