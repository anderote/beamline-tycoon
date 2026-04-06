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

  // ── Network Validation ──────────────────────────────────────────────

  /**
   * Validate power network: substations provide capacity, everything else draws.
   * Returns { capacity, draw, ok, substations: [...], consumers: [...] }
   */
  validatePowerNetwork: function(network) {
    var SUBSTATION_KW = 1500;
    var substations = [];
    var consumers = [];
    var capacity = 0;
    var draw = 0;

    // Facility equipment
    for (var i = 0; i < network.equipment.length; i++) {
      var eq = network.equipment[i];
      if (eq.type === 'substation') {
        capacity += SUBSTATION_KW;
        substations.push({ id: eq.id, type: eq.type, capacity: SUBSTATION_KW });
      } else {
        var comp = COMPONENTS[eq.type];
        var eCost = (comp && comp.energyCost) ? comp.energyCost : 0;
        if (eCost > 0) {
          draw += eCost;
          consumers.push({ id: eq.id, type: eq.type, draw: eCost, source: 'facility' });
        }
      }
    }

    // Beamline nodes
    for (var j = 0; j < network.beamlineNodes.length; j++) {
      var node = network.beamlineNodes[j];
      var bComp = COMPONENTS[node.type];
      var bCost = (bComp && bComp.energyCost) ? bComp.energyCost : 0;
      if (bCost > 0) {
        draw += bCost;
        consumers.push({ id: node.id, type: node.type, draw: bCost, source: 'beamline' });
      }
    }

    return {
      capacity: capacity,
      draw: draw,
      ok: capacity >= draw && capacity > 0,
      substations: substations,
      consumers: consumers,
    };
  },

  /**
   * Validate cooling network: cooling plants provide capacity, components with coolingWater generate heat.
   * Returns { capacity, heatLoad, margin, ok, plants: [...], consumers: [...] }
   */
  validateCoolingNetwork: function(network) {
    var COOLING_CAPACITY = { lcwSkid: 100, chiller: 200, coolingTower: 500 };
    var plants = [];
    var consumers = [];
    var capacity = 0;
    var heatLoad = 0;

    // Facility equipment: check for cooling plants and heat generators
    for (var i = 0; i < network.equipment.length; i++) {
      var eq = network.equipment[i];
      if (COOLING_CAPACITY[eq.type] !== undefined) {
        var cap = COOLING_CAPACITY[eq.type];
        capacity += cap;
        plants.push({ id: eq.id, type: eq.type, capacity: cap });
      } else {
        var comp = COMPONENTS[eq.type];
        if (comp && Array.isArray(comp.requiredConnections) &&
            comp.requiredConnections.indexOf('coolingWater') !== -1 && comp.energyCost) {
          var heat = comp.energyCost * 0.6;
          heatLoad += heat;
          consumers.push({ id: eq.id, type: eq.type, heatLoad: heat, source: 'facility' });
        }
      }
    }

    // Beamline nodes
    for (var j = 0; j < network.beamlineNodes.length; j++) {
      var node = network.beamlineNodes[j];
      var bComp = COMPONENTS[node.type];
      if (bComp && Array.isArray(bComp.requiredConnections) &&
          bComp.requiredConnections.indexOf('coolingWater') !== -1 && bComp.energyCost) {
        var bHeat = bComp.energyCost * 0.6;
        heatLoad += bHeat;
        consumers.push({ id: node.id, type: node.type, heatLoad: bHeat, source: 'beamline' });
      }
    }

    var margin = capacity > 0 ? (capacity - heatLoad) / capacity * 100 : 0;

    return {
      capacity: capacity,
      heatLoad: heatLoad,
      margin: margin,
      ok: capacity >= heatLoad && capacity > 0,
      plants: plants,
      consumers: consumers,
    };
  },

  /**
   * Validate cryo network: compressor + cold boxes provide capacity, SRF components generate heat.
   * Returns { capacity, heatLoad, opTemp, hasCompressor, margin, ok, consumers: [...] }
   */
  validateCryoNetwork: function(network) {
    var SRF_TYPES = ['cryomodule', 'tesla9Cell', 'srf650Cavity', 'srfGun', 'scQuad', 'scDipole'];
    var SRF_HEAT_W = 18;
    var HOUSING_HEAT_W = 3;
    var COLD_BOX_CAPACITY = { coldBox4K: 500, coldBox2K: 200 };
    var COLD_BOX_TEMP = { coldBox4K: 4.5, coldBox2K: 2.0 };
    var CRYOCOOLER_CAPACITY = 50;
    var CRYOCOOLER_TEMP = 40;

    var hasCompressor = false;
    var capacity = 0;
    var heatLoad = 0;
    var opTemp = 0;
    var consumers = [];

    // Check for compressor
    for (var i = 0; i < network.equipment.length; i++) {
      if (network.equipment[i].type === 'heCompressor') {
        hasCompressor = true;
        break;
      }
    }

    // Facility equipment: cold boxes, cryocoolers, cryomodule housings
    for (var e = 0; e < network.equipment.length; e++) {
      var eq = network.equipment[e];
      if (COLD_BOX_CAPACITY[eq.type] !== undefined) {
        if (hasCompressor) {
          capacity += COLD_BOX_CAPACITY[eq.type];
        }
        var boxTemp = COLD_BOX_TEMP[eq.type];
        if (opTemp === 0 || boxTemp < opTemp) {
          opTemp = boxTemp;
        }
      } else if (eq.type === 'cryocooler') {
        capacity += CRYOCOOLER_CAPACITY;
        if (opTemp === 0 || CRYOCOOLER_TEMP < opTemp) {
          opTemp = CRYOCOOLER_TEMP;
        }
      } else if (eq.type === 'cryomoduleHousing') {
        heatLoad += HOUSING_HEAT_W;
        consumers.push({ id: eq.id, type: eq.type, heatLoad: HOUSING_HEAT_W, source: 'facility' });
      }
    }

    // Beamline nodes: SRF types
    for (var j = 0; j < network.beamlineNodes.length; j++) {
      var node = network.beamlineNodes[j];
      if (SRF_TYPES.indexOf(node.type) !== -1) {
        heatLoad += SRF_HEAT_W;
        consumers.push({ id: node.id, type: node.type, heatLoad: SRF_HEAT_W, source: 'beamline' });
      }
    }

    var margin = capacity > 0 ? (capacity - heatLoad) / capacity * 100 : 0;

    return {
      capacity: capacity,
      heatLoad: heatLoad,
      opTemp: opTemp,
      hasCompressor: hasCompressor,
      margin: margin,
      ok: capacity >= heatLoad && (heatLoad === 0 || capacity > 0),
      consumers: consumers,
    };
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Networks;
}
