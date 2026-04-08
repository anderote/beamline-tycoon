import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE, ZONES, ZONE_TIER_THRESHOLDS, ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { MACHINES } from '../data/machines.js';
import { RESEARCH } from '../data/research.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';
import { BeamPhysics } from '../beamline/physics.js';
import { Networks } from '../networks/networks.js';
import { makeDefaultBeamState } from '../beamline/BeamlineRegistry.js';

import { computeSystemStats } from './economy.js';
import * as research from './research.js';
import { checkObjectives } from './objectives.js';

export class Game {
  constructor(registry) {
    this.registry = registry;
    this.beamline = null;  // kept for renderer compatibility (will be updated in later tasks)

    this.editingBeamlineId = null;
    this.selectedBeamlineId = null;

    this.state = {
      resources: { funding: 3500000, reputation: 0, data: 0 },
      beamline: [],    // aggregate of all beamline nodes (populated by _updateAggregateBeamline)
      completedResearch: [],
      activeResearch: null,
      researchProgress: 0,
      completedObjectives: [],
      discoveries: 0,
      tick: 0,
      log: [],
      // Staffing
      staff: { operators: 1, technicians: 0, scientists: 0, engineers: 0 },
      staffCosts: { operators: 5, technicians: 8, scientists: 10, engineers: 12 }, // $/tick
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

  placeSource(col, row, dir, sourceType = 'source') {
    const template = COMPONENTS[sourceType];
    if (!template) return false;
    if (!template.isSource) return false;
    if (!this.isComponentUnlocked(template)) return false;
    if (!this.canAfford(template.cost)) { this.log(`Can't afford ${template.name}!`, 'bad'); return false; }

    // Check shared tile occupancy
    if (this.registry.isTileOccupied(col, row)) {
      this.log("Can't place there!", 'bad');
      return false;
    }

    // Determine machine type from source type
    let machineType = 'linac';
    if (sourceType === 'dcPhotoGun' || sourceType === 'ncRfGun' || sourceType === 'srfGun') {
      machineType = 'photoinjector';
    }

    // Create new beamline entry
    const entry = this.registry.createBeamline(machineType);

    // Place source on the entry's beamline
    const nodeId = entry.beamline.placeSource(col, row, dir);
    if (nodeId == null) {
      // Failed to place - remove the entry
      this.registry.removeBeamline(entry.id);
      this.log("Can't place there!", 'bad');
      return false;
    }

    // Register tiles in shared grid
    const node = entry.beamline.nodes.find(n => n.id === nodeId);
    if (node) {
      this.registry.occupyTiles(entry.id, node);
    }

    this.spend(template.cost);

    // Auto-enter edit mode for this beamline
    this.editingBeamlineId = entry.id;
    this.selectedBeamlineId = entry.id;

    this.recalcBeamline(entry.id);
    this.log(`Built ${template.name}`, 'good');
    this.emit('beamlineChanged');
    return entry.id;
  }

  placeComponent(cursor, compType, bendDir) {
    const template = COMPONENTS[compType];
    if (!template) return false;
    if (!this.isComponentUnlocked(template)) return false;
    if (!this.canAfford(template.cost)) { this.log(`Can't afford ${template.name}!`, 'bad'); return false; }

    if (!this.editingBeamlineId) {
      this.log('Select a beamline to edit first!', 'bad');
      return false;
    }

    const entry = this.registry.get(this.editingBeamlineId);
    if (!entry) {
      this.log('Beamline not found!', 'bad');
      return false;
    }

    if (template.maxCount) {
      const count = entry.beamline.nodes.filter(n => n.type === compType).length;
      if (count >= template.maxCount) {
        this.log(`Max ${template.name} reached.`, 'bad'); return false;
      }
    }

    const nodeId = entry.beamline.placeAt(cursor, compType, bendDir);
    if (nodeId == null) { this.log("Can't place there!", 'bad'); return false; }

    // Register tiles in shared grid
    const node = entry.beamline.nodes.find(n => n.id === nodeId);
    if (node) {
      this.registry.occupyTiles(entry.id, node);
    }

    this.spend(template.cost);
    this.recalcBeamline(entry.id);
    this.log(`Built ${template.name}`, 'good');
    this.emit('beamlineChanged');
    return true;
  }

  removeComponent(nodeId) {
    const entry = this.registry.getBeamlineForNode(nodeId);
    if (!entry) return false;

    // If editing a different beamline, reject
    if (this.editingBeamlineId && this.editingBeamlineId !== entry.id) {
      this.log('Cannot modify a beamline you are not editing!', 'bad');
      return false;
    }

    const node = entry.beamline.nodes.find(n => n.id === nodeId);
    if (!node) return false;

    const template = COMPONENTS[node.type];

    // Free tiles from shared grid before removal
    this.registry.freeTiles(node);

    const removed = entry.beamline.removeNode(nodeId);
    if (!removed) {
      // Re-occupy tiles since removal failed
      this.registry.occupyTiles(entry.id, node);
      this.log('Can only remove end pieces!', 'bad');
      return false;
    }

    // 50% refund
    if (template) {
      for (const [r, a] of Object.entries(template.cost))
        this.state.resources[r] += Math.floor(a * 0.5);
    }

    // If beamline is now empty, remove it from registry
    if (entry.beamline.nodes.length === 0) {
      this.registry.removeBeamline(entry.id);
      if (this.editingBeamlineId === entry.id) this.editingBeamlineId = null;
      if (this.selectedBeamlineId === entry.id) this.selectedBeamlineId = null;
    }

    this.recalcAllBeamlines();
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

    // Find all hallway tiles adjacent to Control Room -- seed the flood fill
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
    // Check shared beamline tile occupancy
    if (this.registry.isTileOccupied(col, row)) {
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

  recalcBeamline(beamlineId) {
    if (beamlineId) {
      const entry = this.registry.get(beamlineId);
      if (!entry) return;
      this._recalcSingleBeamline(entry);
    } else {
      // Recalc all if no id given (backward compat)
      this.recalcAllBeamlines();
      return;
    }
    this._updateAggregateBeamline();
    this.checkInjectorLinks();
    this.validateInfrastructure();
  }

  recalcAllBeamlines() {
    for (const entry of this.registry.getAll()) {
      this._recalcSingleBeamline(entry);
    }
    this._updateAggregateBeamline();
    this.checkInjectorLinks();
    this.validateInfrastructure();
  }

  _recalcSingleBeamline(entry) {
    const ordered = entry.beamline.getOrderedComponents();

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
    entry.beamState.totalLength = tLen;
    entry.beamState.totalEnergyCost = Math.ceil(tCost);

    if (!hasSrc) {
      entry.beamState.beamEnergy = 0;
      entry.beamState.dataRate = 0;
      entry.beamState.beamQuality = 1;
      entry.beamState.luminosity = 0;
      entry.beamState.physicsEnvelope = null;
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
    researchEffects.machineType = entry.beamState.machineType;

    // Run physics simulation
    this.runPhysicsForBeamline(entry, physicsBeamline, researchEffects);
  }

  _updateAggregateBeamline() {
    this.state.beamline = this.registry.getAllNodes();

    // Aggregate per-beamline stats into state for objectives/economy/renderers
    const entries = this.registry.getAll();
    let totalLength = 0, totalEnergyCost = 0;
    let beamOn = false;
    let maxBeamEnergy = 0, maxBeamQuality = 0, maxLuminosity = 0;
    let totalDataCollected = 0, totalBeamHours = 0;
    let maxContinuousBeamTicks = 0, totalBeamOnTicks = 0;
    let felSaturated = false;
    let avgPressure = undefined;
    let finalNormEmittanceX = undefined;
    let finalBunchLength = undefined;

    for (const entry of entries) {
      const bs = entry.beamState;
      totalLength += bs.totalLength || 0;
      totalEnergyCost += bs.totalEnergyCost || 0;
      totalDataCollected += bs.totalDataCollected || 0;
      totalBeamHours += bs.totalBeamHours || 0;
      totalBeamOnTicks += bs.beamOnTicks || 0;

      if (entry.status === 'running') {
        beamOn = true;
        if (bs.continuousBeamTicks > maxContinuousBeamTicks) maxContinuousBeamTicks = bs.continuousBeamTicks;
      }
      if (bs.beamEnergy > maxBeamEnergy) maxBeamEnergy = bs.beamEnergy;
      if (bs.beamQuality > maxBeamQuality) maxBeamQuality = bs.beamQuality;
      if (bs.luminosity > maxLuminosity) maxLuminosity = bs.luminosity;
      if (bs.felSaturated) felSaturated = true;
    }

    this.state.totalLength = totalLength;
    this.state.totalEnergyCost = totalEnergyCost;
    this.state.beamOn = beamOn;
    this.state.beamEnergy = maxBeamEnergy;
    this.state.beamQuality = maxBeamQuality;
    this.state.luminosity = maxLuminosity;
    this.state.totalDataCollected = totalDataCollected;
    this.state.totalBeamHours = totalBeamHours;
    this.state.continuousBeamTicks = maxContinuousBeamTicks;
    this.state.beamOnTicks = totalBeamOnTicks;
    this.state.felSaturated = felSaturated;
    this.state.uptimeFraction = this.state.tick > 0 ? totalBeamOnTicks / this.state.tick : 1;

    // For single-beamline compat: expose first running beamline's detailed physics
    const running = entries.find(e => e.status === 'running');
    if (running) {
      this.state.avgPressure = running.beamState.avgPressure;
      this.state.finalNormEmittanceX = running.beamState.finalNormEmittanceX;
      this.state.finalBunchLength = running.beamState.finalBunchLength;
    } else if (entries.length > 0) {
      const first = entries[0];
      this.state.avgPressure = first.beamState.avgPressure;
      this.state.finalNormEmittanceX = first.beamState.finalNormEmittanceX;
      this.state.finalBunchLength = first.beamState.finalBunchLength;
    }
  }

  runPhysicsForBeamline(entry, physicsBeamline, researchEffects) {
    if (!BeamPhysics.isReady()) {
      // Physics not loaded yet -- use simple fallback
      this._fallbackStatsForBeamline(entry, physicsBeamline);
      return;
    }

    const result = BeamPhysics.compute(physicsBeamline, researchEffects);
    if (!result) {
      this._fallbackStatsForBeamline(entry, physicsBeamline);
      return;
    }

    // Apply physics results to beamState
    const bs = entry.beamState;
    bs.beamEnergy = result.beamEnergy;
    bs.dataRate = result.dataRate;
    bs.beamQuality = result.beamQuality;
    bs.luminosity = result.luminosity || 0;
    bs.physicsAlive = result.beamAlive;
    bs.beamCurrent = result.beamCurrent;
    bs.totalLossFraction = result.totalLossFraction;
    bs.discoveryChance = result.discoveryChance || 0;
    bs.photonRate = result.photonRate || 0;
    bs.collisionRate = result.collisionRate || 0;
    bs.physicsEnvelope = result.envelope || null;

    // If physics says beam tripped, fault this beamline
    if (entry.status === 'running' && !result.beamAlive) {
      entry.status = 'stopped';
      bs.continuousBeamTicks = 0;
      this.log('Beam TRIPPED -- too much loss! Fix your optics.', 'bad');
      this.emit('beamToggled');
    }
  }

  _fallbackStatsForBeamline(entry, physicsBeamline) {
    // Simple stat-summing fallback while Pyodide loads
    let eGain = 0, dRate = 0, bq = 1;
    for (const el of physicsBeamline) {
      const s = el.stats || {};
      if (s.energyGain) eGain += s.energyGain;
      if (s.dataRate) dRate += s.dataRate;
      if (s.beamQuality) bq += s.beamQuality;
    }
    const bs = entry.beamState;
    bs.beamEnergy = eGain;
    bs.dataRate = dRate * bq;
    bs.beamQuality = bq;
    bs.luminosity = 0;
    bs.physicsAlive = true;
    bs.beamCurrent = 0;
    bs.totalLossFraction = 0;
    bs.discoveryChance = 0;
    bs.photonRate = 0;
    bs.collisionRate = 0;
    bs.physicsEnvelope = null;
  }

  // === MACHINE TYPE SELECTION ===
  // Machine type is now per-beamline, set at source placement.
  // isMachineTypeUnlocked is still useful for UI checks.

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

  toggleBeam(beamlineId) {
    if (!beamlineId) {
      this.log('No beamline specified!', 'bad');
      return;
    }
    const entry = this.registry.get(beamlineId);
    if (!entry) {
      this.log('Beamline not found!', 'bad');
      return;
    }

    if (entry.status === 'running') {
      entry.status = 'stopped';
      entry.beamState.continuousBeamTicks = 0;
      this.log('Beam OFF', 'info');
    } else {
      if (!entry.beamline.nodes.some(n => COMPONENTS[n.type]?.isSource)) {
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
      entry.status = 'running';
      this.log('Beam ON!', 'good');
    }
    this.emit('beamToggled');
  }

  // === RESEARCH (delegates to research module) ===

  isResearchAvailable(id) {
    return research.isResearchAvailable(id, this.state);
  }

  startResearch(id) {
    const result = research.startResearch(id, this.state, (msg, type) => this.log(msg, type));
    if (result) this.emit('researchChanged');
    return result;
  }

  getEffect(key, def) {
    return research.getEffect(key, def, this.state.completedResearch);
  }

  getLabResearchTier(labType) {
    return research.getLabResearchTier(labType, this.state);
  }

  getResearchSpeedMultiplier(id) {
    return research.getResearchSpeedMultiplier(id, this.state);
  }

  // === SYSTEM STATS (delegates to economy module) ===

  computeSystemStats() {
    const result = computeSystemStats(this.state);
    this.state.systemStats = result;
    this.state.avgPressure = result.avgPressure;
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

    // Tick all running beamlines
    for (const entry of this.registry.getAll()) {
      if (entry.status === 'running') {
        this._tickBeamline(entry);
      } else {
        entry.beamState.continuousBeamTicks = 0;
      }

      // Uptime tracking per beamline
      if (this.state.tick > 0) {
        entry.beamState.uptimeFraction = entry.beamState.beamOnTicks / this.state.tick;
      }
    }

    // Update aggregate state for objectives/economy/renderers
    this._updateAggregateBeamline();

    // Technician auto-repair (across all beamlines)
    if (this.state.staff.technicians > 0 && this.state.tick % 5 === 0) {
      this._autoRepair();
    }

    // Research progress (delegates to research module)
    const researchCompleted = research.tickResearch(
      this.state,
      (msg, type) => this.log(msg, type),
      (id) => this.getResearchSpeedMultiplier(id),
      () => this.recalcAllBeamlines()
    );
    if (researchCompleted) {
      this.emit('researchChanged');
    }

    // Budget crisis check
    if (this.state.resources.funding < -1000) {
      if (this.state.tick % 30 === 0) {
        this.log('BUDGET CRISIS! Operating at a loss.', 'bad');
      }
    }

    // Objectives (delegates to objectives module)
    const completedObjs = checkObjectives(this.state, (msg, type) => this.log(msg, type));
    for (const obj of completedObjs) {
      this.emit('objectiveCompleted', obj);
    }

    // Tick machines (cyclotrons, stalls, rings)
    this._tickMachines();

    // Recompute system-level infrastructure stats
    this.computeSystemStats();

    // Auto-save every 30 ticks
    if (this.state.tick % 30 === 0) this.save();

    this.emit('tick');
  }

  _tickBeamline(entry) {
    const bs = entry.beamState;

    if (!this.state.infraCanRun) return;

    bs.continuousBeamTicks++;
    bs.beamOnTicks++;

    // Data from detectors (physics-driven)
    if (bs.dataRate > 0) {
      // Only count data from endpoints with data/fiber connections to IOCs AND control room
      let connectedDataRate = bs.dataRate;
      if (this.state.networkData) {
        const dataConnected = new Set();
        for (const net of (this.state.networkData.dataFiber || [])) {
          const hasIoc = net.equipment.some(eq => eq.type === 'rackIoc');
          const reachesControlRoom = Networks.touchesControlRoom(this.state, net);
          if (hasIoc && reachesControlRoom) {
            for (const node of net.beamlineNodes) dataConnected.add(node.id);
          }
        }
        // Get this beamline's nodes
        const blNodes = entry.beamline.getAllNodes();
        let totalDiagRate = 0, connDiagRate = 0;
        for (const node of blNodes) {
          const comp = COMPONENTS[node.type];
          if (comp && (comp.stats?.dataRate || 0) > 0) {
            totalDiagRate += comp.stats.dataRate;
            if (dataConnected.has(node.id)) connDiagRate += comp.stats.dataRate;
          }
        }
        if (totalDiagRate > 0) {
          connectedDataRate = bs.dataRate * (connDiagRate / totalDiagRate);
        }
        // Warn once if endpoints exist but aren't wired to control room
        if (totalDiagRate > 0 && connDiagRate === 0 && !this._warnedNoControlRoom) {
          this.log('Endpoints not wired to control room -- no data collected!', 'bad');
          this._warnedNoControlRoom = true;
        } else if (connDiagRate > 0) {
          this._warnedNoControlRoom = false;
        }
      }
      const sciMult = 1 + this.state.staff.scientists * 0.1;
      const dataGain = connectedDataRate * sciMult;
      this.state.resources.data += dataGain;
      bs.totalDataCollected += dataGain;
    }

    // Photon data from undulators (bonus data, scaled down)
    if (bs.photonRate > 0) {
      const photonData = bs.photonRate * 0.1 * bs.beamQuality;
      this.state.resources.data += photonData;
      bs.totalDataCollected += photonData;
    }

    // User beam hours from photon ports
    const blNodes = entry.beamline.getAllNodes();
    const photonPorts = blNodes.filter(c => c.type === 'photonPort');
    if (photonPorts.length > 0 && bs.beamQuality > 0.5) {
      const beamHoursThisTick = photonPorts.length * (1 / 3600); // 1 second = 1/3600 hour
      bs.totalBeamHours += beamHoursThisTick;
      // User fees revenue
      const userFees = photonPorts.length * 2 * bs.beamQuality;
      this.state.resources.funding += userFees;
      this.state.resources.reputation += photonPorts.length * 0.001;
    }

    // Discovery chance (physics-driven)
    const dc = bs.discoveryChance || 0;
    if (dc > 0 && Math.random() < dc) {
      this.state.discoveries++;
      this.log('*** PARTICLE DISCOVERY! ***', 'reward');
      this.state.resources.reputation += 10;
      this.state.resources.funding += 5000;
    }

    // Beam quality affects reputation gain passively (scaled, not binary)
    if (this.state.tick % 60 === 0 && bs.beamQuality > 0.3) {
      this.state.resources.reputation += bs.beamQuality * 0.6;
    }

    // Component wear (every 10 ticks)
    if (this.state.tick % 10 === 0) {
      this._applyWearForBeamline(entry);
    }
  }

  // === INFRASTRUCTURE VALIDATION ===

  validateInfrastructure() {
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

    // Per-beamline fault attribution: if a blocker references a node, fault that beamline
    for (const blocker of result.blockers) {
      if (blocker.nodeId) {
        const blEntry = this.registry.getBeamlineForNode(blocker.nodeId);
        if (blEntry && blEntry.status === 'running') {
          blEntry.status = 'stopped';
          blEntry.beamState.continuousBeamTicks = 0;
          const reason = blocker.reason || 'Infrastructure failure';
          this.log(`Beam TRIPPED: ${reason}`, 'bad');
          this.emit('beamToggled');
        }
      }
    }

    // If global canRun is false, stop all running beamlines
    if (!result.canRun) {
      for (const entry of this.registry.getAll()) {
        if (entry.status === 'running') {
          entry.status = 'stopped';
          entry.beamState.continuousBeamTicks = 0;
        }
      }
      if (this.registry.getAll().some(e => e.status === 'stopped')) {
        this.emit('beamToggled');
      }
    }

    this.emit('infrastructureValidated');
  }

  // === WEAR & REPAIR ===

  _applyWearForBeamline(entry) {
    const blNodes = entry.beamline.getAllNodes();
    for (const node of blNodes) {
      const t = COMPONENTS[node.type];
      if (!t) continue;
      // Initialize health if needed
      if (entry.beamState.componentHealth[node.id] === undefined) {
        entry.beamState.componentHealth[node.id] = 100;
      }
      // Base wear rate: higher energy cost = more stress
      const baseWear = 0.01 + (t.energyCost || 0) * 0.002;
      const hasMPS = (this.state.facilityEquipment || []).some(eq => eq.type === 'mps');
      const wearMult = hasMPS ? 1 : 2;
      entry.beamState.componentHealth[node.id] = Math.max(0, entry.beamState.componentHealth[node.id] - baseWear * wearMult);

      // Random failure check below 20% health
      if (entry.beamState.componentHealth[node.id] < 20 && Math.random() < 0.05) {
        entry.beamState.componentHealth[node.id] = 0;
        this.log(`${t.name} FAILED! Repair needed.`, 'bad');
      }
    }
  }

  _autoRepair() {
    const repairRate = this.state.staff.technicians * 2; // health points per cycle
    let remaining = repairRate;
    // Iterate all beamlines' nodes
    for (const entry of this.registry.getAll()) {
      for (const node of entry.beamline.getAllNodes()) {
        if (remaining <= 0) return;
        const health = entry.beamState.componentHealth[node.id];
        if (health !== undefined && health < 100) {
          const repair = Math.min(remaining, 100 - health);
          entry.beamState.componentHealth[node.id] += repair;
          remaining -= repair;
        }
      }
    }
  }

  getComponentHealth(id) {
    // Search all beamlines for this component's health
    for (const entry of this.registry.getAll()) {
      if (entry.beamState.componentHealth[id] !== undefined) {
        return entry.beamState.componentHealth[id];
      }
    }
    return 100;
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
    const def = MACHINES[machineId];
    if (!def) return false;
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const key = (col + dx) + ',' + (row + dy);
        if (this.state.machineGrid[key]) return false;
        if (this.registry.isTileOccupied(col + dx, row + dy)) return false;
      }
    }
    return true;
  }

  isMachineUnlocked(def) {
    if (!def.requires) return true;
    return this.state.completedResearch.includes(def.requires);
  }

  placeMachine(machineId, col, row) {
    const def = MACHINES[machineId];
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
    const def = MACHINES[machine.type];

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
    const def = MACHINES[machine.type];
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
    const def = MACHINES[machine.type];
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
    const def = MACHINES[machine.type];
    if (machine.health <= 0) { this.log(`${def?.name || 'Machine'} is broken!`, 'bad'); return false; }
    machine.active = !machine.active;
    this.log(`${def?.name || 'Machine'} ${machine.active ? 'ON' : 'OFF'}`, machine.active ? 'good' : 'info');
    this.emit('machineChanged');
    return true;
  }

  getMachinePerformance(machine) {
    const def = MACHINES[machine.type];
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
      const def = MACHINES[machine.type];
      if (!def?.canLink) continue;
      machine.injectorQuality = null;

      for (let dx = -1; dx <= def.w && machine.injectorQuality == null; dx++) {
        for (let dy = -1; dy <= def.h && machine.injectorQuality == null; dy++) {
          if (dx >= 0 && dx < def.w && dy >= 0 && dy < def.h) continue;
          const tileKey = (machine.col + dx) + ',' + (machine.row + dy);
          // Check shared occupied grid
          const blId = this.registry.sharedOccupied[tileKey];
          if (blId !== undefined) {
            // Look up beam quality from the beamline entry
            const blEntry = this.registry.get(blId);
            machine.injectorQuality = blEntry ? (blEntry.beamState.beamQuality || 0) : 0;
          }
        }
      }
    }
  }

  _tickMachines() {
    for (const machine of this.state.machines) {
      if (!machine.active) continue;
      const def = MACHINES[machine.type];
      if (!def) continue;
      const perf = this.getMachinePerformance(machine);

      // Machine energy costs accounted for by infrastructure power networks

      this.state.resources.funding += def.baseFunding * perf.fundingMult;
      const dataGain = def.baseData * perf.dataMult;
      this.state.resources.data += dataGain;
      this.state.totalDataCollected = (this.state.totalDataCollected || 0) + dataGain;

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
    const def = MACHINES[machine.type];
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
      version: 6,
      state: saveState,
      beamlines: this.registry.toJSON(),
    }));
  }

  load() {
    const raw = localStorage.getItem('beamlineTycoon');
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data.version || data.version < 5) {
        localStorage.removeItem('beamlineTycoon');
        return false;
      }

      // Migrate v5 save data to v6 format
      if (data.version === 5) {
        this._migrateV5(data);
        return true;
      }

      Object.assign(this.state, data.state);

      // Restore registry from saved beamlines data
      if (data.beamlines) {
        this.registry.fromJSON(data.beamlines);
      }

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
      this.state.zoneConnectivity = {};
      this.recomputeZoneConnectivity();
      // Rebuild machineGrid
      this.state.machineGrid = {};
      if (this.state.machines) {
        for (const m of this.state.machines) {
          const def = MACHINES[m.type];
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

      // Ensure facility arrays exist
      if (!this.state.facilityEquipment) this.state.facilityEquipment = [];
      if (!this.state.facilityGrid) this.state.facilityGrid = {};
      if (!this.state.facilityNextId) this.state.facilityNextId = 1;

      // Ensure zone furnishing arrays exist
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

      // Initialize params for nodes across all beamlines
      for (const entry of this.registry.getAll()) {
        for (const node of entry.beamline.nodes) {
          const defs = PARAM_DEFS[node.type];
          if (defs && !node.params) {
            node.params = {};
            for (const [k, def] of Object.entries(defs)) {
              if (!def.derived) node.params[k] = def.default;
            }
          }
        }
      }

      this.recalcAllBeamlines();
      this.validateInfrastructure();
      this.log('Game loaded.', 'info');
      this.emit('loaded');
      return true;
    } catch (e) { console.error('Save load failed:', e); return false; }
  }

  _migrateV5(data) {
    // Migrate a v5 save: single beamline stored at data.beamline, beam fields on data.state
    Object.assign(this.state, data.state);

    // Determine machine type from v5 state
    const machineType = data.state.machineType || 'linac';

    // Create a single beamline entry from the v5 data
    const entry = this.registry.createBeamline(machineType);
    if (data.beamline) {
      entry.beamline.fromJSON(data.beamline);
      // Re-register tiles in shared grid
      for (const node of entry.beamline.nodes) {
        this.registry.occupyTiles(entry.id, node);
      }
    }

    // Move per-beamline fields from state to beamState
    const beamFields = [
      'beamEnergy', 'beamCurrent', 'beamQuality', 'dataRate', 'luminosity',
      'totalLength', 'totalEnergyCost', 'beamOnTicks', 'continuousBeamTicks',
      'uptimeFraction', 'totalBeamHours', 'totalDataCollected', 'physicsAlive',
      'physicsEnvelope', 'discoveryChance', 'photonRate', 'collisionRate',
      'totalLossFraction', 'componentHealth', 'felSaturated',
    ];
    for (const field of beamFields) {
      if (data.state[field] !== undefined) {
        entry.beamState[field] = data.state[field];
      }
      delete this.state[field];
    }
    entry.beamState.machineType = machineType;

    // Transfer beam on state to entry status
    if (data.state.beamOn) {
      entry.status = 'running';
    }
    delete this.state.beamOn;
    delete this.state.machineType;

    // If entry has nodes, select it for editing
    if (entry.beamline.nodes.length > 0) {
      this.editingBeamlineId = entry.id;
      this.selectedBeamlineId = entry.id;
    } else {
      // Remove empty beamline
      this.registry.removeBeamline(entry.id);
    }

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
    this.state.zoneConnectivity = {};
    this.recomputeZoneConnectivity();
    // Rebuild machineGrid
    this.state.machineGrid = {};
    if (this.state.machines) {
      for (const m of this.state.machines) {
        const def = MACHINES[m.type];
        if (!def) continue;
        for (let dy = 0; dy < def.h; dy++)
          for (let dx = 0; dx < def.w; dx++)
            this.state.machineGrid[(m.col + dx) + ',' + (m.row + dy)] = m.id;
      }
    } else { this.state.machines = []; }
    // Restore connections Map
    if (this.state.connections && !(this.state.connections instanceof Map)) {
      const map = new Map();
      for (const [key, arr] of Object.entries(this.state.connections)) {
        map.set(key, new Set(arr));
      }
      this.state.connections = map;
    } else if (!this.state.connections) {
      this.state.connections = new Map();
    }

    // Ensure facility arrays exist
    if (!this.state.facilityEquipment) this.state.facilityEquipment = [];
    if (!this.state.facilityGrid) this.state.facilityGrid = {};
    if (!this.state.facilityNextId) this.state.facilityNextId = 1;
    if (!this.state.zoneFurnishings) this.state.zoneFurnishings = [];
    if (!this.state.zoneFurnishingGrid) this.state.zoneFurnishingGrid = {};
    if (!this.state.zoneFurnishingNextId) this.state.zoneFurnishingNextId = 1;

    // Remove deprecated fields
    delete this.state.resources.energy;
    delete this.state.electricalPower;
    delete this.state.maxElectricalPower;

    this.state.infraBlockers = this.state.infraBlockers || [];
    this.state.infraCanRun = this.state.infraCanRun !== undefined ? this.state.infraCanRun : true;
    this.state.networkData = this.state.networkData || null;

    // Initialize params for nodes
    for (const blEntry of this.registry.getAll()) {
      for (const node of blEntry.beamline.nodes) {
        const defs = PARAM_DEFS[node.type];
        if (defs && !node.params) {
          node.params = {};
          for (const [k, pdef] of Object.entries(defs)) {
            if (!pdef.derived) node.params[k] = pdef.default;
          }
        }
      }
    }

    this.recalcAllBeamlines();
    this.validateInfrastructure();
    this.log('Game loaded (migrated from v5).', 'info');
    this.emit('loaded');
  }
}
