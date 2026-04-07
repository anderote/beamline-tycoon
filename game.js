// === BEAMLINE TYCOON: GAME ENGINE ===

class Game {
  constructor(beamline) {
    this.beamline = beamline;

    this.state = {
      resources: { funding: 5000000, reputation: 0, data: 0 },
      beamline: [],    // populated by recalcBeamline() from beamline.getOrderedComponents()
      beamOn: false,
      beamEnergy: 0,
      luminosity: 0,
      completedResearch: [],
      activeResearch: null,
      researchProgress: 0,
      totalDataCollected: 0,
      completedObjectives: [],
      discoveries: 0,
      tick: 0,
      log: [],
      totalLength: 0,
      totalEnergyCost: 0,
      dataRate: 0,
      beamQuality: 1,
      // Expanded economy
      totalBeamHours: 0,        // for user facility objectives
      continuousBeamTicks: 0,   // for stable beam objectives
      beamOnTicks: 0,           // total ticks with beam on (for uptime calc)
      uptimeFraction: 1,        // beamOnTicks / tick
      avgPressure: undefined,   // average vacuum pressure (from physics)
      finalNormEmittanceX: undefined,
      finalBunchLength: undefined,
      felSaturated: false,
      machineType: 'linac',       // current accelerator type: linac, photoinjector, fel, collider
      // Staffing
      staff: { operators: 1, technicians: 0, scientists: 0, engineers: 0 },
      staffCosts: { operators: 5, technicians: 8, scientists: 10, engineers: 12 }, // $/tick
      // Component health tracking
      componentHealth: {},      // id -> health (0-100)
      // Infrastructure tiles (paths, concrete pads)
      infrastructure: [],       // [{ type, col, row }]
      infraOccupied: {},        // "col,row" -> type
      // Zone overlays
      zones: [],                // [{ type, col, row }]
      zoneOccupied: {},         // "col,row" -> zoneType
      zoneConnectivity: {},     // zoneType -> { active: bool, tileCount: int, tier: int }
      // Facility equipment (off-beamline support systems)
      facilityEquipment: [],      // [{ id, type, col, row }]
      facilityGrid: {},           // "col,row" -> equipment id
      facilityNextId: 1,
      // Zone furnishings (purchasable items placed in zones)
      zoneFurnishings: [],        // [{ id, type, col, row }]
      zoneFurnishingGrid: {},     // "col,row" -> furnishing id
      zoneFurnishingNextId: 1,
      // Utility connections
      connections: new Map(),     // "col,row" -> Set of connection type keys
      // Machines (cyclotrons, stalls, rings)
      machines: [],             // machine instances
      machineGrid: {},          // "col,row" -> machineId
      // Physics results (set by runPhysics)
      physicsAlive: true,
      beamCurrent: 0,
      totalLossFraction: 0,
      discoveryChance: 0,
      photonRate: 0,
      collisionRate: 0,
      physicsEnvelope: null,
      // System-level infrastructure stats (computed by computeSystemStats)
      systemStats: null,
      infraBlockers: [],          // blockers from Networks.validate()
      infraCanRun: true,          // true if no blockers
      networkData: null,          // network discovery data
    };

    this.listeners = [];
    this.tickInterval = null;
    this.TICK_MS = 1000;
  }

  on(fn) { this.listeners.push(fn); }
  emit(event, data) { this.listeners.forEach(fn => fn(event, data)); }

  log(msg, type = '') {
    this.state.log.unshift({ msg, type, tick: this.state.tick });
    if (this.state.log.length > 100) this.state.log.length = 100;
    this.emit('log', { msg, type });
  }

  // === PLACEMENT ===

  canAfford(costs) {
    for (const [r, a] of Object.entries(costs))
      if ((this.state.resources[r] || 0) < a) return false;
    return true;
  }

  spend(costs) {
    for (const [r, a] of Object.entries(costs)) this.state.resources[r] -= a;
  }

  isComponentUnlocked(comp) {
    if (comp.unlocked) return true;
    if (!comp.requires) return true;   // no requirement = available by default
    if (Array.isArray(comp.requires)) {
      return comp.requires.every(req => this.state.completedResearch.includes(req));
    }
    return this.state.completedResearch.includes(comp.requires);
  }

  placeSource(col, row, dir) {
    const template = COMPONENTS.source;
    if (!template) return false;
    if (!this.isComponentUnlocked(template)) return false;
    if (!this.canAfford(template.cost)) { this.log(`Can't afford ${template.name}!`, 'bad'); return false; }
    if (template.maxCount) {
      const count = this.beamline.nodes.filter(n => n.type === 'source').length;
      if (count >= template.maxCount) {
        this.log(`Max ${template.name} reached.`, 'bad'); return false;
      }
    }

    const nodeId = this.beamline.placeSource(col, row, dir);
    if (nodeId == null) { this.log("Can't place there!", 'bad'); return false; }

    this.spend(template.cost);
    this.recalcBeamline();
    this.log(`Built ${template.name}`, 'good');
    this.emit('beamlineChanged');
    return true;
  }

  placeComponent(cursor, compType, bendDir) {
    const template = COMPONENTS[compType];
    if (!template) return false;
    if (!this.isComponentUnlocked(template)) return false;
    if (!this.canAfford(template.cost)) { this.log(`Can't afford ${template.name}!`, 'bad'); return false; }
    if (template.maxCount) {
      const count = this.beamline.nodes.filter(n => n.type === compType).length;
      if (count >= template.maxCount) {
        this.log(`Max ${template.name} reached.`, 'bad'); return false;
      }
    }

    const nodeId = this.beamline.placeAt(cursor, compType, bendDir);
    if (nodeId == null) { this.log("Can't place there!", 'bad'); return false; }

    this.spend(template.cost);
    this.recalcBeamline();
    this.log(`Built ${template.name}`, 'good');
    this.emit('beamlineChanged');
    return true;
  }

  removeComponent(nodeId) {
    const node = this.beamline.nodes.find(n => n.id === nodeId);
    if (!node) return false;

    const template = COMPONENTS[node.type];
    const removed = this.beamline.removeNode(nodeId);
    if (!removed) {
      this.log('Can only remove end pieces!', 'bad');
      return false;
    }

    // 50% refund
    if (template) {
      for (const [r, a] of Object.entries(template.cost))
        this.state.resources[r] += Math.floor(a * 0.5);
    }

    this.recalcBeamline();
    this.log(`Demolished ${template ? template.name : 'component'} (50% refund)`, 'info');
    this.emit('beamlineChanged');
    return true;
  }

  // === INFRASTRUCTURE ===

  placeInfraTile(col, row, infraType) {
    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return false;
    const key = col + ',' + row;
    const existing = this.state.infraOccupied[key];
    if (existing === infraType) return true; // same floor, no charge
    if (existing) {
      // Replace existing floor - remove old tile first
      this.state.infrastructure = this.state.infrastructure.filter(
        t => !(t.col === col && t.row === row)
      );
      // Remove zone on this tile since floor is changing
      const hadZone = this.state.zoneOccupied?.[key];
      if (hadZone) {
        delete this.state.zoneOccupied[key];
        this.state.zones = this.state.zones.filter(z => !(z.col === col && z.row === row));
      }
    }
    if (this.state.resources.funding < infra.cost) return false;

    this.state.resources.funding -= infra.cost;
    this.state.infrastructure.push({ type: infraType, col, row });
    this.state.infraOccupied[key] = infraType;
    if (infraType === 'hallway') {
      this.recomputeZoneConnectivity();
    }
    this.validateInfrastructure();
    return true;
  }

