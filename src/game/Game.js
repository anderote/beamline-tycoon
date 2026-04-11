import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE, ZONES, ZONE_TIER_THRESHOLDS, ZONE_FURNISHINGS, WALL_TYPES, DOOR_TYPES } from '../data/infrastructure.js';
import { MACHINES } from '../data/machines.js';
import { RESEARCH } from '../data/research.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';
import { BeamPhysics } from '../beamline/physics.js';
import { Networks } from '../networks/networks.js';
import { findLabNetworkBonuses } from '../networks/rooms.js';
import { makeDefaultBeamState } from '../beamline/BeamlineRegistry.js';
import { Beamline } from '../beamline/Beamline.js';
import { flattenPath } from '../beamline/path-flattener.js';

import { DECORATIONS, computeMoraleMultiplier, getReputationTier } from '../data/decorations.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { generateStartingMap } from './map-generator.js';

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
      zoneFurnishings: [],           // [{ id, type, col, row, subCol, subRow, rotated }]
      zoneFurnishingSubgrids: {},    // "col,row" -> [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]
      zoneFurnishingNextId: 1,
      // Unified placement system
      placeables: [],              // [{ id, type, category, col, row, subCol, subRow, rotated, dir, params, cells }]
      placeableIndex: {},           // id -> index in placeables array
      subgridOccupied: {},          // "col,row,subCol,subRow" -> { id, category }
      placeableNextId: 1,
      // Beam pipe connections (drawn between module ports)
      beamPipes: [],                // [{ id, fromId, fromPort, toId, toPort, path: [{col,row}], subL, attachments: [{id, type, position, params}] }]
      beamPipeNextId: 1,
      // Walls (per-tile edge-based, like RCT2 fences)
      walls: [],              // [{ type, col, row, edge }]  edge = 'n'|'e'|'s'|'w'
      wallOccupied: {},       // "col,row,edge" -> wallType
      // Doors (edge-based, like walls)
      doors: [],              // [{ type, col, row, edge }]  edge = 'e' | 's'
      doorOccupied: {},       // "col,row,edge" -> doorType
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
      // Saved beamline designs
      savedDesigns: [],
      savedDesignNextId: 1,
      // Designer session state (persisted for reload)
      designerState: null,
    };

    this.listeners = [];
    this.tickInterval = null;
    this.TICK_MS = 1000;

    // Undo stack (max 3 snapshots)
    this._undoStack = [];
    this._UNDO_MAX = 3;

    // Generate terrain brightness blobs (multimodal 2D gaussian)
    this.state.terrainSeed = Date.now();
    this.state.terrainBlobs = this._generateTerrainBlobs(this.state.terrainSeed);

    // Generate starting map (currently a stub returning an empty decoration
    // set; kept as a hook for future terrain generation).
    generateStartingMap(this.state.terrainSeed);
  }

  _generateTerrainBlobs(seed) {
    // Seeded PRNG (simple LCG)
    let s = seed | 0;
    const rand = () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
    const blobs = [];
    // Large slow-rolling blobs (broad landscape variation)
    const largeCt = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < largeCt; i++) {
      blobs.push({
        cx: (rand() - 0.5) * 80,
        cy: (rand() - 0.5) * 80,
        sx: 10 + rand() * 18,
        sy: 10 + rand() * 18,
        angle: rand() * Math.PI,
        brightness: (rand() * 2 - 1) * 0.8,
      });
    }
    // Medium blobs (patches of lighter/darker grass)
    const medCt = 6 + Math.floor(rand() * 6);
    for (let i = 0; i < medCt; i++) {
      blobs.push({
        cx: (rand() - 0.5) * 60,
        cy: (rand() - 0.5) * 60,
        sx: 3 + rand() * 8,
        sy: 3 + rand() * 8,
        angle: rand() * Math.PI,
        brightness: (rand() * 2 - 1) * 1.2,
      });
    }
    // Small tight blobs (individual spots, puddles of color)
    const smallCt = 8 + Math.floor(rand() * 10);
    for (let i = 0; i < smallCt; i++) {
      blobs.push({
        cx: (rand() - 0.5) * 50,
        cy: (rand() - 0.5) * 50,
        sx: 1.5 + rand() * 4,
        sy: 1.5 + rand() * 4,
        angle: rand() * Math.PI,
        brightness: (rand() * 2 - 1) * 1.5,
      });
    }
    return blobs;
  }

  on(fn) { this.listeners.push(fn); }
  emit(event, data) { this.listeners.forEach(fn => fn(event, data)); }

  log(msg, type = '') {
    this.state.log.unshift({ msg, type, tick: this.state.tick });
    if (this.state.log.length > 100) this.state.log.length = 100;
    this.emit('log', { msg, type });
  }

  // === UNDO ===

  /** Snapshot mutable game state onto the undo stack (max 3). */
  _pushUndo() {
    const snap = {
      resources: { ...this.state.resources },
      infrastructure: this.state.infrastructure.map(t => ({ ...t })),
      infraOccupied: { ...this.state.infraOccupied },
      zones: this.state.zones.map(z => ({ ...z })),
      zoneOccupied: { ...this.state.zoneOccupied },
      walls: this.state.walls.map(w => ({ ...w })),
      wallOccupied: { ...this.state.wallOccupied },
      doors: this.state.doors.map(d => ({ ...d })),
      doorOccupied: { ...this.state.doorOccupied },
      facilityEquipment: this.state.facilityEquipment.map(e => ({ ...e })),
      facilityGrid: { ...this.state.facilityGrid },
      facilityNextId: this.state.facilityNextId,
      zoneFurnishings: this.state.zoneFurnishings.map(f => ({ ...f })),
      zoneFurnishingSubgrids: JSON.parse(JSON.stringify(this.state.zoneFurnishingSubgrids)),
      zoneFurnishingNextId: this.state.zoneFurnishingNextId,
      machines: this.state.machines.map(m => JSON.parse(JSON.stringify(m))),
      machineGrid: { ...this.state.machineGrid },
      connections: new Map([...this.state.connections].map(([k, v]) => [k, new Set(v)])),
      editingBeamlineId: this.editingBeamlineId,
      selectedBeamlineId: this.selectedBeamlineId,
      // Beamline registry snapshot
      registryData: this._snapshotRegistry(),
    };
    this._undoStack.push(snap);
    if (this._undoStack.length > this._UNDO_MAX) {
      this._undoStack.shift();
    }
  }

  _snapshotRegistry() {
    const data = [];
    for (const entry of this.registry.getAll()) {
      data.push({
        id: entry.id,
        name: entry.name,
        status: entry.status,
        beamState: JSON.parse(JSON.stringify(entry.beamState)),
        nodes: entry.beamline.nodes.map(n => ({
          id: n.id, type: n.type, col: n.col, row: n.row,
          dir: n.dir, entryDir: n.entryDir, parentId: n.parentId,
          bendDir: n.bendDir,
          tiles: n.tiles ? n.tiles.map(t => ({ ...t })) : [],
          params: n.params ? { ...n.params } : {},
          computedStats: n.computedStats ? { ...n.computedStats } : null,
        })),
        occupied: { ...entry.beamline.occupied },
        nextId: entry.beamline.nextId,
      });
    }
    return {
      entries: data,
      sharedOccupied: { ...this.registry.sharedOccupied },
      nextBeamlineId: this.registry.nextBeamlineId,
    };
  }

  _restoreRegistryFromSnap(regSnap) {
    this.registry.beamlines.clear();
    this.registry.sharedOccupied = { ...regSnap.sharedOccupied };
    this.registry.nextBeamlineId = regSnap.nextBeamlineId;
    for (const ed of regSnap.entries) {
      const bl = new Beamline();
      bl.nodes = ed.nodes.map(n => ({
        id: n.id, type: n.type, col: n.col, row: n.row,
        dir: n.dir, entryDir: n.entryDir, parentId: n.parentId,
        bendDir: n.bendDir,
        tiles: n.tiles ? n.tiles.map(t => ({ ...t })) : [],
        params: n.params ? { ...n.params } : {},
        computedStats: n.computedStats ? { ...n.computedStats } : null,
      }));
      bl.occupied = { ...ed.occupied };
      bl.nextId = ed.nextId;
      this.registry.beamlines.set(ed.id, {
        id: ed.id,
        name: ed.name,
        status: ed.status,
        beamline: bl,
        beamState: ed.beamState,
      });
    }
  }

  undo() {
    if (this._undoStack.length === 0) {
      this.log('Nothing to undo', 'info');
      return;
    }
    const snap = this._undoStack.pop();

    // Restore state
    this.state.resources = snap.resources;
    this.state.infrastructure = snap.infrastructure;
    this.state.infraOccupied = snap.infraOccupied;
    this.state.zones = snap.zones;
    this.state.zoneOccupied = snap.zoneOccupied;
    this.state.walls = snap.walls;
    this.state.wallOccupied = snap.wallOccupied;
    this.state.doors = snap.doors;
    this.state.doorOccupied = snap.doorOccupied;
    this.state.facilityEquipment = snap.facilityEquipment;
    this.state.facilityGrid = snap.facilityGrid;
    this.state.facilityNextId = snap.facilityNextId;
    this.state.zoneFurnishings = snap.zoneFurnishings;
    this.state.zoneFurnishingSubgrids = snap.zoneFurnishingSubgrids;
    this.state.zoneFurnishingNextId = snap.zoneFurnishingNextId;
    this.state.machines = snap.machines;
    this.state.machineGrid = snap.machineGrid;
    this.state.connections = snap.connections;
    this.editingBeamlineId = snap.editingBeamlineId;
    this.selectedBeamlineId = snap.selectedBeamlineId;

    // Restore registry
    this._restoreRegistryFromSnap(snap.registryData);

    // Rebuild aggregate state
    this._updateAggregateBeamline();
    this.computeSystemStats();
    this.recomputeZoneConnectivity();

    this.log('Undo', 'info');
    this.emit('beamlineChanged');
    this.emit('infrastructureChanged');
    this.emit('zonesChanged');
    this.emit('wallsChanged');
    this.emit('doorsChanged');
    this.emit('decorationsChanged');
    this.emit('facilityChanged');
    this.emit('connectionsChanged');
    this.emit('machineChanged');
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

  placeSource(col, row, dir, sourceType = 'source', paramOverrides = null) {
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
    const nodeId = entry.beamline.placeSource(col, row, dir, sourceType);
    if (nodeId == null) {
      // Failed to place - remove the entry
      this.registry.removeBeamline(entry.id);
      this.log("Can't place there!", 'bad');
      return false;
    }

    // Apply param overrides from palette flyout (e.g. particleType)
    if (paramOverrides) {
      const node = entry.beamline.nodes.find(n => n.id === nodeId);
      if (node) {
        if (!node.params) node.params = {};
        Object.assign(node.params, paramOverrides);
      }
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

  placeComponent(cursor, compType, bendDir, paramOverrides = null) {
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

    // Apply param overrides from palette flyout (e.g. particleType)
    if (paramOverrides) {
      const node = entry.beamline.nodes.find(n => n.id === nodeId);
      if (node) {
        if (!node.params) node.params = {};
        Object.assign(node.params, paramOverrides);
      }
    }

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
      this.log('Cannot remove that component!', 'bad');
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

  /**
   * Move a beamline component to a new tile position (no cost).
   * Keeps the node's direction, params, and parent/child relationships intact.
   * Returns true on success.
   */
  moveComponent(nodeId, newCol, newRow, newDir) {
    const entry = this.registry.getBeamlineForNode(nodeId);
    if (!entry) return false;
    const node = entry.beamline.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    const comp = COMPONENTS[node.type];
    if (!comp) return false;

    // Free old tiles
    entry.beamline._freeTiles(node.tiles);
    this.registry.freeTiles(node);

    // Calculate new tiles (use new direction if provided)
    const dir = newDir != null ? newDir : (node.dir || node.entryDir || 0);
    const newTiles = entry.beamline._calcTiles(newCol, newRow, dir, comp.subL || 4, comp.subW || 2);

    // Check availability in both beamline and shared grid
    for (const t of newTiles) {
      const bKey = t.col + ',' + t.row;
      if (entry.beamline.occupied[bKey] !== undefined) {
        // Conflict — restore old position
        entry.beamline._occupyTiles(node.tiles, node.id);
        this.registry.occupyTiles(entry.id, node);
        this.log("Can't place there!", 'bad');
        return false;
      }
      if (this.registry.isTileOccupied(t.col, t.row)) {
        entry.beamline._occupyTiles(node.tiles, node.id);
        this.registry.occupyTiles(entry.id, node);
        this.log("Can't place there!", 'bad');
        return false;
      }
      // Check facility/machine grid
      if (this.state.facilityGrid[bKey] || this.state.machineGrid[bKey]) {
        entry.beamline._occupyTiles(node.tiles, node.id);
        this.registry.occupyTiles(entry.id, node);
        this.log('Tile occupied!', 'bad');
        return false;
      }
    }

    // Apply new position and direction
    node.col = newCol;
    node.row = newRow;
    if (newDir != null) {
      node.dir = dir;
      if (node.entryDir != null) node.entryDir = dir;
    }
    node.tiles = newTiles;

    // Re-occupy
    entry.beamline._occupyTiles(newTiles, node.id);
    this.registry.occupyTiles(entry.id, node);

    this.recalcAllBeamlines();
    this.log(`Moved ${comp.name}`, 'good');
    this.emit('beamlineChanged');
    return true;
  }

  // === INFRASTRUCTURE ===

  placeInfraTile(col, row, infraType, variant = 0) {
    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return false;
    const key = col + ',' + row;
    const existing = this.state.infraOccupied[key];
    // For orientable tiles of the same type, toggle orientation for free
    if (existing === infraType && infra.orientable) {
      const existingTile = this.state.infrastructure.find(t => t.col === col && t.row === row);
      if (existingTile) {
        existingTile.orientation = existingTile.orientation ? 0 : 1;
        this.emit('infrastructureChanged');
      }
      return true;
    }
    // Same type but different variant — update variant for free
    if (existing === infraType) {
      const existingTile = this.state.infrastructure.find(t => t.col === col && t.row === row);
      if (existingTile && existingTile.variant !== variant) {
        existingTile.variant = variant;
        this.emit('infrastructureChanged');
      }
      return true;
    }
    // Check foundation requirement
    if (infra.requiresFoundation) {
      const existingTile = this.state.infrastructure.find(t => t.col === col && t.row === row);
      const baseType = existingTile?.foundation || existing;
      if (baseType !== infra.requiresFoundation) {
        this.log(`${infra.name} requires ${INFRASTRUCTURE[infra.requiresFoundation]?.name || infra.requiresFoundation}!`, 'bad');
        return false;
      }
    }
    // Auto-remove any decoration (including trees) — include removal cost
    let totalCost = infra.cost;
    const existingDec = this._decorationAtTile(col, row);
    if (existingDec) {
      const def = DECORATIONS[existingDec.type];
      totalCost += def ? (def.removeCost || 0) : 0;
    }
    if (this.state.resources.funding < totalCost) return false;
    if (existingDec) this.removeDecoration(col, row);
    // Track foundation for surface tiles placed on top of a foundation
    let foundation = null;
    if (infra.requiresFoundation && existing) {
      const existingTile = this.state.infrastructure.find(t => t.col === col && t.row === row);
      foundation = existingTile?.foundation || existing;
    }
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

    this.state.resources.funding -= infra.cost;
    const tileEntry = { type: infraType, col, row, variant };
    if (foundation) tileEntry.foundation = foundation;
    this.state.infrastructure.push(tileEntry);
    this.state.infraOccupied[key] = infraType;
    if (infraType === 'hallway') {
      this.recomputeZoneConnectivity();
    }
    this.validateInfrastructure();
    return true;
  }

  /**
   * Cost-only computation for a rectangular infra drag. Returns
   * { newTiles, totalCost, skippedNoFoundation } so the UI can show cost
   * during drag without mutating state. Shares logic with placeInfraRect.
   */
  computeInfraRectCost(startCol, startRow, endCol, endRow, infraType, variant = 0) {
    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return { newTiles: 0, totalCost: 0, skippedNoFoundation: 0 };
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    let totalCost = 0;
    let newTiles = 0;
    let skippedNoFoundation = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const tileKey = c + ',' + r;
        const existing = this.state.infraOccupied[tileKey];
        // Same type + same variant: skip entirely (no cost, no action).
        if (existing === infraType && !infra.orientable) {
          const existingTile = this.state.infrastructure.find(t => t.col === c && t.row === r);
          if (!existingTile || existingTile.variant === variant) continue;
          newTiles++;
          continue;
        }
        if (existing === infraType && infra.orientable) { newTiles++; continue; }
        if (infra.requiresFoundation) {
          const existingTile = this.state.infrastructure.find(t => t.col === c && t.row === r);
          const baseType = existingTile?.foundation || existing;
          if (baseType !== infra.requiresFoundation) { skippedNoFoundation++; continue; }
        }
        newTiles++;
        totalCost += infra.cost;
        const existingDec = this._decorationAtTile(c, r);
        if (existingDec) {
          const def = DECORATIONS[existingDec.type];
          totalCost += def ? (def.removeCost || 0) : 0;
        }
      }
    }
    return { newTiles, totalCost, skippedNoFoundation };
  }

  /**
   * Cost-only computation for a line (hallway) placement. Returns
   * { newTiles, totalCost, skippedNoFoundation }.
   */
  computeInfraLineCost(path, infraType, variant = 0) {
    const infra = INFRASTRUCTURE[infraType];
    if (!infra || !path || path.length === 0) return { newTiles: 0, totalCost: 0, skippedNoFoundation: 0 };
    let totalCost = 0;
    let newTiles = 0;
    let skippedNoFoundation = 0;
    const seen = new Set();
    for (const pt of path) {
      const k = pt.col + ',' + pt.row;
      if (seen.has(k)) continue;
      seen.add(k);
      const existing = this.state.infraOccupied[k];
      if (existing === infraType) {
        const existingTile = this.state.infrastructure.find(t => t.col === pt.col && t.row === pt.row);
        if (!existingTile || existingTile.variant === variant) continue;
        newTiles++;
        continue;
      }
      if (infra.requiresFoundation) {
        const existingTile = this.state.infrastructure.find(t => t.col === pt.col && t.row === pt.row);
        const baseType = existingTile?.foundation || existing;
        if (baseType !== infra.requiresFoundation) { skippedNoFoundation++; continue; }
      }
      newTiles++;
      totalCost += infra.cost;
    }
    return { newTiles, totalCost, skippedNoFoundation };
  }

  placeInfraRect(startCol, startRow, endCol, endRow, infraType, variant = 0) {
    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return false;

    const orientation = infra.orientable
      ? (Math.abs(endCol - startCol) >= Math.abs(endRow - startRow) ? 0 : 1)
      : 0;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    const { newTiles, totalCost, skippedNoFoundation } = this.computeInfraRectCost(
      startCol, startRow, endCol, endRow, infraType, variant,
    );
    if (newTiles === 0) {
      if (skippedNoFoundation > 0) {
        this.log(`${infra.name} requires ${INFRASTRUCTURE[infra.requiresFoundation]?.name || infra.requiresFoundation}!`, 'bad');
      }
      return true;
    }
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
        // Same-type orientable: just update orientation for free
        if (existing === infraType && infra.orientable) {
          const existingTile = this.state.infrastructure.find(t => t.col === c && t.row === r);
          if (existingTile) existingTile.orientation = orientation;
          placed++;
          continue;
        }
        // Same type — update variant for free if it differs, otherwise skip
        if (existing === infraType) {
          const existingTile = this.state.infrastructure.find(t => t.col === c && t.row === r);
          if (existingTile && existingTile.variant !== variant) {
            existingTile.variant = variant;
            placed++;
          }
          continue;
        }
        if (infra.requiresFoundation) {
          const existingTile = this.state.infrastructure.find(t => t.col === c && t.row === r);
          const baseType = existingTile?.foundation || existing;
          if (baseType !== infra.requiresFoundation) continue;
        }
        // Auto-remove any decoration (including trees)
        if (this._decorationAtTile(c, r)) this.removeDecoration(c, r);
        // Track foundation for surface tiles
        let foundation = null;
        if (infra.requiresFoundation && existing) {
          const existingTile = this.state.infrastructure.find(t => t.col === c && t.row === r);
          foundation = existingTile?.foundation || existing;
        }
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
        const tileEntry = { type: infraType, col: c, row: r, variant };
        if (foundation) tileEntry.foundation = foundation;
        if (orientation) tileEntry.orientation = orientation;
        this.state.infrastructure.push(tileEntry);
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

    const tile = this.state.infrastructure[idx];
    const foundation = tile.foundation;
    this.state.infrastructure.splice(idx, 1);
    const wasHallway = this.state.infraOccupied[key] === 'hallway';

    // If the tile had a foundation, revert to the foundation type
    if (foundation) {
      this.state.infrastructure.push({ type: foundation, col, row, variant: tile.variant });
      this.state.infraOccupied[key] = foundation;
    } else {
      delete this.state.infraOccupied[key];
    }

    if (wasHallway) {
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }

    this.emit('infrastructureChanged');
    this.validateInfrastructure();
    return true;
  }

  // === WALLS (PER-TILE EDGE) ===

  placeWall(col, row, edge, wallType) {
    const wt = WALL_TYPES[wallType];
    if (!wt) return false;
    const key = `${col},${row},${edge}`;
    if (this.state.wallOccupied[key] === wallType) return true;
    if (this.state.wallOccupied[key]) {
      // Replace existing wall on this edge
      this.state.walls = this.state.walls.filter(
        w => !(w.col === col && w.row === row && w.edge === edge)
      );
    }
    if (this.state.resources.funding < wt.cost) return false;
    this.state.resources.funding -= wt.cost;
    this.state.walls.push({ type: wallType, col, row, edge });
    this.state.wallOccupied[key] = wallType;
    return true;
  }

  placeWallPath(path, wallType) {
    const wt = WALL_TYPES[wallType];
    if (!wt) return false;
    let placed = 0;
    for (const pt of path) {
      const key = `${pt.col},${pt.row},${pt.edge}`;
      if (this.state.wallOccupied[key] === wallType) continue;
      if (this.state.resources.funding < wt.cost) break;
      if (this.state.wallOccupied[key]) {
        this.state.walls = this.state.walls.filter(
          w => !(w.col === pt.col && w.row === pt.row && w.edge === pt.edge)
        );
      }
      this.state.resources.funding -= wt.cost;
      this.state.walls.push({ type: wallType, col: pt.col, row: pt.row, edge: pt.edge });
      this.state.wallOccupied[key] = wallType;
      placed++;
    }
    if (placed > 0) {
      this.log(`Placed ${placed} ${wt.name} segments ($${placed * wt.cost})`, 'good');
      this.emit('wallsChanged');
    }
    return placed > 0;
  }

  removeWall(col, row, edge) {
    const key = `${col},${row},${edge}`;
    const wallType = this.state.wallOccupied[key];
    if (!wallType) return false;
    const wt = WALL_TYPES[wallType];
    if (wt) this.state.resources.funding += Math.floor(wt.cost * 0.5);
    this.state.walls = this.state.walls.filter(
      w => !(w.col === col && w.row === row && w.edge === edge)
    );
    delete this.state.wallOccupied[key];
    this.emit('wallsChanged');
    return true;
  }

  // === DOORS (EDGE-BASED) ===

  placeDoor(col, row, edge, doorType) {
    const dt = DOOR_TYPES[doorType];
    if (!dt) return false;
    const key = `${col},${row},${edge}`;
    if (this.state.doorOccupied[key] === doorType) return true;
    if (this.state.doorOccupied[key]) {
      this.state.doors = this.state.doors.filter(
        d => !(d.col === col && d.row === row && d.edge === edge)
      );
    }
    if (this.state.resources.funding < dt.cost) return false;
    this.state.resources.funding -= dt.cost;
    this.state.doors.push({ type: doorType, col, row, edge });
    this.state.doorOccupied[key] = doorType;
    return true;
  }

  placeDoorPath(path, doorType) {
    const dt = DOOR_TYPES[doorType];
    if (!dt) return false;
    let placed = 0;
    for (const pt of path) {
      const key = `${pt.col},${pt.row},${pt.edge}`;
      if (this.state.doorOccupied[key] === doorType) continue;
      if (this.state.resources.funding < dt.cost) break;
      if (this.state.doorOccupied[key]) {
        this.state.doors = this.state.doors.filter(
          d => !(d.col === pt.col && d.row === pt.row && d.edge === pt.edge)
        );
      }
      this.state.resources.funding -= dt.cost;
      this.state.doors.push({ type: doorType, col: pt.col, row: pt.row, edge: pt.edge });
      this.state.doorOccupied[key] = doorType;
      placed++;
    }
    if (placed > 0) {
      this.log(`Placed ${placed} ${dt.name} segment${placed > 1 ? 's' : ''} ($${placed * dt.cost})`, 'good');
      this.emit('doorsChanged');
    }
    return placed > 0;
  }

  removeDoor(col, row, edge) {
    const key = `${col},${row},${edge}`;
    const doorType = this.state.doorOccupied[key];
    if (!doorType) return false;
    const dt = DOOR_TYPES[doorType];
    if (dt) this.state.resources.funding += Math.floor(dt.cost * 0.5);
    this.state.doors = this.state.doors.filter(
      d => !(d.col === col && d.row === row && d.edge === edge)
    );
    delete this.state.doorOccupied[key];
    this.emit('doorsChanged');
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
    } else {
      const floorName = INFRASTRUCTURE[zone.requiredFloor]?.name || zone.requiredFloor;
      this.log(`${zone.name} needs ${floorName} underneath`, 'bad');
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
      // Remove ALL furnishings on this tile
      const tileFurnishings = this.state.zoneFurnishings.filter(e => e.col === col && e.row === row);
      for (const f of tileFurnishings) {
        const fDef = ZONE_FURNISHINGS[f.type];
        if (fDef) this.state.resources.funding += Math.floor(fDef.cost * 0.5);
      }
      this.state.zoneFurnishings = this.state.zoneFurnishings.filter(e => !(e.col === col && e.row === row));
      delete this.state.zoneFurnishingSubgrids[key];
      this._syncLegacyPlaceableState();
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

  removeFacilityEquipment(equipId) {
    return this.removePlaceable(equipId);
  }

  // === ZONE FURNISHINGS ===

  placeZoneFurnishing(col, row, furnType, subCol, subRow, rotated = false) {
    return this.placePlaceable({
      type: furnType,
      category: 'furnishing',
      col,
      row,
      subCol,
      subRow,
      rotated,
    });
  }

  removeZoneFurnishing(furnId) {
    return this.removePlaceable(furnId);
  }

  // === UNIFIED PLACEMENT SYSTEM ===

  /**
   * Place any item on the unified sub-grid.
   * @param {Object} opts - { type, category, col, row, subCol, subRow, rotated, dir, params }
   *   category: "beamline" | "equipment" | "furnishing"
   * @returns {string|false} The placeable id, or false on failure
   */
  placePlaceable(opts) {
    const { type, col, row, subCol, subRow, dir = 0, params } = opts;

    const placeable = PLACEABLES[type];
    if (!placeable) return false;
    const kind = placeable.kind;

    if (!this.canAfford(placeable.cost)) {
      this.log(`Can't afford ${placeable.name}!`, 'bad');
      return false;
    }

    // The ONLY placement constraint: subtile footprint collision.
    const cells = placeable.footprintCells(col, row, subCol || 0, subRow || 0, dir);
    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      if (this.state.subgridOccupied[k]) {
        this.log('Space occupied!', 'bad');
        return false;
      }
    }

    // Allocate id.
    const prefix = kind === 'beamline' ? 'bl_'
      : kind === 'furnishing' ? 'fn_'
      : kind === 'decoration' ? 'dc_'
      : 'eq_';
    const id = prefix + this.state.placeableNextId++;

    this.spend(placeable.cost);

    const entry = {
      id,
      type,
      category: kind,            // legacy alias for downstream consumers
      kind,
      col,
      row,
      subCol: subCol || 0,
      subRow: subRow || 0,
      dir,
      params: null,
      cells,
    };

    // Beamline param init (was previously inline; only kind that needs it).
    if (kind === 'beamline') {
      entry.params = {};
      if (PARAM_DEFS[type]) {
        for (const [k, pdef] of Object.entries(PARAM_DEFS[type])) {
          if (!pdef.derived) entry.params[k] = pdef.default;
        }
      }
      if (placeable.params) {
        for (const [k, v] of Object.entries(placeable.params)) {
          if (!(k in entry.params)) entry.params[k] = v;
        }
      }
      if (params) Object.assign(entry.params, params);
    }

    this.state.placeables.push(entry);
    this.state.placeableIndex[id] = this.state.placeables.length - 1;

    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      this.state.subgridOccupied[k] = { id, kind };
    }

    placeable.onPlaced(this, entry);

    this.log(`Built ${placeable.name}`, 'good');
    this.computeSystemStats();
    this.emit('placeableChanged');
    if (kind === 'equipment') this.emit('facilityChanged');
    if (kind === 'furnishing') this.emit('zonesChanged');
    this._syncLegacyPlaceableState();
    return id;
  }

  /**
   * Remove a placeable by ID. Refunds 50% of cost.
   */
  removePlaceable(placeableId) {
    const idx = this.state.placeableIndex[placeableId];
    if (idx === undefined) return false;

    const entry = this.state.placeables[idx];
    if (!entry) return false;

    const placeable = PLACEABLES[entry.type];
    if (!placeable) return false;

    // 50% refund
    if (placeable.cost) {
      for (const [r, a] of Object.entries(placeable.cost)) {
        this.state.resources[r] += Math.floor(a * 0.5);
      }
    }

    // Lifecycle hook — runs before we clear cells / remove the entry so
    // subclasses (e.g. BeamlineModule) can still see the instance in place.
    placeable.onRemoved(this, entry);

    // Free sub-grid cells
    for (const cell of entry.cells) {
      const cellKey = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
      delete this.state.subgridOccupied[cellKey];
    }

    // Remove beam pipes connected to this placeable (beamline only)
    if (entry.category === 'beamline') {
      this.state.beamPipes = this.state.beamPipes.filter(
        p => p.fromId !== placeableId && p.toId !== placeableId
      );
    }

    // Remove from array
    this.state.placeables.splice(idx, 1);

    // Rebuild index
    this._rebuildPlaceableIndex();

    this.log(`Removed ${placeable.name} (50% refund)`, 'info');
    this.computeSystemStats();
    this.emit('placeableChanged');
    if (entry.category === 'equipment') this.emit('facilityChanged');
    if (entry.category === 'furnishing') this.emit('zonesChanged');
    this._syncLegacyPlaceableState();
    return true;
  }

  /**
   * Unified delete entry point. Accepts a `target` produced by
   * InputHandler._findDeletablePlaceable (or constructed by a context menu)
   * and dispatches to the right per-kind remove method. All delete code
   * paths in the UI route through this so refund/log/event/undo are uniform.
   *
   * @param {object} target - { kind, id?, entry?, node?, pipeId?, attachmentId? }
   * @returns {boolean} true if anything was removed
   */
  demolishTarget(target) {
    if (!target) return false;
    switch (target.kind) {
      case 'beamline': {
        // Two shapes: legacy registry node (target.node) or unified placeable (target.entry).
        if (target.node) return this.removeComponent(target.node.id);
        if (target.entry) return this.removePlaceable(target.entry.id);
        if (target.id) return this.removePlaceable(target.id);
        return false;
      }
      case 'beampipe':
        return this.removeBeamPipe(target.pipeId || target.id);
      case 'attachment':
        return this.removeAttachment(target.pipeId, target.attachmentId);
      case 'equipment':
      case 'furnishing':
      case 'decoration': {
        const id = target.entry?.id || target.id;
        return id ? this.removePlaceable(id) : false;
      }
      case 'machine':
        return this.removeMachine(target.id || target.machineId);
      default:
        return false;
    }
  }

  /**
   * Remove every placed instance of a given kind. Used by the
   * "delete all furnishings" / "delete all beamline" UI tools.
   */
  removePlaceablesByKind(kind) {
    const ids = this.state.placeables
      .filter(p => p.kind === kind || p.category === kind)
      .map(p => p.id);
    let n = 0;
    for (const id of ids) {
      if (this.removePlaceable(id)) n++;
    }
    return n;
  }

  _rebuildPlaceableIndex() {
    this.state.placeableIndex = {};
    for (let i = 0; i < this.state.placeables.length; i++) {
      this.state.placeableIndex[this.state.placeables[i].id] = i;
    }
  }

  getPlaceable(id) {
    const idx = this.state.placeableIndex[id];
    return idx !== undefined ? this.state.placeables[idx] : null;
  }

  getPlaceablesByCategory(category) {
    return this.state.placeables.filter(p => p.category === category);
  }

  _syncLegacyPlaceableState() {
    // Keep legacy arrays in sync for renderers/systems not yet migrated
    this.state.facilityEquipment = this.state.placeables.filter(p => p.category === 'equipment');
    this.state.facilityGrid = {};
    for (const eq of this.state.facilityEquipment) {
      this.state.facilityGrid[eq.col + ',' + eq.row] = eq.id;
    }
    this.state.zoneFurnishings = this.state.placeables.filter(p => p.category === 'furnishing');
    this.state.zoneFurnishingSubgrids = this._getLegacyFurnishingSubgrids();
  }

  _getLegacyFurnishingSubgrids() {
    const subgrids = {};
    const furnishings = this.state.placeables.filter(p => p.category === 'furnishing');
    for (let i = 0; i < furnishings.length; i++) {
      const entry = furnishings[i];
      const def = ZONE_FURNISHINGS[entry.type];
      if (!def) continue;
      const key = entry.col + ',' + entry.row;
      if (!subgrids[key]) {
        subgrids[key] = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
      }
      const gw = entry.rotated ? (def.gridH || 1) : (def.gridW || 1);
      const gh = entry.rotated ? (def.gridW || 1) : (def.gridH || 1);
      const furnIdx = i + 1;
      for (let r = entry.subRow; r < entry.subRow + gh && r < 4; r++) {
        for (let c = entry.subCol; c < entry.subCol + gw && c < 4; c++) {
          subgrids[key][r][c] = furnIdx;
        }
      }
    }
    return subgrids;
  }

  getPlaceableAtSubgrid(col, row, subCol, subRow) {
    const key = col + ',' + row + ',' + subCol + ',' + subRow;
    const occ = this.state.subgridOccupied[key];
    if (!occ) return null;
    return this.getPlaceable(occ.id);
  }

  // === BEAM PIPE ===

  /**
   * Create a beam pipe. Pipes can be free-standing (fromId/toId null) or
   * connect two beamline modules via named ports.
   * @param {string|null} fromId - placeable id of source-side module, or null
   * @param {string|null} fromPort - port name, or null when fromId is null
   * @param {string|null} toId - placeable id of destination module, or null
   * @param {string|null} toPort - port name, or null when toId is null
   * @param {Array} path - array of {col, row} tile positions along the pipe route
   * @returns {boolean}
   */
  createBeamPipe(fromId, fromPort, toId, toPort, path) {
    // Validate endpoints only when they're provided
    if (fromId) {
      const from = this.getPlaceable(fromId);
      if (!from || from.category !== 'beamline') return false;
      const fromDef = COMPONENTS[from.type];
      if (!fromDef || !fromDef.ports || !fromDef.ports[fromPort]) {
        this.log('Invalid source port!', 'bad');
        return false;
      }
      // Duplicate port check
      const dup = this.state.beamPipes.find(
        p => (p.fromId === fromId && p.fromPort === fromPort) ||
             (p.toId === fromId && p.toPort === fromPort)
      );
      if (dup) {
        this.log('Port already connected!', 'bad');
        return false;
      }
    }
    if (toId) {
      const to = this.getPlaceable(toId);
      if (!to || to.category !== 'beamline') return false;
      const toDef = COMPONENTS[to.type];
      if (!toDef || !toDef.ports || !toDef.ports[toPort]) {
        this.log('Invalid destination port!', 'bad');
        return false;
      }
      const dup = this.state.beamPipes.find(
        p => (p.fromId === toId && p.fromPort === toPort) ||
             (p.toId === toId && p.toPort === toPort)
      );
      if (dup) {
        this.log('Port already connected!', 'bad');
        return false;
      }
    }

    // Compute length from actual path geometry — paths may use sub-tile
    // (0.5) steps so counting segments would undercount/overcount length.
    // 1 tile = 2m = 4 sub-units along beam axis.
    let tileDist = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      tileDist += Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    }
    const subL = Math.max(1, Math.round(tileDist * 4));

    // Cost scales with length
    const driftDef = COMPONENTS.drift;
    const costPerTile = driftDef ? driftDef.cost.funding : 10000;
    const totalCost = { funding: Math.max(costPerTile, Math.floor(costPerTile * tileDist)) };

    if (!this.canAfford(totalCost)) {
      this.log("Can't afford beam pipe!", 'bad');
      return false;
    }

    this.spend(totalCost);

    const id = 'bp_' + this.state.beamPipeNextId++;
    const pipe = {
      id,
      fromId: fromId || null,
      fromPort: fromId ? fromPort : null,
      toId: toId || null,
      toPort: toId ? toPort : null,
      path: path.map(p => ({ col: p.col, row: p.row })),
      subL,
      attachments: [],
    };

    this.state.beamPipes.push(pipe);
    const label = (fromId && toId) ? 'Connected' : 'Placed';
    this.log(`${label} beam pipe (${(subL * 0.5).toFixed(1)}m)`, 'good');
    this._deriveBeamGraph();
    this.emit('beamlineChanged');
    return true;
  }

  /**
   * Add an attachment (inline component) to an existing beam pipe.
   * @param {string} pipeId - beam pipe ID
   * @param {string} type - component type (must be placement: 'attachment')
   * @param {number} position - 0..1 normalized position along pipe
   * @param {Object} params - optional parameter overrides
   */
  addAttachmentToPipe(pipeId, type, position, params) {
    const pipe = this.state.beamPipes.find(p => p.id === pipeId);
    if (!pipe) return false;

    const def = COMPONENTS[type];
    if (!def || def.placement !== 'attachment') {
      this.log('Not an attachment component!', 'bad');
      return false;
    }

    if (!this.isComponentUnlocked(def)) {
      this.log(`${def.name} not unlocked!`, 'bad');
      return false;
    }

    if (!this.canAfford(def.cost)) {
      this.log(`Can't afford ${def.name}!`, 'bad');
      return false;
    }

    // Overlength check: new attachment must fit in the remaining pipe length
    const existingAttSubL = pipe.attachments.reduce((sum, a) => {
      const d = COMPONENTS[a.type];
      return sum + (d ? (d.subL || 1) : 1);
    }, 0);
    const newAttSubL = def.subL || 1;
    if (existingAttSubL + newAttSubL > pipe.subL) {
      this.log(`Not enough pipe length for ${def.name}!`, 'bad');
      return false;
    }

    this.spend(def.cost);

    const attId = 'att_' + this.state.placeableNextId++;
    const attachment = {
      id: attId,
      type,
      position: Math.max(0, Math.min(1, position)),
      params: {},
    };

    // Initialize params from PARAM_DEFS and component definition
    if (PARAM_DEFS[type]) {
      for (const [k, pdef] of Object.entries(PARAM_DEFS[type])) {
        if (!pdef.derived) attachment.params[k] = pdef.default;
      }
    }
    if (def.params) {
      for (const [k, v] of Object.entries(def.params)) {
        if (!(k in attachment.params)) attachment.params[k] = v;
      }
    }
    if (params) Object.assign(attachment.params, params);

    // Insert sorted by position
    const insertIdx = pipe.attachments.findIndex(a => a.position > attachment.position);
    if (insertIdx === -1) {
      pipe.attachments.push(attachment);
    } else {
      pipe.attachments.splice(insertIdx, 0, attachment);
    }

    this.log(`Attached ${def.name}`, 'good');
    this._deriveBeamGraph();
    this.emit('beamlineChanged');
    return attId;
  }

  /**
   * Remove an attachment from a pipe.
   */
  removeAttachment(pipeId, attachmentId) {
    const pipe = this.state.beamPipes.find(p => p.id === pipeId);
    if (!pipe) return false;

    const idx = pipe.attachments.findIndex(a => a.id === attachmentId);
    if (idx === -1) return false;

    const att = pipe.attachments[idx];
    const def = COMPONENTS[att.type];

    // 50% refund
    if (def && def.cost) {
      for (const [r, a] of Object.entries(def.cost)) {
        this.state.resources[r] += Math.floor(a * 0.5);
      }
    }

    pipe.attachments.splice(idx, 1);
    this.log(`Removed ${def ? def.name : 'attachment'} (50% refund)`, 'info');
    this._deriveBeamGraph();
    this.emit('beamlineChanged');
    return true;
  }

  removeBeamPipe(pipeId) {
    const idx = this.state.beamPipes.findIndex(p => p.id === pipeId);
    if (idx === -1) return false;

    const pipe = this.state.beamPipes[idx];

    // Refund pipe cost (50%) — compute from actual path geometry
    const driftDef = COMPONENTS.drift;
    const costPerTile = driftDef ? driftDef.cost.funding : 10000;
    let tileDist = 0;
    for (let i = 0; i < (pipe.path?.length || 0) - 1; i++) {
      const a = pipe.path[i], b = pipe.path[i + 1];
      tileDist += Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    }
    const tileCost = Math.max(costPerTile, Math.floor(costPerTile * (tileDist || 1)));
    this.state.resources.funding += Math.floor(tileCost * 0.5);

    // Refund all attachments on this pipe (50%)
    for (const att of (pipe.attachments || [])) {
      const attDef = COMPONENTS[att.type];
      if (attDef && attDef.cost) {
        for (const [r, a] of Object.entries(attDef.cost)) {
          this.state.resources[r] += Math.floor(a * 0.5);
        }
      }
    }

    this.state.beamPipes.splice(idx, 1);
    this.log('Removed beam pipe (50% refund)', 'info');
    this._deriveBeamGraph();
    this.emit('beamlineChanged');
    return true;
  }

  /**
   * Derive beam graph from pipe connectivity.
   * Traverses from sources through beam pipes to build ordered component lists.
   * Updates state.beamline for physics simulation.
   */
  _deriveBeamGraph() {
    const beamItems = this.state.placeables.filter(p => p.category === 'beamline');
    const sources = beamItems.filter(p => {
      const def = COMPONENTS[p.type];
      return def && def.isSource;
    });

    const allOrdered = [];
    for (const source of sources) {
      const flat = flattenPath(this.state, source.id);
      // Convert flattener entries to the shape physics expects.
      // Every entry needs: type, subL, stats, params, beamStart, tiles.
      for (const entry of flat) {
        const def = COMPONENTS[entry.type] || COMPONENTS.drift;
        allOrdered.push({
          id: entry.id,
          type: entry.kind === 'drift' ? 'drift' : entry.type,
          col: entry.placeable?.col ?? 0,
          row: entry.placeable?.row ?? 0,
          dir: entry.placeable?.dir ?? 0,
          params: entry.params || {},
          tiles: entry.placeable?.cells?.map(c => ({ col: c.col, row: c.row })) || [],
          beamStart: entry.beamStart,
          subL: entry.subL,
          // Pass through stats from the component template so physics can read them
          stats: def ? { ...def.stats } : {},
          isAttachment: entry.kind === 'attachment',
          pipeId: entry.pipeId || null,
        });
      }
    }

    // Keep legacy registry compatibility: merge in any designer-placed beamline
    // nodes that aren't already in placeables.
    if (this.registry) {
      for (const entry of this.registry.getAll()) {
        const ordered = entry.beamline.getOrderedComponents();
        for (const node of ordered) {
          if (!allOrdered.some(n => n.id === node.id)) {
            allOrdered.push(node);
          }
        }
      }
    }

    this.state.beamline = allOrdered;
  }

  // === DECORATIONS ===

  /**
   * Returns the placed decoration instance at (col,row), or null. Used by
   * crop/clear/bulldozer code that needs "is there a decoration on this
   * tile?" semantics.
   */
  _decorationAtTile(col, row) {
    for (let sr = 0; sr < 4; sr++) {
      for (let sc = 0; sc < 4; sc++) {
        const k = col + ',' + row + ',' + sc + ',' + sr;
        const occ = this.state.subgridOccupied[k];
        if (!occ || occ.kind !== 'decoration') continue;
        const idx = this.state.placeableIndex[occ.id];
        if (idx === undefined) continue;
        return this.state.placeables[idx];
      }
    }
    return null;
  }

  removeDecoration(col, row, subCol = 0, subRow = 0) {
    // Legacy signature. Look up the instance occupying the tile and route
    // through the unified removePlaceable path.
    if (arguments.length >= 4) {
      const key = col + ',' + row + ',' + subCol + ',' + subRow;
      const occ = this.state.subgridOccupied[key];
      if (occ) return this.removePlaceable(occ.id);
      return false;
    }
    const inst = this._decorationAtTile(col, row);
    if (!inst) return false;
    return this.removePlaceable(inst.id);
  }

  hasBlockingDecoration(col, row) {
    const inst = this._decorationAtTile(col, row);
    if (!inst) return false;
    const def = DECORATIONS[inst.type];
    return def ? def.blocksBuild : false;
  }

  _clearNonBlockingDecoration(col, row) {
    const inst = this._decorationAtTile(col, row);
    if (!inst) return;
    const def = DECORATIONS[inst.type];
    if (def && !def.blocksBuild) {
      this.removePlaceable(inst.id);
    }
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

  /**
   * Lazily create a legacy registry entry for a source placeable so the
   * existing click/window flow (_getNodeAtGrid → registry → BeamlineWindow)
   * can find it. Sources placed via the unified placeable system have no
   * registry representation by default; this bridges the gap. Idempotent.
   */
  _ensureBeamlineForSourcePlaceable(instance) {
    if (!instance) return null;
    const comp = COMPONENTS[instance.type];
    if (!comp?.isSource) return null;
    if (instance.beamlineId && this.registry.get(instance.beamlineId)) {
      return instance.beamlineId;
    }
    let machineType = 'linac';
    if (instance.type === 'dcPhotoGun' || instance.type === 'ncRfGun' || instance.type === 'srfGun') {
      machineType = 'photoinjector';
    }
    const entry = this.registry.createBeamline(machineType);

    // Build a unique tile set from the placeable's footprint.
    const tileKeys = new Set();
    const tiles = [];
    const cells = instance.cells && instance.cells.length
      ? instance.cells
      : [{ col: instance.col, row: instance.row }];
    for (const c of cells) {
      const key = c.col + ',' + c.row;
      if (tileKeys.has(key)) continue;
      tileKeys.add(key);
      tiles.push({ col: c.col, row: c.row });
    }

    // Build the registry node. Reuse the placeable id so the component-builder
    // mesh map (keyed by node.id) dedupes with the placeable mesh path.
    const node = {
      id: instance.id,
      type: instance.type,
      col: instance.col,
      row: instance.row,
      subCol: instance.subCol ?? 0,
      subRow: instance.subRow ?? 0,
      dir: instance.dir ?? 0,
      entryDir: null,
      parentId: null,
      bendDir: null,
      tiles,
      params: instance.params ? { ...instance.params } : {},
    };
    entry.beamline.nodes.push(node);
    for (const t of tiles) {
      entry.beamline.occupied[t.col + ',' + t.row] = node.id;
    }
    this.registry.occupyTiles(entry.id, node);
    instance.beamlineId = entry.id;

    this.recalcBeamline(entry.id);
    return entry.id;
  }

  /**
   * Tear down the registry entry created for a source placeable.
   */
  _removeBeamlineForSourcePlaceable(instance) {
    if (!instance || !instance.beamlineId) return;
    this.registry.removeBeamline(instance.beamlineId);
    instance.beamlineId = null;
  }

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
    this._recalcMainBeamGraph();
    this.checkInjectorLinks();
    this.validateInfrastructure();
  }

  recalcAllBeamlines() {
    for (const entry of this.registry.getAll()) {
      this._recalcSingleBeamline(entry);
    }
    this._updateAggregateBeamline();
    this._recalcMainBeamGraph();
    this.checkInjectorLinks();
    this.validateInfrastructure();
  }

  // Physics pass for the unified main-map pipe graph. Runs additively on top
  // of the per-registry-entry physics used by designer-placed beamlines.
  // Derives state.beamline from the pipe graph (via _deriveBeamGraph) and
  // runs BeamPhysics.compute() once over the ordered modules + drift + attachments.
  // Result is stored in state.mainBeamState so renderers / HUD can read it
  // without clobbering per-entry beamState data.
  _recalcMainBeamGraph() {
    // _deriveBeamGraph writes the unified ordered list into state.beamline
    // (overwriting the registry-node snapshot _updateAggregateBeamline set).
    this._deriveBeamGraph();
    const ordered = this.state.beamline || [];
    if (ordered.length === 0) {
      this.state.mainBeamState = null;
      return;
    }

    // Contract check: every entry must have a positive subL so physics s-axis is correct
    for (const node of ordered) {
      if (!node.subL || node.subL <= 0) {
        console.warn('[physics] element with bad subL', node);
      }
    }

    // Build physics input from ordered entries. Each entry already has subL
    // in sub-units, params, and the component type. Physics multiplies subL
    // by 0.5 to get metres.
    const physicsBeamline = ordered.map(node => {
      const def = COMPONENTS[node.type];
      return {
        type: node.type,
        subL: node.subL,
        stats: def && def.stats ? { ...def.stats } : {},
        params: node.params || {},
      };
    });

    // Collect research effects
    const researchEffects = {};
    for (const key of ['luminosityMult', 'dataRateMult', 'energyCostMult', 'discoveryChance',
                        'vacuumQuality', 'beamStability', 'photonFluxMult', 'cryoEfficiencyMult',
                        'beamLifetimeMult', 'diagnosticPrecision']) {
      const v = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
      researchEffects[key] = v;
    }

    if (!BeamPhysics.isReady()) {
      this.state.mainBeamState = null;
      return;
    }
    const result = BeamPhysics.compute(physicsBeamline, researchEffects);
    this.state.mainBeamState = result || null;
    // Also expose envelope for probe.js, which reads state.physicsEnvelope
    if (result && result.envelope) {
      this.state.physicsEnvelope = result.envelope;
    }
    this.emit('physicsUpdated');
  }

  _recalcSingleBeamline(entry) {
    const ordered = entry.beamline.getOrderedComponents();

    // Calculate energy cost and total length from templates
    let tLen = 0, tCost = 0, hasSrc = false;
    const ecm = this.getEffect('energyCostMult', 1);
    for (const node of ordered) {
      const t = COMPONENTS[node.type];
      if (!t) continue;
      tLen += (t.subL || 4) * 0.5;
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
        const el = {
          type: node.type,
          subL: t.subL || 4,
          stats: effectiveStats,
          params: node.params || {},
        };
        if (t.extractionEnergy !== undefined) {
          el.extractionEnergy = t.extractionEnergy;
        }
        const nq = this.state.nodeQualities?.[node.id];
        if (nq) {
          el.infraQuality = nq;
        }
        return el;
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

  computeZoneFurnishingBonuses() {
    // Returns { zoneOutput: { zoneType -> totalBonus }, research: { zoneType -> totalBonus } }
    const zoneOutput = {};
    const research = {};

    for (const furn of this.state.zoneFurnishings) {
      const furnDef = ZONE_FURNISHINGS[furn.type];
      if (!furnDef || !furnDef.effects) continue;

      const key = furn.col + ',' + furn.row;
      const tileZone = this.state.zoneOccupied[key];

      // zoneOutput only applies in the preferred zone
      if (furnDef.effects.zoneOutput && tileZone === furnDef.zoneType) {
        zoneOutput[tileZone] = (zoneOutput[tileZone] || 0) + furnDef.effects.zoneOutput;
      }

      // research applies in the preferred zone
      if (furnDef.effects.research && tileZone === furnDef.zoneType) {
        research[tileZone] = (research[tileZone] || 0) + furnDef.effects.research;
      }
    }

    return { zoneOutput, research };
  }

  _detectRoom(startCol, startRow) {
    const wallOcc = this.state.wallOccupied || {};
    const doorOcc = this.state.doorOccupied || {};
    const room = new Set();
    const queue = [`${startCol},${startRow}`];
    room.add(queue[0]);
    const MAX_TILES = 500;

    const edgeBlocked = (wallKey1, wallKey2, doorKey1, doorKey2) =>
      (wallOcc[wallKey1] || wallOcc[wallKey2]) && !doorOcc[doorKey1] && !doorOcc[doorKey2];

    while (queue.length > 0 && room.size < MAX_TILES) {
      const key = queue.shift();
      const [c, r] = key.split(',').map(Number);

      const eKey = `${c + 1},${r}`;
      if (!room.has(eKey) && !edgeBlocked(`${c},${r},e`, `${c+1},${r},w`, `${c},${r},e`, `${c+1},${r},w`)) {
        room.add(eKey); queue.push(eKey);
      }
      const wKey = `${c - 1},${r}`;
      if (!room.has(wKey) && !edgeBlocked(`${c-1},${r},e`, `${c},${r},w`, `${c-1},${r},e`, `${c},${r},w`)) {
        room.add(wKey); queue.push(wKey);
      }
      const sKey = `${c},${r + 1}`;
      if (!room.has(sKey) && !edgeBlocked(`${c},${r},s`, `${c},${r+1},n`, `${c},${r},s`, `${c},${r+1},n`)) {
        room.add(sKey); queue.push(sKey);
      }
      const nKey = `${c},${r - 1}`;
      if (!room.has(nKey) && !edgeBlocked(`${c},${r-1},s`, `${c},${r},n`, `${c},${r-1},s`, `${c},${r},n`)) {
        room.add(nKey); queue.push(nKey);
      }
    }
    return room;
  }

  computeRoomMorale() {
    const roomMorale = new Map();
    const tileToRoom = {};
    const processed = new Set();

    for (const furn of this.state.zoneFurnishings) {
      const furnDef = ZONE_FURNISHINGS[furn.type];
      if (!furnDef || !furnDef.effects || !furnDef.effects.morale) continue;

      const key = furn.col + ',' + furn.row;
      let room = tileToRoom[key];
      if (!room && !processed.has(key)) {
        room = this._detectRoom(furn.col, furn.row);
        for (const tileKey of room) {
          tileToRoom[tileKey] = room;
          processed.add(tileKey);
        }
      }
      if (!room) continue;

      const roomKey = [...room].sort()[0];
      const current = roomMorale.get(roomKey) || 0;
      roomMorale.set(roomKey, current + furnDef.effects.morale);
    }

    return roomMorale;
  }

  getBeamPhysicsEffects() {
    const results = [];

    for (const furn of this.state.zoneFurnishings) {
      const furnDef = ZONE_FURNISHINGS[furn.type];
      if (!furnDef || !furnDef.effects || !furnDef.effects.beamPhysics) continue;

      const room = this._detectRoom(furn.col, furn.row);

      for (const entry of this.registry.getAll()) {
        for (const node of entry.nodes) {
          for (const tile of (node.tiles || [{ col: node.col, row: node.row }])) {
            const tileKey = tile.col + ',' + tile.row;
            if (room.has(tileKey)) {
              results.push({
                beamlineId: entry.id,
                effects: furnDef.effects.beamPhysics,
                furnishingId: furn.id,
              });
              break;
            }
          }
        }
      }
    }

    return results;
  }

  computeSystemStats() {
    const result = computeSystemStats(this.state);
    this.state.systemStats = result;
    this.state.avgPressure = result.avgPressure;
    const furnBonuses = this.computeZoneFurnishingBonuses();
    this.state.zoneFurnishingBonuses = furnBonuses;
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

    // Decoration effects
    const decorationInstances = this.state.placeables.filter(p => p.kind === 'decoration');
    this.state.moraleMultiplier = computeMoraleMultiplier(decorationInstances);
    const roomMorale = this.computeRoomMorale();
    let totalFurnishingMorale = 0;
    for (const [, morale] of roomMorale) {
      totalFurnishingMorale += morale;
    }
    this.state.furnishingMorale = totalFurnishingMorale;
    this.state.reputationTier = getReputationTier(decorationInstances.length);

    // === Revenue ===
    const passiveIncome = this.getEffect('passiveFunding', 0);
    const repIncome = Math.floor(this.state.resources.reputation * 0.5);
    const repBonus = this.state?.reputationTier?.fundingBonus || 0;
    this.state.resources.funding += Math.floor((passiveIncome + repIncome) * (1 + repBonus));

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

    // Auto-save every 10 ticks
    if (this.state.tick % 10 === 0) this.save();

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
      // Apply data fiber network quality
      if (this.state.nodeQualities) {
        let totalDataQ = 0;
        let dataNodeCount = 0;
        const qualNodes = entry.beamline.getAllNodes();
        for (const node of qualNodes) {
          const comp = COMPONENTS[node.type];
          if (comp && (comp.stats?.dataRate || 0) > 0) {
            const nq = this.state.nodeQualities[node.id];
            totalDataQ += nq ? nq.dataQuality : 1.0;
            dataNodeCount++;
          }
        }
        if (dataNodeCount > 0) {
          connectedDataRate *= totalDataQ / dataNodeCount;
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
      infrastructure: this.state.infrastructure,
      infraOccupied: this.state.infraOccupied,
      walls: this.state.walls,
      wallOccupied: this.state.wallOccupied,
      doors: this.state.doors,
      doorOccupied: this.state.doorOccupied,
      zoneOccupied: this.state.zoneOccupied,
      zoneFurnishings: this.state.zoneFurnishings,
      machines: this.state.machines,
    };

    const result = Networks.validate(validationState);
    this.state.infraBlockers = result.blockers;
    this.state.infraCanRun = result.canRun;
    this.state.networkData = result.networks;

    const labBonuses = findLabNetworkBonuses(validationState, result.networks);
    const nodeQualities = Networks.computeNodeQualities(result.networks, labBonuses, this.state.beamline);
    this.state.nodeQualities = nodeQualities;
    this.state.labBonuses = labBonuses;

    // Per-beamline fault attribution: only hard blockers stop the beam
    for (const blocker of result.blockers) {
      if (blocker.severity === 'hard' && blocker.nodeId) {
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

    // Soft blocker warnings (log once per unique reason)
    if (!this._softBlockerWarned) this._softBlockerWarned = {};
    for (const blocker of result.blockers) {
      if (blocker.severity === 'soft' && !this._softBlockerWarned[blocker.reason]) {
        this.log(`Warning: ${blocker.reason}`, 'warn');
        this._softBlockerWarned[blocker.reason] = true;
      }
    }
    // Clear warnings for blockers that are gone
    const activeReasons = new Set(result.blockers.filter(b => b.severity === 'soft').map(b => b.reason));
    for (const key of Object.keys(this._softBlockerWarned)) {
      if (!activeReasons.has(key)) delete this._softBlockerWarned[key];
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

  // === SAVED DESIGNS ===

  addDesign({ name, category, components }) {
    const id = this.state.savedDesignNextId++;
    const now = Date.now();
    this.state.savedDesigns.push({
      id,
      name,
      category: category || 'other',
      components,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  updateDesign(id, updates) {
    const design = this.state.savedDesigns.find(d => d.id === id);
    if (!design) return false;
    if (updates.name !== undefined) design.name = updates.name;
    if (updates.category !== undefined) design.category = updates.category;
    if (updates.components !== undefined) design.components = updates.components;
    design.updatedAt = Date.now();
    return true;
  }

  deleteDesign(id) {
    const idx = this.state.savedDesigns.findIndex(d => d.id === id);
    if (idx < 0) return false;
    this.state.savedDesigns.splice(idx, 1);
    return true;
  }

  getDesign(id) {
    return this.state.savedDesigns.find(d => d.id === id) || null;
  }

  getDesignsByCategory(category) {
    if (!category || category === 'all') return this.state.savedDesigns;
    return this.state.savedDesigns.filter(d => d.category === category);
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
      if (!this.state.zoneFurnishingSubgrids) this.state.zoneFurnishingSubgrids = {};
      if (!this.state.zoneFurnishingNextId) this.state.zoneFurnishingNextId = 1;

      // Ensure unified placement state exists
      if (!this.state.placeables) this.state.placeables = [];
      if (!this.state.placeableIndex) this.state.placeableIndex = {};
      if (!this.state.subgridOccupied) this.state.subgridOccupied = {};
      if (!this.state.placeableNextId) this.state.placeableNextId = 1;
      if (!this.state.beamPipes) this.state.beamPipes = [];
      if (!this.state.beamPipeNextId) this.state.beamPipeNextId = 1;

      // Migrate beam pipes added before Task 2 (ports + attachments):
      if (this.state.beamPipes) {
        for (const pipe of this.state.beamPipes) {
          if (!pipe.fromPort) pipe.fromPort = 'exit';
          if (!pipe.toPort) pipe.toPort = 'entry';
          if (!pipe.attachments) pipe.attachments = [];
        }
      }

      // Migrate old format -> unified placeables (if placeables is empty but old arrays have data)
      if (this.state.placeables.length === 0) {
        // Migrate facility equipment
        if (this.state.facilityEquipment && this.state.facilityEquipment.length > 0) {
          for (const eq of this.state.facilityEquipment) {
            const def = COMPONENTS[eq.type];
            const gw = def ? (def.gridW || def.subW || 4) : 4;
            const gh = def ? (def.gridH || def.subL || 4) : 4;
            const id = 'eq_' + this.state.placeableNextId++;
            const cells = [];
            for (let dr = 0; dr < gh; dr++) {
              for (let dc = 0; dc < gw; dc++) {
                cells.push({ col: eq.col + Math.floor(dc / 4), row: eq.row + Math.floor(dr / 4), subCol: dc % 4, subRow: dr % 4 });
              }
            }
            const entry = {
              id, type: eq.type, category: 'equipment',
              col: eq.col, row: eq.row, subCol: 0, subRow: 0,
              rotated: false, dir: null, params: null, cells,
            };
            this.state.placeables.push(entry);
            this.state.placeableIndex[id] = this.state.placeables.length - 1;
            for (const cell of cells) {
              this.state.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'equipment' };
            }
          }
        }

        // Migrate zone furnishings
        if (this.state.zoneFurnishings && this.state.zoneFurnishings.length > 0) {
          for (const zf of this.state.zoneFurnishings) {
            const def = ZONE_FURNISHINGS[zf.type];
            const gw = zf.rotated ? (def ? def.gridH : 1) : (def ? def.gridW : 1);
            const gh = zf.rotated ? (def ? def.gridW : 1) : (def ? def.gridH : 1);
            const id = 'fn_' + this.state.placeableNextId++;
            const cells = [];
            for (let dr = 0; dr < gh; dr++) {
              for (let dc = 0; dc < gw; dc++) {
                const sc = (zf.subCol || 0) + dc;
                const sr = (zf.subRow || 0) + dr;
                cells.push({ col: zf.col + Math.floor(sc / 4), row: zf.row + Math.floor(sr / 4), subCol: sc % 4, subRow: sr % 4 });
              }
            }
            const entry = {
              id, type: zf.type, category: 'furnishing',
              col: zf.col, row: zf.row, subCol: zf.subCol || 0, subRow: zf.subRow || 0,
              rotated: zf.rotated || false, dir: null, params: null, cells,
            };
            this.state.placeables.push(entry);
            this.state.placeableIndex[id] = this.state.placeables.length - 1;
            for (const cell of cells) {
              this.state.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'furnishing' };
            }
          }
        }
      }

      // Rebuild wall state
      this.state.walls = this.state.walls || [];
      this.state.wallOccupied = {};
      for (const w of this.state.walls) {
        this.state.wallOccupied[`${w.col},${w.row},${w.edge}`] = w.type;
      }

      // Migrate: remove deprecated energy resource
      delete this.state.resources.energy;
      delete this.state.electricalPower;
      delete this.state.maxElectricalPower;

      // Ensure infra validation state exists
      this.state.infraBlockers = this.state.infraBlockers || [];
      this.state.infraCanRun = this.state.infraCanRun !== undefined ? this.state.infraCanRun : true;
      this.state.networkData = this.state.networkData || null;

      // Ensure saved designs exist
      if (!this.state.savedDesigns) this.state.savedDesigns = [];
      if (!this.state.savedDesignNextId) this.state.savedDesignNextId = 1;
      // Ensure designerState exists
      if (!this.state.designerState) this.state.designerState = null;

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

      // Bridge any source placeables from older saves that don't yet have
      // a registry entry (so clicks can open their beamline window).
      for (const p of this.state.placeables || []) {
        if (p.category !== 'beamline') continue;
        const comp = COMPONENTS[p.type];
        if (!comp?.isSource) continue;
        if (p.beamlineId && this.registry.get(p.beamlineId)) continue;
        this._ensureBeamlineForSourcePlaceable(p);
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
    if (!this.state.zoneFurnishingSubgrids) this.state.zoneFurnishingSubgrids = {};
    if (!this.state.zoneFurnishingNextId) this.state.zoneFurnishingNextId = 1;

    // Ensure unified placement state exists
    if (!this.state.placeables) this.state.placeables = [];
    if (!this.state.placeableIndex) this.state.placeableIndex = {};
    if (!this.state.subgridOccupied) this.state.subgridOccupied = {};
    if (!this.state.placeableNextId) this.state.placeableNextId = 1;
    if (!this.state.beamPipes) this.state.beamPipes = [];
    if (!this.state.beamPipeNextId) this.state.beamPipeNextId = 1;

    // Migrate old format -> unified placeables (if placeables is empty but old arrays have data)
    if (this.state.placeables.length === 0) {
      // Migrate facility equipment
      if (this.state.facilityEquipment && this.state.facilityEquipment.length > 0) {
        for (const eq of this.state.facilityEquipment) {
          const def = COMPONENTS[eq.type];
          const gw = def ? (def.gridW || def.subW || 4) : 4;
          const gh = def ? (def.gridH || def.subL || 4) : 4;
          const id = 'eq_' + this.state.placeableNextId++;
          const cells = [];
          for (let dr = 0; dr < gh; dr++) {
            for (let dc = 0; dc < gw; dc++) {
              cells.push({ col: eq.col + Math.floor(dc / 4), row: eq.row + Math.floor(dr / 4), subCol: dc % 4, subRow: dr % 4 });
            }
          }
          const entry = {
            id, type: eq.type, category: 'equipment',
            col: eq.col, row: eq.row, subCol: 0, subRow: 0,
            rotated: false, dir: null, params: null, cells,
          };
          this.state.placeables.push(entry);
          this.state.placeableIndex[id] = this.state.placeables.length - 1;
          for (const cell of cells) {
            this.state.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'equipment' };
          }
        }
      }

      // Migrate zone furnishings
      if (this.state.zoneFurnishings && this.state.zoneFurnishings.length > 0) {
        for (const zf of this.state.zoneFurnishings) {
          const def = ZONE_FURNISHINGS[zf.type];
          const gw = zf.rotated ? (def ? def.gridH : 1) : (def ? def.gridW : 1);
          const gh = zf.rotated ? (def ? def.gridW : 1) : (def ? def.gridH : 1);
          const id = 'fn_' + this.state.placeableNextId++;
          const cells = [];
          for (let dr = 0; dr < gh; dr++) {
            for (let dc = 0; dc < gw; dc++) {
              const sc = (zf.subCol || 0) + dc;
              const sr = (zf.subRow || 0) + dr;
              cells.push({ col: zf.col + Math.floor(sc / 4), row: zf.row + Math.floor(sr / 4), subCol: sc % 4, subRow: sr % 4 });
            }
          }
          const entry = {
            id, type: zf.type, category: 'furnishing',
            col: zf.col, row: zf.row, subCol: zf.subCol || 0, subRow: zf.subRow || 0,
            rotated: zf.rotated || false, dir: null, params: null, cells,
          };
          this.state.placeables.push(entry);
          this.state.placeableIndex[id] = this.state.placeables.length - 1;
          for (const cell of cells) {
            this.state.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'furnishing' };
          }
        }
      }
    }

    // Rebuild wall state
    this.state.walls = this.state.walls || [];
    this.state.wallOccupied = {};
    for (const w of this.state.walls) {
      this.state.wallOccupied[`${w.col},${w.row},${w.edge}`] = w.type;
    }

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
