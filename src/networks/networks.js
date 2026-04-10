// === BEAMLINE TYCOON: NETWORK DISCOVERY ===
// Discovers connected clusters of connection tiles and identifies
// which facility equipment and beamline components belong to each network.

import { COMPONENTS } from '../data/components.js';
import { CONNECTION_TYPES } from '../data/modes.js';

export const CONN_TYPES = ['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'dataFiber'];

const CARDINAL = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export const Networks = {

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
    var equip = (state.placeables || []).filter(function(p) { return p.category === 'equipment'; });
    for (var i = 0; i < equip.length; i++) {
      var eq = equip[i];
      var tc = eq.col;
      var tr = eq.row;
      var adjacent = false;
      if (tileSet.has(tc + ',' + tr)) {
        adjacent = true;
      }
      if (!adjacent) {
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

  /**
   * Check if a network's tiles touch (overlap or are adjacent to) any control room zone tile.
   */
  touchesControlRoom(state, network) {
    var zoneOccupied = state.zoneOccupied || {};
    for (var i = 0; i < network.tiles.length; i++) {
      var col = network.tiles[i].col;
      var row = network.tiles[i].row;
      // Check the tile itself and cardinal neighbors
      if (zoneOccupied[col + ',' + row] === 'controlRoom') return true;
      for (var d = 0; d < CARDINAL.length; d++) {
        if (zoneOccupied[(col + CARDINAL[d][0]) + ',' + (row + CARDINAL[d][1])] === 'controlRoom') return true;
      }
    }
    return false;
  },

  // ── Network Validation ──────────────────────────────────────────────

  /**
   * Compute effective quality for a network given capacity, demand, and lab bonuses.
   * @param {number} capacity
   * @param {number} demand
   * @param {Array} labBonuses - Array of { bonus } from findLabNetworkBonuses
   * @returns {number} Quality 0.0 - 1.0
   */
  computeNetworkQuality: function(capacity, demand, labBonuses) {
    var ratio = demand > 0 ? Math.min(1.0, capacity / demand) : 1.0;
    var labBonus = 0;
    if (Array.isArray(labBonuses)) {
      for (var i = 0; i < labBonuses.length; i++) {
        labBonus += labBonuses[i].bonus || 0;
      }
    }
    labBonus = Math.min(labBonus, 0.5);
    return Math.min(1.0, ratio + labBonus);
  },

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

    var ratio = draw > 0 ? Math.min(1.0, capacity / draw) : (capacity > 0 ? 1.0 : 0);

    return {
      capacity: capacity,
      draw: draw,
      ok: capacity >= draw && capacity > 0,
      quality: ratio,
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
    var ratio = heatLoad > 0 ? Math.min(1.0, capacity / heatLoad) : (capacity > 0 ? 1.0 : 0);

    return {
      capacity: capacity,
      heatLoad: heatLoad,
      margin: margin,
      ok: capacity >= heatLoad && capacity > 0,
      quality: ratio,
      plants: plants,
      consumers: consumers,
    };
  },

  /**
   * Validate cryo network: compressor + cold boxes provide capacity, SRF components generate heat.
   * Returns { capacity, heatLoad, opTemp, hasCompressor, margin, ok, consumers: [...] }
   */
  /**
   * Validate RF network: sources provide power at specific frequencies, cavities demand power.
   * Returns { forwardPower, reflectedPower, totalDemand, frequencyMatch, missingModulator, hasCirculator, mismatches, ok, sources, cavities }
   */
  validateRfNetwork: function(network) {
    var SUPPORT_TYPES = ['modulator', 'circulator', 'rfCoupler', 'llrfController'];
    var PULSED_TYPES = ['pulsedKlystron', 'multibeamKlystron'];

    var hasModulator = false;
    var hasCirculator = false;
    var sources = [];
    var cavities = [];
    var mismatches = [];

    // Check for support equipment
    for (var i = 0; i < network.equipment.length; i++) {
      var eq = network.equipment[i];
      if (eq.type === 'modulator') hasModulator = true;
      if (eq.type === 'circulator') hasCirculator = true;
    }

    // Identify RF sources from equipment
    for (var s = 0; s < network.equipment.length; s++) {
      var seq = network.equipment[s];
      var sComp = COMPONENTS[seq.type];
      if (!sComp || sComp.rfFrequency === undefined) continue;
      if (SUPPORT_TYPES.indexOf(seq.type) !== -1) continue;

      var isPulsed = PULSED_TYPES.indexOf(seq.type) !== -1;
      var power = 0;
      if (sComp.params) {
        power = sComp.params.peakPower || sComp.params.cwPower || 0;
      }
      if (isPulsed && !hasModulator) {
        power = 0;
      }
      sources.push({ id: seq.id, type: seq.type, frequency: sComp.rfFrequency, power: power });
    }

    // Identify RF cavities from beamline nodes
    for (var c = 0; c < network.beamlineNodes.length; c++) {
      var node = network.beamlineNodes[c];
      var cComp = COMPONENTS[node.type];
      if (!cComp || cComp.rfFrequency === undefined) continue;
      var demand = cComp.energyCost || 0;
      cavities.push({ id: node.id, type: node.type, frequency: cComp.rfFrequency, demand: demand });
    }

    // Frequency matching: check each cavity has a matching source
    for (var m = 0; m < cavities.length; m++) {
      var cav = cavities[m];
      var matched = false;
      for (var ms = 0; ms < sources.length; ms++) {
        if (sources[ms].frequency === 'broadband' || sources[ms].frequency === cav.frequency) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        mismatches.push({ cavityId: cav.id, cavityType: cav.type, frequency: cav.frequency });
      }
    }

    // Power budget per frequency
    var freqGroups = {};
    for (var fg = 0; fg < cavities.length; fg++) {
      var freq = cavities[fg].frequency;
      if (!freqGroups[freq]) freqGroups[freq] = { demand: 0, supply: 0 };
      freqGroups[freq].demand += cavities[fg].demand;
    }
    for (var ps = 0; ps < sources.length; ps++) {
      var src = sources[ps];
      if (src.frequency === 'broadband') {
        // Broadband sources contribute to all frequency groups
        var groupKeys = Object.keys(freqGroups);
        for (var gk = 0; gk < groupKeys.length; gk++) {
          freqGroups[groupKeys[gk]].supply += src.power;
        }
      } else {
        if (freqGroups[src.frequency]) {
          freqGroups[src.frequency].supply += src.power;
        }
      }
    }

    var powerOk = true;
    var totalForwardPower = 0;
    var totalDemand = 0;
    var fKeys = Object.keys(freqGroups);
    for (var fk = 0; fk < fKeys.length; fk++) {
      var grp = freqGroups[fKeys[fk]];
      totalDemand += grp.demand;
      if (grp.supply < grp.demand) powerOk = false;
    }
    for (var tp = 0; tp < sources.length; tp++) {
      totalForwardPower += sources[tp].power;
    }

    var reflectedPower = totalForwardPower * 0.02;
    var missingModulator = false;
    for (var pm = 0; pm < sources.length; pm++) {
      if (PULSED_TYPES.indexOf(sources[pm].type) !== -1 && !hasModulator) {
        missingModulator = true;
        break;
      }
    }
    var frequencyMatch = mismatches.length === 0;
    var ok = frequencyMatch && powerOk && !missingModulator && (cavities.length === 0 || sources.length > 0);

    var ratio = totalDemand > 0 ? Math.min(1.0, totalForwardPower / totalDemand) : (sources.length > 0 ? 1.0 : 0);

    return {
      forwardPower: totalForwardPower,
      reflectedPower: reflectedPower,
      totalDemand: totalDemand,
      frequencyMatch: frequencyMatch,
      missingModulator: missingModulator,
      hasCirculator: hasCirculator,
      mismatches: mismatches,
      ok: ok,
      quality: ratio,
      sources: sources,
      cavities: cavities,
    };
  },

  // ── Vacuum Conductance Constants ───────────────────────────────────
  PIPE_CONDUCTANCE: 50,  // L/s per vacuum pipe tile
  PUMP_SPEEDS: {
    roughingPump: 10, turboPump: 300, ionPump: 100, negPump: 200, tiSubPump: 500,
  },
  OUTGASSING_RATE: 1e-9,  // mbar*L/s per liter of beamline volume

  /**
   * BFS from startKey through tiles in tileSet.
   * Returns shortest distance to any key in targetSet.
   * Distance = number of tiles traversed (start tile counts as 1).
   * If unreachable, returns Infinity.
   */
  _bfsDistance: function(startKey, targetSet, tileSet) {
    if (targetSet.has(startKey)) return 1;
    var visited = new Set();
    visited.add(startKey);
    var queue = [{ key: startKey, dist: 1 }];
    while (queue.length > 0) {
      var cur = queue.shift();
      var parts = cur.key.split(',');
      var col = parseInt(parts[0], 10);
      var row = parseInt(parts[1], 10);
      for (var d = 0; d < CARDINAL.length; d++) {
        var nKey = (col + CARDINAL[d][0]) + ',' + (row + CARDINAL[d][1]);
        if (visited.has(nKey)) continue;
        visited.add(nKey);
        if (!tileSet.has(nKey)) continue;
        var nDist = cur.dist + 1;
        if (targetSet.has(nKey)) return nDist;
        queue.push({ key: nKey, dist: nDist });
      }
    }
    return Infinity;
  },

  /**
   * Validate vacuum network: pumps provide effective speed through pipe conductance.
   * Returns { effectivePumpSpeed, avgPressure, pressureQuality, ok, pumps }
   */
  validateVacuumNetwork: function(network, allBeamline) {
    var PUMP_SPEEDS = Networks.PUMP_SPEEDS;
    var PIPE_CONDUCTANCE = Networks.PIPE_CONDUCTANCE;
    var OUTGASSING_RATE = Networks.OUTGASSING_RATE;

    // 1. Build tileSet for fast lookup
    var tileSet = new Set();
    for (var t = 0; t < network.tiles.length; t++) {
      tileSet.add(network.tiles[t].col + ',' + network.tiles[t].row);
    }

    // 2. Find pumps in network equipment
    var pumps = [];
    for (var i = 0; i < network.equipment.length; i++) {
      var eq = network.equipment[i];
      if (PUMP_SPEEDS[eq.type] !== undefined) {
        pumps.push(eq);
      }
    }

    // 3. No pumps case
    if (pumps.length === 0) {
      return {
        effectivePumpSpeed: 0,
        avgPressure: Infinity,
        pressureQuality: 'None',
        ok: false,
        pumps: [],
      };
    }

    // 4. Find beamline connection points: beamline node tiles cardinally adjacent to a vacuum pipe tile
    var beamlineConnSet = new Set();
    for (var b = 0; b < network.beamlineNodes.length; b++) {
      var node = network.beamlineNodes[b];
      var nodeTiles = node.tiles || [{ col: node.col, row: node.row }];
      for (var nt = 0; nt < nodeTiles.length; nt++) {
        var nc = nodeTiles[nt].col;
        var nr = nodeTiles[nt].row;
        for (var d = 0; d < CARDINAL.length; d++) {
          var adjKey = (nc + CARDINAL[d][0]) + ',' + (nr + CARDINAL[d][1]);
          if (tileSet.has(adjKey)) {
            beamlineConnSet.add(adjKey);
          }
        }
      }
    }

    // 5. For each pump, BFS through network to find shortest path to beamline connection
    var totalEffectiveSpeed = 0;
    var pumpResults = [];
    for (var p = 0; p < pumps.length; p++) {
      var pump = pumps[p];
      var sPump = PUMP_SPEEDS[pump.type];
      var pumpTiles = pump.tiles || [{ col: pump.col, row: pump.row }];

      // Find pump's adjacent tiles that are in the network
      var bestDist = Infinity;
      for (var pt = 0; pt < pumpTiles.length; pt++) {
        var pc = pumpTiles[pt].col;
        var pr = pumpTiles[pt].row;
        for (var pd = 0; pd < CARDINAL.length; pd++) {
          var pAdjKey = (pc + CARDINAL[pd][0]) + ',' + (pr + CARDINAL[pd][1]);
          if (tileSet.has(pAdjKey)) {
            var dist = Networks._bfsDistance(pAdjKey, beamlineConnSet, tileSet);
            if (dist < bestDist) bestDist = dist;
          }
        }
      }

      var pathLength = bestDist;
      var cPath = PIPE_CONDUCTANCE / Math.max(pathLength, 1);
      var sEff = 1 / (1 / sPump + 1 / cPath);
      totalEffectiveSpeed += sEff;
      pumpResults.push({ id: pump.id, type: pump.type, pumpSpeed: sPump, effectiveSpeed: sEff, pathLength: pathLength });
    }

    // 6. Compute pressure
    var totalVolume = 0;
    for (var bv = 0; bv < allBeamline.length; bv++) {
      var bNode = allBeamline[bv];
      var bComp = COMPONENTS[bNode.type];
      if (bComp && bComp.interiorVolume) {
        totalVolume += bComp.interiorVolume;
      }
    }
    var gasLoad = Math.max(totalVolume, 1) * OUTGASSING_RATE;
    var avgPressure = gasLoad / totalEffectiveSpeed;

    // 7. Pressure quality
    var pressureQuality;
    if (avgPressure < 1e-9) {
      pressureQuality = 'Excellent';
    } else if (avgPressure < 1e-7) {
      pressureQuality = 'Good';
    } else if (avgPressure < 1e-4) {
      pressureQuality = 'Marginal';
    } else {
      pressureQuality = 'Poor';
    }

    // 8. ok
    var ok = pressureQuality !== 'Poor' && pressureQuality !== 'None';

    var qualityMap = { 'Excellent': 1.0, 'Good': 0.85, 'Marginal': 0.6, 'Poor': 0.3, 'None': 0 };

    return {
      effectivePumpSpeed: totalEffectiveSpeed,
      avgPressure: avgPressure,
      pressureQuality: pressureQuality,
      ok: ok,
      quality: qualityMap[pressureQuality] || 0,
      pumps: pumpResults,
    };
  },

  /**
   * Full validation engine. Checks all infrastructure systems and produces a blockers list.
   * Input: state with { connections, facilityEquipment, facilityGrid, beamline }
   * Returns: { canRun: bool, blockers: [...], networks: allNetworks }
   */
  validate: function(state) {
    var blockers = [];

    // 1. Discover all networks
    var allNetworks = Networks.discoverAll(state);

    // 2. Per-component connection checks
    // Build lookup: for each connection type, which beamline node IDs are in some network of that type?
    var connectedNodes = {};
    for (var ci = 0; ci < CONN_TYPES.length; ci++) {
      var ct = CONN_TYPES[ci];
      connectedNodes[ct] = new Set();
      var nets = allNetworks[ct];
      for (var ni = 0; ni < nets.length; ni++) {
        for (var bi = 0; bi < nets[ni].beamlineNodes.length; bi++) {
          connectedNodes[ct].add(nets[ni].beamlineNodes[bi].id);
        }
      }
    }

    for (var bn = 0; bn < state.beamline.length; bn++) {
      var node = state.beamline[bn];
      var comp = COMPONENTS[node.type];
      if (!comp || !Array.isArray(comp.requiredConnections)) continue;
      for (var rc = 0; rc < comp.requiredConnections.length; rc++) {
        var req = comp.requiredConnections[rc];
        if (req === 'vacuumPipe') continue; // vacuum is global, not per-component
        if (!connectedNodes[req] || !connectedNodes[req].has(node.id)) {
          var displayName = (CONNECTION_TYPES[req] && CONNECTION_TYPES[req].name) || req;
          blockers.push({
            type: 'connection',
            severity: 'hard',
            nodeId: node.id,
            nodeType: node.type,
            missing: req,
            reason: (comp.name || node.type) + ' missing ' + displayName + ' connection',
          });
        }
      }
    }

    // 3. Per-network capacity checks
    // Power networks
    var powerNets = allNetworks.powerCable;
    for (var pi = 0; pi < powerNets.length; pi++) {
      var pStats = Networks.validatePowerNetwork(powerNets[pi]);
      if (!pStats.ok && pStats.draw > 0) {
        blockers.push({
          type: 'power',
          severity: 'soft',
          reason: 'Power network overloaded: ' + pStats.draw + ' kW draw, ' + pStats.capacity + ' kW capacity',
        });
      }
    }

    // Cooling networks
    var coolNets = allNetworks.coolingWater;
    for (var cli = 0; cli < coolNets.length; cli++) {
      var cStats = Networks.validateCoolingNetwork(coolNets[cli]);
      if (!cStats.ok && cStats.heatLoad > 0) {
        blockers.push({
          type: 'cooling',
          severity: 'soft',
          reason: 'Cooling network overloaded: ' + cStats.heatLoad + ' kW heat, ' + cStats.capacity + ' kW capacity',
        });
      }
    }

    // Cryo networks
    var cryoNets = allNetworks.cryoTransfer;
    for (var cri = 0; cri < cryoNets.length; cri++) {
      var crStats = Networks.validateCryoNetwork(cryoNets[cri]);
      if (!crStats.ok && crStats.heatLoad > 0) {
        if (!crStats.hasCompressor) {
          blockers.push({
            type: 'cryo',
            severity: 'soft',
            reason: 'Cryo network missing He compressor',
          });
        } else {
          blockers.push({
            type: 'cryo',
            severity: 'soft',
            reason: 'Cryo network overloaded: ' + crStats.heatLoad + ' W heat, ' + crStats.capacity + ' W capacity',
          });
        }
      }
    }

    // RF networks
    var rfNets = allNetworks.rfWaveguide;
    for (var ri = 0; ri < rfNets.length; ri++) {
      var rStats = Networks.validateRfNetwork(rfNets[ri]);
      if (!rStats.ok && rStats.cavities.length > 0) {
        var reasons = [];
        if (rStats.missingModulator) reasons.push('missing modulator');
        if (!rStats.frequencyMatch) reasons.push('frequency mismatch');
        if (rStats.totalDemand > rStats.forwardPower) reasons.push('insufficient RF power');
        blockers.push({
          type: 'rf',
          severity: 'soft',
          reason: 'RF network: ' + reasons.join(', '),
        });
      }
    }

    // 4. Vacuum check (global)
    var vacNets = allNetworks.vacuumPipe;
    var totalPumpSpeed = 0;
    var worstPressureQuality = null;
    var worstPressure = 0;
    for (var vi = 0; vi < vacNets.length; vi++) {
      var vStats = Networks.validateVacuumNetwork(vacNets[vi], state.beamline);
      totalPumpSpeed += vStats.effectivePumpSpeed;
      if (vStats.pressureQuality === 'Poor' || (!worstPressureQuality && vStats.avgPressure > worstPressure)) {
        worstPressureQuality = vStats.pressureQuality;
        worstPressure = vStats.avgPressure;
      }
    }

    var hasActiveComponents = false;
    for (var ac = 0; ac < state.beamline.length; ac++) {
      if (state.beamline[ac].type !== 'photonPort') {
        hasActiveComponents = true;
        break;
      }
    }

    if ((vacNets.length === 0 || totalPumpSpeed === 0) && hasActiveComponents) {
      blockers.push({
        type: 'vacuum',
        severity: 'soft',
        reason: 'No vacuum system connected to beamline',
      });
    } else if (worstPressureQuality === 'Poor' && hasActiveComponents) {
      blockers.push({
        type: 'vacuum',
        severity: 'soft',
        reason: 'Vacuum pressure too high: ' + worstPressure.toExponential(2) + ' mbar',
      });
    }

    // 5. Global checks
    // PPS interlock
    var hasPPS = false;
    for (var pp = 0; pp < state.facilityEquipment.length; pp++) {
      if (state.facilityEquipment[pp].type === 'ppsInterlock') {
        hasPPS = true;
        break;
      }
    }
    if (!hasPPS && state.beamline.length > 0) {
      blockers.push({
        type: 'pps',
        severity: 'hard',
        reason: 'PPS interlock required for beam operation',
      });
    }

    // Shielding
    var shieldCount = 0;
    var totalEnergyCost = 0;
    for (var si = 0; si < state.facilityEquipment.length; si++) {
      if (state.facilityEquipment[si].type === 'shielding') shieldCount++;
    }
    for (var ei = 0; ei < state.beamline.length; ei++) {
      var eComp = COMPONENTS[state.beamline[ei].type];
      if (eComp && eComp.energyCost) totalEnergyCost += eComp.energyCost;
    }
    var requiredShielding = Math.max(1, Math.ceil(totalEnergyCost / 50));
    if (shieldCount < requiredShielding && state.beamline.length > 0) {
      blockers.push({
        type: 'shielding',
        severity: 'hard',
        reason: 'Insufficient shielding: have ' + shieldCount + ', need ' + requiredShielding,
      });
    }

    // 6. Return result
    var hardBlockers = blockers.filter(function(b) { return b.severity === 'hard'; });
    return {
      canRun: hardBlockers.length === 0,
      blockers: blockers,
      networks: allNetworks,
    };
  },

  /**
   * Compute per-beamline-node quality multipliers from all network validations.
   * @param {object} allNetworks - Output of discoverAll()
   * @param {object} labBonuses - Output of findLabNetworkBonuses()
   * @param {Array} allBeamline - state.beamline array (needed for vacuum validation)
   * @returns {object} nodeId -> { powerQuality, rfQuality, coolingQuality, vacuumQuality, cryoQuality, cryoQuenched, dataQuality }
   */
  computeNodeQualities: function(allNetworks, labBonuses, allBeamline) {
    var qualities = {};

    // Initialize defaults for every beamline node
    for (var b = 0; b < allBeamline.length; b++) {
      var nid = allBeamline[b].id;
      qualities[nid] = {
        powerQuality: 1.0,
        rfQuality: 1.0,
        coolingQuality: 1.0,
        vacuumQuality: 1.0,
        cryoQuality: 1.0,
        cryoQuenched: false,
        dataQuality: 1.0,
      };
    }

    // --- Power ---
    var powerNets = allNetworks.powerCable || [];
    for (var pi = 0; pi < powerNets.length; pi++) {
      var pResult = Networks.validatePowerNetwork(powerNets[pi]);
      var pBonuses = [];
      if (labBonuses && labBonuses.powerCable) {
        for (var pb = 0; pb < labBonuses.powerCable.length; pb++) {
          if (labBonuses.powerCable[pb].clusterIndex === pi) {
            pBonuses.push(labBonuses.powerCable[pb]);
          }
        }
      }
      var pQuality = Networks.computeNetworkQuality(pResult.capacity, pResult.draw, pBonuses);
      for (var pn = 0; pn < powerNets[pi].beamlineNodes.length; pn++) {
        var pNodeId = powerNets[pi].beamlineNodes[pn].id;
        if (qualities[pNodeId]) {
          qualities[pNodeId].powerQuality = pQuality;
        }
      }
    }

    // --- RF ---
    var rfNets = allNetworks.rfWaveguide || [];
    for (var ri = 0; ri < rfNets.length; ri++) {
      var rResult = Networks.validateRfNetwork(rfNets[ri]);
      var rBonuses = [];
      if (labBonuses && labBonuses.rfWaveguide) {
        for (var rb = 0; rb < labBonuses.rfWaveguide.length; rb++) {
          if (labBonuses.rfWaveguide[rb].clusterIndex === ri) {
            rBonuses.push(labBonuses.rfWaveguide[rb]);
          }
        }
      }
      var rQuality = Networks.computeNetworkQuality(rResult.forwardPower, rResult.totalDemand, rBonuses);
      for (var rn = 0; rn < rfNets[ri].beamlineNodes.length; rn++) {
        var rNodeId = rfNets[ri].beamlineNodes[rn].id;
        if (qualities[rNodeId]) {
          qualities[rNodeId].rfQuality = rQuality;
        }
      }
    }

    // --- Cooling ---
    var coolNets = allNetworks.coolingWater || [];
    for (var ci = 0; ci < coolNets.length; ci++) {
      var cResult = Networks.validateCoolingNetwork(coolNets[ci]);
      var cBonuses = [];
      if (labBonuses && labBonuses.coolingWater) {
        for (var cb = 0; cb < labBonuses.coolingWater.length; cb++) {
          if (labBonuses.coolingWater[cb].clusterIndex === ci) {
            cBonuses.push(labBonuses.coolingWater[cb]);
          }
        }
      }
      var cQuality = Networks.computeNetworkQuality(cResult.capacity, cResult.heatLoad, cBonuses);
      for (var cn = 0; cn < coolNets[ci].beamlineNodes.length; cn++) {
        var cNodeId = coolNets[ci].beamlineNodes[cn].id;
        if (qualities[cNodeId]) {
          qualities[cNodeId].coolingQuality = cQuality;
        }
      }
    }

    // --- Vacuum (special: quality from pressureQuality string, not capacity/demand) ---
    var vacNets = allNetworks.vacuumPipe || [];
    for (var vi = 0; vi < vacNets.length; vi++) {
      var vResult = Networks.validateVacuumNetwork(vacNets[vi], allBeamline);
      var vBonuses = [];
      if (labBonuses && labBonuses.vacuumPipe) {
        for (var vb = 0; vb < labBonuses.vacuumPipe.length; vb++) {
          if (labBonuses.vacuumPipe[vb].clusterIndex === vi) {
            vBonuses.push(labBonuses.vacuumPipe[vb]);
          }
        }
      }
      var vQuality = Networks.computeNetworkQuality(vResult.quality, 1.0, vBonuses);
      for (var vn = 0; vn < vacNets[vi].beamlineNodes.length; vn++) {
        var vNodeId = vacNets[vi].beamlineNodes[vn].id;
        if (qualities[vNodeId]) {
          qualities[vNodeId].vacuumQuality = vQuality;
        }
      }
    }

    // --- Cryo (special: quench if ratio < 0.5) ---
    var cryoNets = allNetworks.cryoTransfer || [];
    for (var cri = 0; cri < cryoNets.length; cri++) {
      var crResult = Networks.validateCryoNetwork(cryoNets[cri]);
      var crBonuses = [];
      if (labBonuses && labBonuses.cryoTransfer) {
        for (var crb = 0; crb < labBonuses.cryoTransfer.length; crb++) {
          if (labBonuses.cryoTransfer[crb].clusterIndex === cri) {
            crBonuses.push(labBonuses.cryoTransfer[crb]);
          }
        }
      }
      var crQuality = Networks.computeNetworkQuality(crResult.capacity, crResult.heatLoad, crBonuses);
      var crQuenched = crResult.quenched || false;
      if (crQuenched) {
        crQuality = 0;
      }
      for (var crn = 0; crn < cryoNets[cri].beamlineNodes.length; crn++) {
        var crNodeId = cryoNets[cri].beamlineNodes[crn].id;
        if (qualities[crNodeId]) {
          qualities[crNodeId].cryoQuality = crQuality;
          qualities[crNodeId].cryoQuenched = crQuenched;
        }
      }
    }

    // --- Data fiber (no capacity/demand, base quality 1.0 + lab bonus) ---
    var dataNets = allNetworks.dataFiber || [];
    for (var di = 0; di < dataNets.length; di++) {
      var dBonuses = [];
      if (labBonuses && labBonuses.dataFiber) {
        for (var db = 0; db < labBonuses.dataFiber.length; db++) {
          if (labBonuses.dataFiber[db].clusterIndex === di) {
            dBonuses.push(labBonuses.dataFiber[db]);
          }
        }
      }
      var dQuality = Networks.computeNetworkQuality(1, 1, dBonuses);
      for (var dn = 0; dn < dataNets[di].beamlineNodes.length; dn++) {
        var dNodeId = dataNets[di].beamlineNodes[dn].id;
        if (qualities[dNodeId]) {
          qualities[dNodeId].dataQuality = dQuality;
        }
      }
    }

    return qualities;
  },

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
    var ratio = heatLoad > 0 ? Math.min(1.0, capacity / heatLoad) : (capacity > 0 ? 1.0 : 0);

    return {
      capacity: capacity,
      heatLoad: heatLoad,
      opTemp: opTemp,
      hasCompressor: hasCompressor,
      margin: margin,
      ok: capacity >= heatLoad && (heatLoad === 0 || capacity > 0),
      quality: ratio,
      quenched: ratio < 0.5 && heatLoad > 0,
      consumers: consumers,
    };
  },
};