  placeInfraRect(startCol, startRow, endCol, endRow, infraType) {
    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return false;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    // Count new tiles and total cost (skip tiles that already have the same floor)
    let newTiles = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const existing = this.state.infraOccupied[c + ',' + r];
        if (existing !== infraType) newTiles++;
      }
    }
    if (newTiles === 0) return true; // all tiles already have this floor
    const totalCost = newTiles * infra.cost;
    if (this.state.resources.funding < totalCost) {
      this.log(`Need $${totalCost} for ${newTiles} tiles!`, 'bad');
      return false;
    }

    // Place all tiles
    let placed = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        const existing = this.state.infraOccupied[key];
        if (existing === infraType) continue; // same floor, skip
        if (existing) {
          // Replace existing floor - remove old tile
          this.state.infrastructure = this.state.infrastructure.filter(
            t => !(t.col === c && t.row === r)
          );
          // Remove zone on this tile since floor is changing
          if (this.state.zoneOccupied?.[key]) {
            delete this.state.zoneOccupied[key];
            this.state.zones = this.state.zones.filter(z => !(z.col === c && z.row === r));
          }
        }
        this.state.resources.funding -= infra.cost;
        this.state.infrastructure.push({ type: infraType, col: c, row: r });
        this.state.infraOccupied[key] = infraType;
        placed++;
      }
    }

    if (placed > 0) {
      this.log(`Placed ${placed} ${infra.name} tiles ($${placed * infra.cost})`, 'good');
      this.emit('infrastructureChanged');
      // Hallway changes affect zone connectivity
      if (infraType === 'hallway') {
        this.recomputeZoneConnectivity();
        this.emit('zonesChanged');
      }
      this.validateInfrastructure();
    }
    return placed > 0;
  }

  removeInfraTile(col, row) {
    const key = col + ',' + row;
    if (!this.state.infraOccupied[key]) return false;
    const idx = this.state.infrastructure.findIndex(t => t.col === col && t.row === row);
    if (idx === -1) return false;

    // Removing flooring also removes any zone on that tile
    if (this.state.zoneOccupied[key]) {
      this.removeZoneTile(col, row);
    }

    this.state.infrastructure.splice(idx, 1);
    const wasHallway = this.state.infraOccupied[key] === 'hallway';
    delete this.state.infraOccupied[key];

    if (wasHallway) {
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }

    this.emit('infrastructureChanged');
    this.validateInfrastructure();
    return true;
  }

  // === ZONES ===

  placeZoneTile(col, row, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;
    const key = col + ',' + row;
    // Must have the right flooring underneath
    const floor = this.state.infraOccupied[key];
    if (floor !== zone.requiredFloor) return false;
    // Overwrite existing zone if different type; skip if same type
    if (this.state.zoneOccupied[key]) {
      if (this.state.zoneOccupied[key] === zoneType) return false;
      this.removeZoneTile(col, row);
    }

    this.state.zones.push({ type: zoneType, col, row });
    this.state.zoneOccupied[key] = zoneType;
    this.recomputeZoneConnectivity();
    this.emit('zonesChanged');
    return true;
  }

  placeZoneRect(startCol, startRow, endCol, endRow, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    let placed = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        const floor = this.state.infraOccupied[key];
        if (floor !== zone.requiredFloor) continue;
        if (this.state.zoneOccupied[key] === zoneType) continue;
        if (this.state.zoneOccupied[key]) {
          // Overwrite existing zone
          const idx = this.state.zones.findIndex(z => z.col === c && z.row === r);
          if (idx !== -1) this.state.zones.splice(idx, 1);
          delete this.state.zoneOccupied[key];
        }

        this.state.zones.push({ type: zoneType, col: c, row: r });
        this.state.zoneOccupied[key] = zoneType;
        placed++;
      }
    }

    if (placed > 0) {
      this.log(`Assigned ${placed} ${zone.name} tiles`, 'good');
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }
    return placed > 0;
  }

  removeZoneRect(startCol, startRow, endCol, endRow) {
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    let removed = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        if (this.state.zoneOccupied[key]) {
          const idx = this.state.zones.findIndex(z => z.col === c && z.row === r);
          if (idx !== -1) {
            this.state.zones.splice(idx, 1);
            delete this.state.zoneOccupied[key];
            removed++;
          }
        }
      }
    }
    if (removed > 0) {
      this.log(`Cleared ${removed} zone tiles`, 'info');
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }
    return removed > 0;
  }

  removeInfraRect(startCol, startRow, endCol, endRow) {
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    let removed = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        if (this.removeInfraTile(c, r)) removed++;
      }
    }
    if (removed > 0) {
      this.log(`Removed ${removed} floor tiles`, 'info');
    }
    return removed > 0;
  }

  removeZoneTile(col, row) {
    const key = col + ',' + row;
    if (!this.state.zoneOccupied[key]) return false;
    const idx = this.state.zones.findIndex(z => z.col === col && z.row === row);
    if (idx !== -1) {
      this.state.zones.splice(idx, 1);
      delete this.state.zoneOccupied[key];
      // Also remove any furnishing on this tile
      const furnId = this.state.zoneFurnishingGrid[key];
      if (furnId) {
        const fi = this.state.zoneFurnishings.findIndex(e => e.id === furnId);
        if (fi !== -1) this.state.zoneFurnishings.splice(fi, 1);
        delete this.state.zoneFurnishingGrid[key];
      }
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
      return true;
    }
    return false;
  }

  // Flood-fill from Control Room through hallways to determine zone connectivity
  recomputeZoneConnectivity() {
    const connectivity = {};
    for (const zoneType of Object.keys(ZONES)) {
      connectivity[zoneType] = { active: false, tileCount: 0, tier: 0 };
    }

    // Count tiles per zone type
    for (const z of this.state.zones) {
      if (connectivity[z.type]) {
        connectivity[z.type].tileCount++;
      }
    }

    // Compute tier from tile count
    for (const info of Object.values(connectivity)) {
      info.tier = 0;
      for (let t = ZONE_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
        if (info.tileCount >= ZONE_TIER_THRESHOLDS[t]) { info.tier = t + 1; break; }
      }
    }

    // Find all Control Room tiles
    const controlRoomTiles = this.state.zones
      .filter(z => z.type === 'controlRoom')
      .map(z => z.col + ',' + z.row);

    if (controlRoomTiles.length === 0) {
      this.state.zoneConnectivity = connectivity;
      return;
    }

    // Control Room is always active if it exists
    connectivity.controlRoom.active = true;

    // Find all hallway tiles adjacent to Control Room — seed the flood fill
    const hallwaySet = new Set();
    for (const tile of this.state.infrastructure) {
      if (tile.type === 'hallway') hallwaySet.add(tile.col + ',' + tile.row);
    }

    const visited = new Set();
    const queue = [];

    // Seed: hallway tiles adjacent to any Control Room tile
    for (const crKey of controlRoomTiles) {
      const [cc, cr] = crKey.split(',').map(Number);
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = (cc + dc) + ',' + (cr + dr);
        if (hallwaySet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    // BFS through hallway tiles
    while (queue.length > 0) {
      const cur = queue.shift();
      const [cc, cr] = cur.split(',').map(Number);
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = (cc + dc) + ',' + (cr + dr);
        if (hallwaySet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    // Check each zone: if any tile is adjacent to a reachable hallway tile, it's active
    const zonesByType = {};
    for (const z of this.state.zones) {
      if (!zonesByType[z.type]) zonesByType[z.type] = [];
      zonesByType[z.type].push(z);
    }

    for (const [zoneType, tiles] of Object.entries(zonesByType)) {
      if (zoneType === 'controlRoom') continue; // already active
      for (const tile of tiles) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nk = (tile.col + dc) + ',' + (tile.row + dr);
          if (visited.has(nk)) {
            connectivity[zoneType].active = true;
            break;
          }
        }
        if (connectivity[zoneType].active) break;
      }
    }

    this.state.zoneConnectivity = connectivity;
  }

  // Get the achieved tier for a gated category (0 = no zone, 1-3 = tier)
  getZoneTierForCategory(category) {
    for (const zone of Object.values(ZONES)) {
      const gates = Array.isArray(zone.gatesCategory) ? zone.gatesCategory : [zone.gatesCategory];
      if (gates.includes(category)) {
        const conn = this.state.zoneConnectivity?.[zone.id];
        if (!conn || !conn.active) return 0;
        return conn.tier;
      }
    }
    return 99; // ungated category
  }

  // === FACILITY EQUIPMENT ===

  placeFacilityEquipment(col, row, compType) {
    const comp = COMPONENTS[compType];
    if (!comp) return false;
    if (!this.isComponentUnlocked(comp)) return false;
    if (!this.canAfford(comp.cost)) {
      this.log(`Can't afford ${comp.name}!`, 'bad');
      return false;
    }

    // Zone gating
    const zoneTier = this.getZoneTierForCategory(comp.category);
    const compTier = comp.zoneTier || 1;
    if (zoneTier < compTier) {
      this.log(`Need more zone area for ${comp.name}!`, 'bad');
      return false;
    }

    const key = col + ',' + row;
    // Require concrete flooring
    const floor = this.state.infraOccupied[key];
    if (floor !== 'concrete') {
      this.log(floor ? 'Need concrete flooring!' : 'Must build on concrete flooring!', 'bad');
      return false;
    }
    if (this.state.facilityGrid[key]) {
      this.log('Tile occupied!', 'bad');
      return false;
    }
    if (this.beamline.getNodeAt(col, row)) {
      this.log('Tile occupied by beamline!', 'bad');
      return false;
    }
    if (this.state.machineGrid[key]) {
      this.log('Tile occupied!', 'bad');
      return false;
    }

    const id = 'fac_' + this.state.facilityNextId++;
    this.spend(comp.cost);
    const entry = { id, type: compType, col, row };
    this.state.facilityEquipment.push(entry);
    this.state.facilityGrid[key] = id;
    this.log(`Built ${comp.name}`, 'good');
    this.computeSystemStats();
    this.emit('facilityChanged');
    this.validateInfrastructure();
    return true;
  }

  removeFacilityEquipment(equipId) {
    const idx = this.state.facilityEquipment.findIndex(e => e.id === equipId);
    if (idx === -1) return false;

    const entry = this.state.facilityEquipment[idx];
    const comp = COMPONENTS[entry.type];

    // 50% refund
    if (comp) {
      for (const [r, a] of Object.entries(comp.cost))
        this.state.resources[r] += Math.floor(a * 0.5);
    }

    const key = entry.col + ',' + entry.row;
    delete this.state.facilityGrid[key];
    this.state.facilityEquipment.splice(idx, 1);
    this.log(`Removed ${comp ? comp.name : 'equipment'} (50% refund)`, 'info');
    this.computeSystemStats();
    this.emit('facilityChanged');
    this.validateInfrastructure();
    return true;
  }

  // === ZONE FURNISHINGS ===

  placeZoneFurnishing(col, row, furnType) {
    const furn = ZONE_FURNISHINGS[furnType];
    if (!furn) return false;
    if (!this.canAfford({ funding: furn.cost })) {
      this.log(`Can't afford ${furn.name}!`, 'bad');
      return false;
    }

    const key = col + ',' + row;
    // Must be on a zone tile of the correct type
    const zoneType = this.state.zoneOccupied[key];
    if (zoneType !== furn.zoneType) {
      const zone = ZONES[furn.zoneType];
      this.log(`Must place on ${zone ? zone.name : furn.zoneType}!`, 'bad');
      return false;
    }
    if (this.state.zoneFurnishingGrid[key]) {
      this.log('Tile occupied!', 'bad');
      return false;
    }

    const id = 'zf_' + this.state.zoneFurnishingNextId++;
    this.spend({ funding: furn.cost });
    const entry = { id, type: furnType, col, row };
    this.state.zoneFurnishings.push(entry);
    this.state.zoneFurnishingGrid[key] = id;
    this.log(`Built ${furn.name}`, 'good');
    this.emit('zonesChanged');
    return true;
  }

  removeZoneFurnishing(furnId) {
    const idx = this.state.zoneFurnishings.findIndex(e => e.id === furnId);
    if (idx === -1) return false;

    const entry = this.state.zoneFurnishings[idx];
    const furn = ZONE_FURNISHINGS[entry.type];

    // 50% refund
    if (furn) {
      this.state.resources.funding += Math.floor(furn.cost * 0.5);
    }

    const key = entry.col + ',' + entry.row;
    delete this.state.zoneFurnishingGrid[key];
    this.state.zoneFurnishings.splice(idx, 1);
    this.log(`Removed ${furn ? furn.name : 'furnishing'} (50% refund)`, 'info');
    this.emit('zonesChanged');
    return true;
  }

  // === CONNECTIONS ===

  placeConnection(col, row, connType) {
    const key = col + ',' + row;
    if (!this.state.connections.has(key)) {
      this.state.connections.set(key, new Set());
    }
    const set = this.state.connections.get(key);
    if (set.has(connType)) return false; // already exists
    set.add(connType);
    this.emit('connectionsChanged');
    this.validateInfrastructure();
    return true; // added
  }

  removeConnection(col, row, connType) {
    const key = col + ',' + row;
    const set = this.state.connections.get(key);
    if (!set || !set.has(connType)) return false;
    set.delete(connType);
    if (set.size === 0) this.state.connections.delete(key);
    this.emit('connectionsChanged');
    this.validateInfrastructure();
    return true; // removed
  }

  getConnectionsAt(col, row) {
    const key = col + ',' + row;
    return this.state.connections.get(key) || new Set();
  }

  // Check if a beamline component has a valid connection of the given type
  hasValidConnection(node, connType) {
    const conn = CONNECTION_TYPES[connType];
    if (!conn) return false;

    // Check tiles adjacent to ALL occupied tiles of this component
    const occupied = new Set((node.tiles || [{ col: node.col, row: node.row }])
      .map(t => t.col + ',' + t.row));
    const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: 1, dr: 0 }, { dc: -1, dr: 0 }];

    for (const tile of (node.tiles || [{ col: node.col, row: node.row }])) {
      for (const d of dirs) {
        const ac = tile.col + d.dc, ar = tile.row + d.dr;
        if (occupied.has(ac + ',' + ar)) continue; // skip own tiles
        const connSet = this.getConnectionsAt(ac, ar);
        if (!connSet.has(connType)) continue;
        if (this._traceConnectionToSource(ac, ar, connType)) return true;
      }
    }
    return false;
  }

  _traceConnectionToSource(startCol, startRow, connType) {
    // BFS from the tile adjacent to the beamline component, following
    // connected tiles of the same type, looking for facility equipment
    const visited = new Set();
    const queue = [{ col: startCol, row: startRow }];

    while (queue.length > 0) {
      const { col, row } = queue.shift();
      const key = col + ',' + row;
      if (visited.has(key)) continue;
      visited.add(key);

      // Check if there's facility equipment here
      const equipId = this.state.facilityGrid[key];
      if (equipId) {
        const equip = this.state.facilityEquipment.find(e => e.id === equipId);
        if (equip) {
          const equipConn = this._getEquipmentConnectionType(equip.type);
          if (equipConn === connType) return true;
        }
      }

      // Expand to neighbors that have this connection type
      const neighbors = [
        { col: col, row: row - 1 },
        { col: col, row: row + 1 },
        { col: col + 1, row: row },
        { col: col - 1, row: row },
      ];
      for (const n of neighbors) {
        const nKey = n.col + ',' + n.row;
        if (!visited.has(nKey) && this.getConnectionsAt(n.col, n.row).has(connType)) {
          queue.push(n);
        }
      }
    }
    return false;
  }

  _getEquipmentConnectionType(compType) {
    const comp = COMPONENTS[compType];
    if (!comp) return null;
    if (comp.category === 'cooling' && comp.subsection === 'cryogenics') return 'cryoTransfer';
    switch (comp.category) {
      case 'vacuum': return 'vacuumPipe';
      case 'rfPower': return 'rfWaveguide';
      case 'cooling': return 'coolingWater';
      case 'power': return 'powerCable';
      case 'dataControls': return 'dataFiber';
      default: return null;
    }
  }

  // === STATS ===

  recalcBeamline() {
    const ordered = this.beamline.getOrderedComponents();
    this.state.beamline = ordered;

    // Calculate energy cost and total length from templates
    let tLen = 0, tCost = 0, hasSrc = false;
    const ecm = this.getEffect('energyCostMult', 1);
    for (const node of ordered) {
      const t = COMPONENTS[node.type];
      if (!t) continue;
      tLen += t.length;
      tCost += t.energyCost * ecm;
      if (t.isSource) hasSrc = true;
    }
    this.state.totalLength = tLen;
    this.state.totalEnergyCost = Math.ceil(tCost);

    if (!hasSrc) {
      this.state.beamEnergy = 0;
      this.state.dataRate = 0;
      this.state.beamQuality = 1;
      this.state.luminosity = 0;
      this.state.physicsEnvelope = null;
      return;
    }

    // Build ordered beamline for physics engine
    const physicsBeamline = ordered
      .map(node => {
        const t = COMPONENTS[node.type];
        // Use computed stats from slider tuning if available, otherwise template defaults
        const effectiveStats = { ...(t.stats || {}) };
        if (node.computedStats) {
          Object.assign(effectiveStats, node.computedStats);
        }
        return {
          type: node.type,
          length: t.length,
          stats: effectiveStats,
          params: node.params || {},
        };
      });

    // Gather research effects for physics
    const researchEffects = {};
    for (const key of ['luminosityMult', 'dataRateMult', 'energyCostMult', 'discoveryChance',
                        'vacuumQuality', 'beamStability', 'photonFluxMult', 'cryoEfficiencyMult',
                        'beamLifetimeMult', 'diagnosticPrecision']) {
      const v = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
      researchEffects[key] = v;
    }
    researchEffects.machineType = this.state.machineType;

    // Run physics simulation
    this.runPhysics(physicsBeamline, researchEffects);
    this.checkInjectorLinks();
    this.validateInfrastructure();
  }

  runPhysics(physicsBeamline, researchEffects) {
    if (!BeamPhysics.isReady()) {
      // Physics not loaded yet — use simple fallback
      this._fallbackStats(physicsBeamline);
      return;
    }

    const result = BeamPhysics.compute(physicsBeamline, researchEffects);
    if (!result) {
      this._fallbackStats(physicsBeamline);
      return;
    }

    // Apply physics results to game state
    this.state.beamEnergy = result.beamEnergy;
    this.state.dataRate = result.dataRate;
    this.state.beamQuality = result.beamQuality;
    this.state.luminosity = result.luminosity || 0;
    this.state.physicsAlive = result.beamAlive;
    this.state.beamCurrent = result.beamCurrent;
    this.state.totalLossFraction = result.totalLossFraction;
    this.state.discoveryChance = result.discoveryChance || 0;
    this.state.photonRate = result.photonRate || 0;
    this.state.collisionRate = result.collisionRate || 0;
    this.state.physicsEnvelope = result.envelope || null;

    // If physics says beam tripped, shut it down
    if (this.state.beamOn && !result.beamAlive) {
      this.state.beamOn = false;
      this.log('Beam TRIPPED — too much loss! Fix your optics.', 'bad');
      this.emit('beamToggled');
    }
  }

  _fallbackStats(physicsBeamline) {
    // Simple stat-summing fallback while Pyodide loads
    let eGain = 0, dRate = 0, bq = 1;
    for (const el of physicsBeamline) {
      const s = el.stats || {};
      if (s.energyGain) eGain += s.energyGain;
      if (s.dataRate) dRate += s.dataRate;
      if (s.beamQuality) bq += s.beamQuality;
    }
    this.state.beamEnergy = eGain;
    this.state.dataRate = dRate * bq;
    this.state.beamQuality = bq;
    this.state.luminosity = 0;
    this.state.physicsAlive = true;
    this.state.beamCurrent = 0;
    this.state.totalLossFraction = 0;
    this.state.discoveryChance = 0;
    this.state.photonRate = 0;
    this.state.collisionRate = 0;
    this.state.physicsEnvelope = null;
  }

  // === BEAM CONTROL ===

  // === MACHINE TYPE SELECTION ===

  setMachineType(type) {
    const MACHINE_TYPE_RESEARCH = {
      linac: null,
      photoinjector: 'photoinjectorTech',
      fel: 'felTech',
      collider: 'colliderTech',
    };
    const req = MACHINE_TYPE_RESEARCH[type];
    if (req && !this.state.completedResearch.includes(req)) {
      this.log(`Research "${req}" required to unlock ${type}`, 'bad');
      return false;
    }
    this.state.machineType = type;
    this.log(`Switched to ${type.charAt(0).toUpperCase() + type.slice(1)} mode`, 'info');
    this.recalcBeamline();
    this.emit('machineTypeChanged');
    return true;
  }

  isMachineTypeUnlocked(type) {
    const MACHINE_TYPE_RESEARCH = {
      linac: null,
      photoinjector: 'photoinjectorTech',
      fel: 'felTech',
      collider: 'colliderTech',
    };
    const req = MACHINE_TYPE_RESEARCH[type];
    return !req || this.state.completedResearch.includes(req);
  }

  // === BEAM CONTROL ===

  toggleBeam() {
    if (this.state.beamOn) {
      this.state.beamOn = false;
      this.state.continuousBeamTicks = 0;
      this.log('Beam OFF', 'info');
    } else {
      if (!this.beamline.nodes.some(n => COMPONENTS[n.type]?.isSource)) {
        this.log('Need a Source!', 'bad'); return;
      }
      this.validateInfrastructure();
      if (!this.state.infraCanRun) {
        const count = this.state.infraBlockers.length;
        this.log(`Cannot start beam: ${count} infrastructure issue${count > 1 ? 's' : ''}`, 'bad');
        for (const b of this.state.infraBlockers.slice(0, 3)) {
          this.log(`  - ${b.reason}`, 'bad');
        }
        if (count > 3) this.log(`  ... and ${count - 3} more`, 'bad');
        return;
      }
      this.state.beamOn = true;
      this.log('Beam ON!', 'good');
    }
    this.emit('beamToggled');
  }

  // === RESEARCH ===

  isResearchAvailable(id) {
    const r = RESEARCH[id];
    if (!r || r.hidden || this.state.completedResearch.includes(id) || this.state.activeResearch === id) return false;
    if (!r.requires) return true;
    if (Array.isArray(r.requires)) {
      return r.requires.every(req => this.state.completedResearch.includes(req));
    }
    return this.state.completedResearch.includes(r.requires);
  }

  startResearch(id) {
    if (!this.isResearchAvailable(id)) return false;
    const r = RESEARCH[id];
    // Check lab gate
    const speedMult = this.getResearchSpeedMultiplier(id);
    if (speedMult === null) {
      const labType = RESEARCH_LAB_MAP[r.category];
      const labName = ZONES[labType]?.name || labType;
      const isFinal = this._computeFinalNodes().has(id);
      const minTier = isFinal ? 2 : 1;
      this.log(`Requires ${labName} (Tier ${minTier}+) to begin`, 'bad');
      return false;
    }
    // Check all costs (data, funding, reputation)
    const costs = {};
    if (r.cost.data) costs.data = r.cost.data;
    if (r.cost.funding) costs.funding = r.cost.funding;
    if (r.cost.reputation) {
      // Reputation is checked but not spent — it's a threshold
      if ((this.state.resources.reputation || 0) < r.cost.reputation) {
        this.log(`Need ${r.cost.reputation} reputation`, 'bad');
        return false;
      }
    }
    if (!this.canAfford(costs)) {
      const missing = [];
      if (costs.data && (this.state.resources.data || 0) < costs.data) missing.push(`${costs.data} data`);
      if (costs.funding && (this.state.resources.funding || 0) < costs.funding) missing.push(`$${costs.funding}`);
      this.log(`Need ${missing.join(' + ')}`, 'bad');
      return false;
    }
    this.spend(costs);
    this.state.activeResearch = id;
    this.state.researchProgress = 0;
    this.log(`Researching: ${r.name}`, 'info');
    this.emit('researchChanged');
    return true;
  }

  getEffect(key, def) {
    let v = def;
    for (const id of this.state.completedResearch) {
      const r = RESEARCH[id];
      if (r?.effect?.[key] !== undefined)
        v = key.endsWith('Mult') ? v * r.effect[key] : v + r.effect[key];
    }
    return v;
  }

  // === LAB-GATED RESEARCH ===

  // Compute depth of a research node in its prerequisite chain (root = 1)
  _computeNodeDepth(id) {
    if (this._nodeDepthCache?.[id] !== undefined) return this._nodeDepthCache[id];
    const r = RESEARCH[id];
    if (!r || !r.requires) return 1;
    const reqs = Array.isArray(r.requires) ? r.requires : [r.requires];
    const depth = 1 + Math.max(...reqs.map(req => this._computeNodeDepth(req)));
    if (!this._nodeDepthCache) this._nodeDepthCache = {};
    this._nodeDepthCache[id] = depth;
    return depth;
  }

  // Compute which nodes are "final" (no other node in same category requires them)
  _computeFinalNodes() {
    if (this._finalNodes) return this._finalNodes;
    const referenced = new Set();
    for (const r of Object.values(RESEARCH)) {
      if (r.requires) {
        const reqs = Array.isArray(r.requires) ? r.requires : [r.requires];
        for (const req of reqs) referenced.add(req);
      }
    }
    this._finalNodes = new Set();
    for (const [id, r] of Object.entries(RESEARCH)) {
      if (!r.hidden && !referenced.has(id)) this._finalNodes.add(id);
    }
    return this._finalNodes;
  }

  // Get the furnishing-based tier for a specific zone type
  _getFurnishingTier(zoneType) {
    let count = 0;
    for (const f of this.state.zoneFurnishings || []) {
      const def = ZONE_FURNISHINGS[f.type];
      if (def && def.zoneType === zoneType) count++;
    }
    let tier = 0;
    for (let t = FURNISHING_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
      if (count >= FURNISHING_TIER_THRESHOLDS[t]) { tier = t + 1; break; }
    }
    return tier;
  }

  // Get the combined research tier for a lab: min(zoneTileTier, furnishingTier)
  getLabResearchTier(labType) {
    const conn = this.state.zoneConnectivity?.[labType];
    if (!conn || !conn.active) {
      // Lab exists but not connected, or doesn't exist — use furnishing tier capped by tile tier
      const tileTier = conn ? conn.tier : 0;
      const furnTier = this._getFurnishingTier(labType);
      return Math.min(tileTier, furnTier);
    }
    const tileTier = conn.tier;
    const furnTier = this._getFurnishingTier(labType);
    return Math.min(tileTier, furnTier);
  }

  // Get the speed multiplier for a research node (null = blocked)
  getResearchSpeedMultiplier(id) {
    const r = RESEARCH[id];
    if (!r) return null;
    const labType = RESEARCH_LAB_MAP[r.category];
    if (!labType) return 1; // no lab mapping = normal speed
    const tier = this.getLabResearchTier(labType);
    const depth = this._computeNodeDepth(id);
    const isFinal = this._computeFinalNodes().has(id);

    let row;
    if (isFinal) row = 'final';
    else if (depth >= 5) row = 'late';
    else if (depth >= 3) row = 'mid';
    else row = 'early';

    return RESEARCH_SPEED_TABLE[row][tier];
  }

  // === GAME LOOP ===

  start() {
    if (this.tickInterval) return;
    this.computeSystemStats();
    this.validateInfrastructure();
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);
    this.log('Welcome to Beamline Tycoon!', 'info');
    this.emit('started');
  }

  tick() {
    this.state.tick++;

    // === Revenue ===
    const passiveIncome = this.getEffect('passiveFunding', 0);
    const repIncome = Math.floor(this.state.resources.reputation * 0.5);
    this.state.resources.funding += passiveIncome + repIncome;

    // Staffing costs
    const staffCost = Object.entries(this.state.staff).reduce((sum, [type, count]) => {
      return sum + count * (this.state.staffCosts[type] || 0);
    }, 0);
    this.state.resources.funding -= staffCost;

    if (this.state.beamOn) {
      if (this.state.infraCanRun) {
        this.state.continuousBeamTicks++;
        this.state.beamOnTicks++;

        // Data from detectors (physics-driven)
        if (this.state.dataRate > 0) {
          // Only count data from diagnostics with data/fiber connections to IOCs
          let connectedDataRate = this.state.dataRate;
          if (typeof Networks !== 'undefined' && this.state.networkData) {
            const dataConnected = new Set();
            for (const net of (this.state.networkData.dataFiber || [])) {
              const hasIoc = net.equipment.some(eq => eq.type === 'rackIoc');
              if (hasIoc) {
                for (const node of net.beamlineNodes) dataConnected.add(node.id);
              }
            }
            let totalDiagRate = 0, connDiagRate = 0;
            for (const node of this.state.beamline) {
              const comp = COMPONENTS[node.type];
              if (comp && (comp.stats?.dataRate || 0) > 0) {
                totalDiagRate += comp.stats.dataRate;
                if (dataConnected.has(node.id)) connDiagRate += comp.stats.dataRate;
              }
            }
            if (totalDiagRate > 0) {
              connectedDataRate = this.state.dataRate * (connDiagRate / totalDiagRate);
            }
          }
          const sciMult = 1 + this.state.staff.scientists * 0.1;
          const dataGain = connectedDataRate * sciMult;
          this.state.resources.data += dataGain;
          this.state.totalDataCollected += dataGain;
        }

        // Photon data from undulators (bonus data, scaled down)
        if (this.state.photonRate > 0) {
          const photonData = this.state.photonRate * 0.1 * this.state.beamQuality;
          this.state.resources.data += photonData;
          this.state.totalDataCollected += photonData;
        }

        // User beam hours from photon ports
        const photonPorts = this.state.beamline.filter(c => c.type === 'photonPort');
        if (photonPorts.length > 0 && this.state.beamQuality > 0.5) {
          const beamHoursThisTick = photonPorts.length * (1 / 3600); // 1 second = 1/3600 hour
          this.state.totalBeamHours += beamHoursThisTick;
          // User fees revenue
          const userFees = photonPorts.length * 2 * this.state.beamQuality;
          this.state.resources.funding += userFees;
          this.state.resources.reputation += photonPorts.length * 0.001;
        }

        // Discovery chance (physics-driven)
        const dc = this.state.discoveryChance || 0;
        if (dc > 0 && Math.random() < dc) {
          this.state.discoveries++;
          this.log('*** PARTICLE DISCOVERY! ***', 'reward');
          this.state.resources.reputation += 10;
          this.state.resources.funding += 5000;
        }

        // Beam quality affects reputation gain passively (scaled, not binary)
        if (this.state.tick % 60 === 0 && this.state.beamQuality > 0.3) {
          this.state.resources.reputation += this.state.beamQuality * 0.6;
        }

        // Component wear (every 10 ticks)
        if (this.state.tick % 10 === 0) {
          this._applyWear();
        }
      }
    } else {
      this.state.continuousBeamTicks = 0;
    }

    // Uptime tracking
    if (this.state.tick > 0) {
      this.state.uptimeFraction = this.state.beamOnTicks / this.state.tick;
    }

    // Technician auto-repair
    if (this.state.staff.technicians > 0 && this.state.tick % 5 === 0) {
      this._autoRepair();
    }

    // Research progress (scientists speed it up, beam quality matters, lab tier affects speed)
    if (this.state.activeResearch) {
      const r = RESEARCH[this.state.activeResearch];
      const sciBonus = 1 + this.state.staff.scientists * 0.05;
      const bqFactor = this.state.beamOn ? (0.5 + 0.5 * this.state.beamQuality) : 0.5;
      const speedMult = this.getResearchSpeedMultiplier(this.state.activeResearch) || 1;
      this.state.researchProgress += (1 / speedMult) * sciBonus * bqFactor;
      if (this.state.researchProgress >= r.duration) {
        this.state.completedResearch.push(this.state.activeResearch);
        this.log(`Research done: ${r.name}!`, 'reward');
        if (r.unlocks) {
          for (const c of r.unlocks) {
            if (COMPONENTS[c]) this.log(`Unlocked: ${COMPONENTS[c].name}`, 'good');
          }
        }
        if (r.unlocksMachines && typeof MACHINES !== 'undefined') {
          for (const m of r.unlocksMachines) {
            if (MACHINES[m]) this.log(`Unlocked machine: ${MACHINES[m].name}`, 'good');
          }
        }
        this.state.activeResearch = null;
        this.state.researchProgress = 0;
        this.recalcBeamline();
        this.emit('researchChanged');
      }
    }

    // Budget crisis check
    if (this.state.resources.funding < -1000) {
      if (this.state.tick % 30 === 0) {
        this.log('BUDGET CRISIS! Operating at a loss.', 'bad');
      }
    }

    for (const obj of OBJECTIVES) {
      if (this.state.completedObjectives.includes(obj.id)) continue;
      try {
        if (obj.condition(this.state)) {
          this.state.completedObjectives.push(obj.id);
          for (const [r, a] of Object.entries(obj.reward))
            this.state.resources[r] = (this.state.resources[r] || 0) + a;
          this.log(`Goal complete: ${obj.name}!`, 'reward');
          this.emit('objectiveCompleted', obj);
        }
      } catch { /* objective condition may reference undefined state */ }
    }

    // Tick machines (cyclotrons, stalls, rings)
    this._tickMachines();

    // Recompute system-level infrastructure stats
    this.computeSystemStats();

    // Auto-save every 30 ticks
    if (this.state.tick % 30 === 0) this.save();

    this.emit('tick');
  }

  // === SYSTEM-LEVEL INFRASTRUCTURE STATS ===

  computeSystemStats() {
    const equip = this.state.facilityEquipment || [];
    const beamline = this.state.beamline || [];
    const nets = this.state.networkData; // may be null if Networks not loaded yet

    // Count facility equipment by type
    const counts = {};
    for (const e of equip) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }

    // Helper: sum energyCost for equipment types in a category (optionally filtered by subsection)
    const categoryDraw = (cat, sub) => {
      let draw = 0;
      for (const e of equip) {
        const comp = COMPONENTS[e.type];
        if (!comp || comp.category !== cat) continue;
        if (sub && comp.subsection !== sub) continue;
        draw += (comp.energyCost || 0);
      }
      return draw;
    };

    // Helper: total beamline interior volume
    const totalVolume = beamline.reduce((sum, n) => {
      const c = COMPONENTS[n.type];
      return sum + (c ? (c.interiorVolume || 0) : 0);
    }, 0);

    // === VACUUM ===
    const pumpTypes = ['roughingPump', 'turboPump', 'ionPump', 'negPump', 'tiSubPump'];
    const gaugeTypes = ['piraniGauge', 'coldCathodeGauge', 'baGauge'];
    const pumpCount = pumpTypes.reduce((s, t) => s + (counts[t] || 0), 0);
    const gaugeCount = gaugeTypes.reduce((s, t) => s + (counts[t] || 0), 0);
    const pumpSpeeds = { roughingPump: 10, turboPump: 300, ionPump: 100, negPump: 200, tiSubPump: 500 };

    // If network validation data is available, use vacuum conductance calculations
    let avgPressure, totalPumpSpeed, pressureQuality;
    if (nets && nets.vacuumPipe && nets.vacuumPipe.length > 0) {
      const vacNets = nets.vacuumPipe.map(net => Networks.validateVacuumNetwork(net, beamline));
      totalPumpSpeed = vacNets.reduce((s, n) => s + n.effectivePumpSpeed, 0);
      const gasLoad = Math.max(totalVolume, 1) * Networks.OUTGASSING_RATE;
      avgPressure = totalPumpSpeed > 0 ? gasLoad / totalPumpSpeed : (pumpCount > 0 ? 1013 : 1013);
      // Derive quality from the computed pressure
      if (totalPumpSpeed === 0) pressureQuality = 'None';
      else if (avgPressure < 1e-9) pressureQuality = 'Excellent';
      else if (avgPressure < 1e-7) pressureQuality = 'Good';
      else if (avgPressure < 1e-4) pressureQuality = 'Marginal';
      else pressureQuality = 'Poor';
    } else {
      // Fallback to old estimation from equipment counts
      totalPumpSpeed = pumpTypes.reduce((s, t) => s + (counts[t] || 0) * (pumpSpeeds[t] || 0), 0);
      avgPressure = this.state.avgPressure || (pumpCount > 0 ? 1e-6 / Math.max(totalPumpSpeed / Math.max(totalVolume, 1), 0.01) : 1013);
      pressureQuality = 'None';
      if (pumpCount > 0) {
        if (avgPressure < 1e-9) pressureQuality = 'Excellent';
        else if (avgPressure < 1e-7) pressureQuality = 'Good';
        else if (avgPressure < 1e-4) pressureQuality = 'Marginal';
        else pressureQuality = 'Poor';
      }
    }

    this.state.avgPressure = avgPressure;

    const vacuum = {
      avgPressure,
      totalPumpSpeed,
      beamlineVolume: totalVolume,
      pumpCount,
      gaugeCount,
      energyDraw: categoryDraw('vacuum'),
      pressureQuality,
      detail: {
        roughingPumps: counts.roughingPump || 0,
        turboPumps: counts.turboPump || 0,
        ionPumps: counts.ionPump || 0,
        negPumps: counts.negPump || 0,
        tiSubPumps: counts.tiSubPump || 0,
        piraniGauges: counts.piraniGauge || 0,
        ccGauges: counts.coldCathodeGauge || 0,
        baGauges: counts.baGauge || 0,
        gateValves: counts.gateValve || 0,
        bakeoutSystems: counts.bakeoutSystem || 0,
      },
    };

    // === RF POWER ===
    const rfSourceTypes = ['klystron', 'ssa', 'iot', 'magnetron'];
    const rfSupportTypes = ['modulator', 'circulator', 'waveguide', 'llrfController', 'masterOscillator', 'vectorModulator'];
    const rfSourceCount = rfSourceTypes.reduce((s, t) => s + (counts[t] || 0), 0);

    // If network data exists, sum forward/reflected power from RF network validations
    let totalFwdPower, totalReflPower;
    if (nets && nets.rfWaveguide && nets.rfWaveguide.length > 0) {
      const rfNets = nets.rfWaveguide.map(net => Networks.validateRfNetwork(net));
      totalFwdPower = rfNets.reduce((s, n) => s + n.forwardPower, 0);
      totalReflPower = rfNets.reduce((s, n) => s + n.reflectedPower, 0);
    } else {
      // Fallback to old estimation from equipment counts
      const rfPowerPerSource = { klystron: 5000, ssa: 100, iot: 80, magnetron: 2000 };
      totalFwdPower = rfSourceTypes.reduce((s, t) => s + (counts[t] || 0) * (rfPowerPerSource[t] || 0), 0);
      const reflFraction = 0.02;
      totalReflPower = totalFwdPower * reflFraction;
    }

    const avgEfficiency = rfSourceCount > 0 ? 0.55 : 0; // rough average
    const rfWallPower = avgEfficiency > 0 ? totalFwdPower / avgEfficiency : 0;
    const reflFraction = totalFwdPower > 0 ? totalReflPower / totalFwdPower : 0;
    const vswr = reflFraction > 0 ? ((1 + Math.sqrt(reflFraction)) / (1 - Math.sqrt(reflFraction))).toFixed(2) : '1.00';

    const rfPower = {
      totalFwdPower,
      totalReflPower,
      wallPower: rfWallPower,
      vswr,
      sourceCount: rfSourceCount,
      avgEfficiency: avgEfficiency * 100,
      energyDraw: categoryDraw('rfPower'),
      detail: {
        klystrons: counts.klystron || 0,
        ssas: counts.ssa || 0,
        iots: counts.iot || 0,
        magnetrons: counts.magnetron || 0,
        modulators: counts.modulator || 0,
        circulators: counts.circulator || 0,
        waveguides: counts.waveguide || 0,
        llrfControllers: counts.llrfController || 0,
        masterOscillators: counts.masterOscillator || 0,
        vectorModulators: counts.vectorModulator || 0,
      },
    };

    // === CRYO ===
    const compressors = counts.heliumCompressor || 0;
    const coldBox4K = counts.coldBox4K || 0;
    const subCooling2K = counts.subCooling2K || 0;
    const cryoHousings = counts.cryomoduleHousing || 0;
    const ln2Precool = counts.ln2Precooler || 0;
    const heRecovery = counts.heRecovery || 0;
    const cryocoolers = counts.cryocooler || 0;

    let cryoCapacity, totalCryoLoad, opTemp, staticLoad, dynamicLoad;
    if (nets && nets.cryoTransfer && nets.cryoTransfer.length > 0) {
      const cryoNets = nets.cryoTransfer.map(net => Networks.validateCryoNetwork(net));
      cryoCapacity = cryoNets.reduce((s, n) => s + n.capacity, 0);
      totalCryoLoad = cryoNets.reduce((s, n) => s + n.heatLoad, 0);
      // Use best (lowest nonzero) opTemp from networks
      opTemp = 0;
      for (const cn of cryoNets) {
        if (cn.opTemp > 0 && (opTemp === 0 || cn.opTemp < opTemp)) opTemp = cn.opTemp;
      }
      // Decompose load into static/dynamic for detail (estimate from counts)
      const srfCavities = beamline.filter(n => n.type === 'cryomodule').length;
      staticLoad = cryoHousings * 3 + srfCavities * 3;
      dynamicLoad = totalCryoLoad - staticLoad;
      if (dynamicLoad < 0) { staticLoad = totalCryoLoad; dynamicLoad = 0; }
    } else {
      // Fallback to old estimation from equipment counts
      cryoCapacity = coldBox4K * 500 + subCooling2K * 200 + cryocoolers * 50;
      const srfCavities = beamline.filter(n => n.type === 'cryomodule').length;
      staticLoad = cryoHousings * 3 + srfCavities * 3;
      dynamicLoad = srfCavities * 15;
      totalCryoLoad = staticLoad + dynamicLoad;
      opTemp = subCooling2K > 0 ? 2.0 : (coldBox4K > 0 ? 4.5 : 0);
    }

    const carnot = opTemp === 2.0 ? 750 : 250;
    const cryoWallPower = totalCryoLoad * carnot / 1000; // kW
    const cryoMargin = cryoCapacity > 0 ? ((cryoCapacity - totalCryoLoad) / cryoCapacity * 100) : 0;

    const cryo = {
      coolingCapacity: cryoCapacity,
      heatLoad: totalCryoLoad,
      opTemp,
      wallPower: cryoWallPower,
      margin: Math.max(cryoMargin, 0),
      energyDraw: categoryDraw('cooling', 'cryogenics'),
      detail: {
        compressors,
        coldBox4K,
        subCooling2K,
        cryoHousings,
        ln2Precoolers: ln2Precool,
        heRecovery,
        cryocoolers,
        staticLoad,
        dynamicLoad,
      },
    };

    // === COOLING ===
    const lcwSkids = counts.lcwSkid || 0;
    const chillers = counts.chiller || 0;
    const towers = counts.coolingTower || 0;
    const exchangers = counts.heatExchanger || 0;
    const waterLoads = counts.waterLoad || 0;
    const deionizers = counts.deionizer || 0;
    const emergCooling = counts.emergencyCooling || 0;

    let coolingCap, coolingLoad;
    if (nets && nets.coolingWater && nets.coolingWater.length > 0) {
      const coolNets = nets.coolingWater.map(net => Networks.validateCoolingNetwork(net));
      coolingCap = coolNets.reduce((s, n) => s + n.capacity, 0);
      coolingLoad = coolNets.reduce((s, n) => s + n.heatLoad, 0);
    } else {
      // Fallback to old estimation from equipment counts
      coolingCap = lcwSkids * 100 + chillers * 200 + towers * 500;
      coolingLoad = (this.state.totalEnergyCost || 0) * 0.6; // ~60% of electrical becomes heat
    }

    const flowRate = coolingCap > 0 ? coolingCap / (4.18 * 10) * 60 : 0; // L/min assuming 10C delta-T
    const coolingMargin = coolingCap > 0 ? ((coolingCap - coolingLoad) / coolingCap * 100) : 0;

    const cooling = {
      coolingCapacity: coolingCap,
      heatLoad: coolingLoad,
      flowRate,
      energyDraw: categoryDraw('cooling'),
      margin: Math.max(coolingMargin, 0),
      detail: {
        lcwSkids,
        chillers,
        coolingTowers: towers,
        heatExchangers: exchangers,
        waterLoads,
        deionizers,
        emergencyCooling: emergCooling,
      },
    };

    // === POWER ===
    const substations = counts.substation || 0;
    const panels = counts.powerPanel || 0;
    const laserSystems = counts.laserSystem || 0;

    let powerCapacity, totalDraw;
    if (nets && nets.powerCable && nets.powerCable.length > 0) {
      const pwrNets = nets.powerCable.map(net => Networks.validatePowerNetwork(net));
      powerCapacity = pwrNets.reduce((s, n) => s + n.capacity, 0);
      totalDraw = pwrNets.reduce((s, n) => s + n.draw, 0);
    } else {
      // Fallback to old estimation
      powerCapacity = this.state.maxElectricalPower || 500;
      totalDraw = (this.state.totalEnergyCost || 0) + vacuum.energyDraw + rfPower.energyDraw + cryo.energyDraw + cooling.energyDraw;
    }

    const powerUtil = powerCapacity > 0 ? (totalDraw / powerCapacity * 100) : 0;

    const power = {
      capacity: powerCapacity,
      totalDraw,
      utilization: Math.min(powerUtil, 100),
      substations,
      panels,
      laserSystems,
      detail: {
        vacuumDraw: vacuum.energyDraw,
        rfDraw: rfPower.energyDraw,
        cryoDraw: cryo.energyDraw,
        coolingDraw: cooling.energyDraw,
        beamlineDraw: this.state.totalEnergyCost || 0,
      },
    };

    // === DATA & CONTROLS ===
    const iocs = counts.rackIoc || 0;
    const interlocks = counts.ppsInterlock || 0;
    const monitors = counts.areaMonitor || 0;
    const timingSystems = counts.timingSystem || 0;
    const mpsCount = counts.mps || 0;

    const dataControls = {
      iocs,
      interlocks,
      monitors,
      timingSystems,
      mpsStatus: mpsCount > 0 ? 'Active' : 'None',
      energyDraw: categoryDraw('dataControls'),
      detail: {
        rackIocs: iocs,
        ppsInterlocks: interlocks,
        radiationMonitors: monitors,
        timingSystems,
        mps: mpsCount,
        laserSystems,
      },
    };

    // === OPS ===
    const shieldingCount = counts.shielding || 0;
    const targetHandlingCount = counts.targetHandling || 0;
    const beamDumpCount = counts.beamDump || 0;
    const radWasteCount = counts.radWasteStorage || 0;

    const ops = {
      shielding: shieldingCount,
      targetHandling: targetHandlingCount,
      beamDumps: beamDumpCount,
      radWasteStorage: radWasteCount,
      energyDraw: categoryDraw('ops'),
      detail: {
        shielding: shieldingCount,
        targetHandling: targetHandlingCount,
        beamDumps: beamDumpCount,
        radWasteStorage: radWasteCount,
      },
    };

    this.state.systemStats = { vacuum, rfPower, cryo, cooling, power, dataControls, ops };
  }

  validateInfrastructure() {
    if (typeof Networks === 'undefined') return;

    const validationState = {
      connections: this.state.connections,
      facilityEquipment: this.state.facilityEquipment,
      facilityGrid: this.state.facilityGrid,
      beamline: this.state.beamline,
    };

    const result = Networks.validate(validationState);
    this.state.infraBlockers = result.blockers;
    this.state.infraCanRun = result.canRun;
    this.state.networkData = result.networks;

    // If beam is running and we now have blockers, shut it off
    if (this.state.beamOn && !result.canRun) {
      this.state.beamOn = false;
      this.state.continuousBeamTicks = 0;
      const reason = result.blockers[0]?.reason || 'Infrastructure failure';
      this.log(`Beam TRIPPED: ${reason}`, 'bad');
      this.emit('beamToggled');
    }

    this.emit('infrastructureValidated');
  }

  // === WEAR & REPAIR ===

  _applyWear() {
    for (const node of this.state.beamline) {
      const t = COMPONENTS[node.type];
      if (!t) continue;
      // Initialize health if needed
      if (this.state.componentHealth[node.id] === undefined) {
        this.state.componentHealth[node.id] = 100;
      }
      // Base wear rate: higher energy cost = more stress
      const baseWear = 0.01 + (t.energyCost || 0) * 0.002;
      const hasMPS = (this.state.facilityEquipment || []).some(eq => eq.type === 'mps');
      const wearMult = hasMPS ? 1 : 2;
      this.state.componentHealth[node.id] = Math.max(0, this.state.componentHealth[node.id] - baseWear * wearMult);

      // Random failure check below 20% health
      if (this.state.componentHealth[node.id] < 20 && Math.random() < 0.05) {
        this.state.componentHealth[node.id] = 0;
        this.log(`${t.name} FAILED! Repair needed.`, 'bad');
      }
    }
  }

  _autoRepair() {
    const repairRate = this.state.staff.technicians * 2; // health points per cycle
    let remaining = repairRate;
    for (const node of this.state.beamline) {
      if (remaining <= 0) break;
      const health = this.state.componentHealth[node.id];
      if (health !== undefined && health < 100) {
        const repair = Math.min(remaining, 100 - health);
        this.state.componentHealth[node.id] += repair;
        remaining -= repair;
      }
    }
  }

  getComponentHealth(id) {
    return this.state.componentHealth[id] !== undefined ? this.state.componentHealth[id] : 100;
  }

  // === STAFFING ===

  hireStaff(type) {
    if (!this.state.staff[type] && this.state.staff[type] !== 0) return false;
    const hireCost = this.state.staffCosts[type] * 10; // 10 ticks upfront
    if (this.state.resources.funding < hireCost) {
      this.log(`Can't afford to hire (need $${hireCost})`, 'bad');
      return false;
    }
    this.state.resources.funding -= hireCost;
    this.state.staff[type]++;
    this.log(`Hired ${type.slice(0, -1)}`, 'good');
    this.emit('staffChanged');
    return true;
  }

  fireStaff(type) {
    if (!this.state.staff[type] || this.state.staff[type] <= 0) return false;
    if (type === 'operators' && this.state.staff.operators <= 1) {
      this.log('Need at least 1 operator!', 'bad');
      return false;
    }
    this.state.staff[type]--;
    this.log(`Released ${type.slice(0, -1)}`, 'info');
    this.emit('staffChanged');
    return true;
  }

  // === MACHINES (cyclotrons, stalls, rings) ===

  canPlaceMachine(machineId, col, row) {
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machineId] : null;
    if (!def) return false;
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const key = (col + dx) + ',' + (row + dy);
        if (this.state.machineGrid[key]) return false;
        if (this.beamline.occupied?.[key] !== undefined) return false;
      }
    }
    return true;
  }

  isMachineUnlocked(def) {
    if (!def.requires) return true;
    return this.state.completedResearch.includes(def.requires);
  }

  placeMachine(machineId, col, row) {
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machineId] : null;
    if (!def) return false;
    if (!this.isMachineUnlocked(def)) return false;
    if (!this.canAfford(def.cost)) { this.log(`Can't afford ${def.name}!`, 'bad'); return false; }
    if (!this.canPlaceMachine(machineId, col, row)) { this.log("Can't place there!", 'bad'); return false; }

    this.spend(def.cost);
    const upgrades = {};
    for (const key of Object.keys(def.upgrades || {})) upgrades[key] = 0;

    const inst = {
      type: machineId,
      id: `${machineId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      col, row, upgrades,
      operatingMode: def.operatingModes ? def.operatingModes[0] : null,
      health: 100, active: true, injectorQuality: null,
    };
    this.state.machines.push(inst);

    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++)
        this.state.machineGrid[(col + dx) + ',' + (row + dy)] = inst.id;

    this.checkInjectorLinks();
    this.log(`Built ${def.name}`, 'good');
    this.emit('machineChanged');
    return true;
  }

  removeMachine(instanceId) {
    const idx = this.state.machines.findIndex(m => m.id === instanceId);
    if (idx === -1) return false;
    const machine = this.state.machines[idx];
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;

    if (def) {
      for (const [r, a] of Object.entries(def.cost))
        this.state.resources[r] += Math.floor(a * 0.5);
      for (let dy = 0; dy < def.h; dy++)
        for (let dx = 0; dx < def.w; dx++)
          delete this.state.machineGrid[(machine.col + dx) + ',' + (machine.row + dy)];
    }

    this.state.machines.splice(idx, 1);
    this.log(`Demolished ${def ? def.name : 'machine'} (50% refund)`, 'info');
    this.emit('machineChanged');
    return true;
  }

  getMachineAt(col, row) {
    const id = this.state.machineGrid[col + ',' + row];
    return id ? (this.state.machines.find(m => m.id === id) || null) : null;
  }

  upgradeMachine(instanceId, subsystem) {
    const machine = this.state.machines.find(m => m.id === instanceId);
    if (!machine) return false;
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;
    if (!def) return false;
    const upgDef = def.upgrades?.[subsystem];
    if (!upgDef) return false;

    const nextLevel = (machine.upgrades[subsystem] || 0) + 1;
    if (nextLevel >= upgDef.levels.length) { this.log('Already max level!', 'bad'); return false; }

    const levelDef = upgDef.levels[nextLevel];
    if (!levelDef.cost || !this.canAfford(levelDef.cost)) {
      this.log(`Can't afford ${upgDef.name} upgrade!`, 'bad');
      return false;
    }

    this.spend(levelDef.cost);
    machine.upgrades[subsystem] = nextLevel;
    this.log(`Upgraded ${def.name}: ${upgDef.name} -> ${levelDef.label}`, 'good');
    this.emit('machineChanged');
    return true;
  }

  setMachineMode(instanceId, mode) {
    const machine = this.state.machines.find(m => m.id === instanceId);
    if (!machine) return false;
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;
    if (!def?.operatingModes?.includes(mode)) return false;
    if (machine.operatingMode === mode) return false;
    machine.operatingMode = mode;
    this.log(`${def.name} mode: ${mode}`, 'info');
    this.emit('machineChanged');
    return true;
  }

  toggleMachine(instanceId) {
    const machine = this.state.machines.find(m => m.id === instanceId);
    if (!machine) return false;
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;
    if (machine.health <= 0) { this.log(`${def?.name || 'Machine'} is broken!`, 'bad'); return false; }
    machine.active = !machine.active;
    this.log(`${def?.name || 'Machine'} ${machine.active ? 'ON' : 'OFF'}`, machine.active ? 'good' : 'info');
    this.emit('machineChanged');
    return true;
  }

  getMachinePerformance(machine) {
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;
    if (!def) return { fundingMult: 0, dataMult: 0, energyMult: 1 };

    let fundingMult = 1, dataMult = 1, energyMult = 1;

    // Upgrade multipliers
    for (const [sub, lvl] of Object.entries(machine.upgrades)) {
      const level = def.upgrades?.[sub]?.levels?.[lvl];
      if (!level) continue;
      fundingMult *= level.fundingMult;
      dataMult *= level.dataMult;
      energyMult *= level.energyMult;
    }

    // Operating mode
    if (machine.operatingMode && def.modeMultipliers?.[machine.operatingMode]) {
      const m = def.modeMultipliers[machine.operatingMode];
      fundingMult *= m.fundingMult;
      dataMult *= m.dataMult;
    }

    // Injector bonus
    if (def.canLink) {
      if (machine.injectorQuality != null) {
        const bonus = 0.5 + 0.5 * machine.injectorQuality;
        fundingMult *= bonus; dataMult *= bonus;
      } else {
        fundingMult *= 0.5; dataMult *= 0.5;
      }
    }

    // Health penalty below 50%
    if (machine.health < 50) {
      const hf = machine.health / 50;
      fundingMult *= hf; dataMult *= hf;
    }

    return { fundingMult, dataMult, energyMult };
  }

  checkInjectorLinks() {
    for (const machine of this.state.machines) {
      const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;
      if (!def?.canLink) continue;
      machine.injectorQuality = null;

      for (let dx = -1; dx <= def.w && machine.injectorQuality == null; dx++) {
        for (let dy = -1; dy <= def.h && machine.injectorQuality == null; dy++) {
          if (dx >= 0 && dx < def.w && dy >= 0 && dy < def.h) continue;
          if (this.beamline.occupied?.[(machine.col + dx) + ',' + (machine.row + dy)] !== undefined) {
            machine.injectorQuality = this.state.beamQuality || 0;
          }
        }
      }
    }
  }

  _tickMachines() {
    for (const machine of this.state.machines) {
      if (!machine.active) continue;
      const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;
      if (!def) continue;
      const perf = this.getMachinePerformance(machine);

      // Machine energy costs accounted for by infrastructure power networks

      this.state.resources.funding += def.baseFunding * perf.fundingMult;
      const dataGain = def.baseData * perf.dataMult;
      this.state.resources.data += dataGain;
      this.state.totalDataCollected += dataGain;

      if (def.reputationPerTick && machine.operatingMode === 'userOps') {
        this.state.resources.reputation += def.reputationPerTick;
      }

      if (this.state.tick % 10 === 0) {
        const wearRate = 0.01 + (def.energyCost || 0) * 0.001;
        machine.health = Math.max(0, machine.health - wearRate);
        if (machine.health < 20 && Math.random() < 0.05) {
          machine.health = 0; machine.active = false;
          this.log(`${def.name} BROKE DOWN!`, 'bad');
          this.emit('machineChanged');
        }
      }
    }
  }

  repairMachine(instanceId) {
    const machine = this.state.machines.find(m => m.id === instanceId);
    if (!machine || machine.health >= 100) return false;
    const def = typeof MACHINES !== 'undefined' ? MACHINES[machine.type] : null;
    if (!def) return false;
    const repairCost = Math.ceil(def.cost.funding * 0.3 * (100 - machine.health) / 100);
    if (!this.canAfford({ funding: repairCost })) { this.log(`Need $${repairCost} to repair`, 'bad'); return false; }
    this.spend({ funding: repairCost });
    machine.health = 100;
    this.log(`Repaired ${def.name} ($${repairCost})`, 'good');
    this.emit('machineChanged');
    return true;
  }

  // === SAVE / LOAD ===

  save() {
    // Convert connections Map to serializable format
    const connObj = {};
    for (const [key, set] of this.state.connections) {
      connObj[key] = Array.from(set);
    }
    const saveState = { ...this.state, connections: connObj };
    localStorage.setItem('beamlineTycoon', JSON.stringify({
      version: 5,
      state: saveState,
      beamline: this.beamline.toJSON(),
    }));
  }

  load() {
    const raw = localStorage.getItem('beamlineTycoon');
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data.version || data.version < 4) {
        localStorage.removeItem('beamlineTycoon');
        return false;
      }
      Object.assign(this.state, data.state);
      // Rebuild infraOccupied
      this.state.infraOccupied = {};
      if (this.state.infrastructure) {
        for (const tile of this.state.infrastructure)
          this.state.infraOccupied[tile.col + ',' + tile.row] = tile.type;
      } else { this.state.infrastructure = []; }
      // Rebuild zoneOccupied
      this.state.zones = this.state.zones || [];
      this.state.zoneOccupied = {};
      for (const z of this.state.zones) {
        this.state.zoneOccupied[z.col + ',' + z.row] = z.type;
      }
      // Migrate renamed zones from older saves
      const zoneMigrations = { cryoLab: 'coolingLab' };
      for (const z of this.state.zones) {
        if (zoneMigrations[z.type]) z.type = zoneMigrations[z.type];
      }
      for (const [key, val] of Object.entries(this.state.zoneOccupied)) {
        if (zoneMigrations[val]) this.state.zoneOccupied[key] = zoneMigrations[val];
      }
      // Migrate renamed facility categories
      if (this.state.facilityEquipment) {
        for (const eq of this.state.facilityEquipment) {
          const comp = COMPONENTS[eq.type];
          if (comp) eq.category = comp.category;
        }
      }
      this.state.zoneConnectivity = {};
      this.recomputeZoneConnectivity();
      // Rebuild machineGrid
      this.state.machineGrid = {};
      if (this.state.machines) {
        for (const m of this.state.machines) {
          const def = typeof MACHINES !== 'undefined' ? MACHINES[m.type] : null;
          if (!def) continue;
          for (let dy = 0; dy < def.h; dy++)
            for (let dx = 0; dx < def.w; dx++)
              this.state.machineGrid[(m.col + dx) + ',' + (m.row + dy)] = m.id;
        }
      } else { this.state.machines = []; }
      // Restore connections Map from serialized format
      if (this.state.connections && !(this.state.connections instanceof Map)) {
        const map = new Map();
        for (const [key, arr] of Object.entries(this.state.connections)) {
          map.set(key, new Set(arr));
        }
        this.state.connections = map;
      } else if (!this.state.connections) {
        this.state.connections = new Map();
      }

      // Ensure facility arrays exist for old saves
      if (!this.state.facilityEquipment) this.state.facilityEquipment = [];
      if (!this.state.facilityGrid) this.state.facilityGrid = {};
      if (!this.state.facilityNextId) this.state.facilityNextId = 1;

      // Ensure zone furnishing arrays exist for old saves
      if (!this.state.zoneFurnishings) this.state.zoneFurnishings = [];
      if (!this.state.zoneFurnishingGrid) this.state.zoneFurnishingGrid = {};
      if (!this.state.zoneFurnishingNextId) this.state.zoneFurnishingNextId = 1;

      // Migrate: remove deprecated energy resource
      delete this.state.resources.energy;
      delete this.state.electricalPower;
      delete this.state.maxElectricalPower;

      // Ensure infra validation state exists
      this.state.infraBlockers = this.state.infraBlockers || [];
      this.state.infraCanRun = this.state.infraCanRun !== undefined ? this.state.infraCanRun : true;
      this.state.networkData = this.state.networkData || null;

      this.beamline.fromJSON(data.beamline);

      // Migrate old saves: initialize params for nodes that don't have them
      if (typeof PARAM_DEFS !== 'undefined') {
        for (const node of this.beamline.nodes) {
          const defs = PARAM_DEFS[node.type];
          if (defs && !node.params) {
            node.params = {};
            for (const [k, def] of Object.entries(defs)) {
              if (!def.derived) node.params[k] = def.default;
            }
          }
        }
      }

      this.recalcBeamline();
      this.validateInfrastructure();
      this.log('Game loaded.', 'info');
      this.emit('loaded');
      return true;
    } catch (e) { console.error('Save load failed:', e); return false; }
  }
}
