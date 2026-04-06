// === BEAMLINE TYCOON: GAME ENGINE ===

class Game {
  constructor(beamline) {
    this.beamline = beamline;

    this.state = {
      resources: { funding: 100000, energy: 100, reputation: 0, data: 0 },
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
      electricalPower: 0,       // current draw in kW
      maxElectricalPower: 500,  // capacity from substations (kVA)
      totalBeamHours: 0,        // for user facility objectives
      continuousBeamTicks: 0,   // for stable beam objectives
      beamOnTicks: 0,           // total ticks with beam on (for uptime calc)
      uptimeFraction: 1,        // beamOnTicks / tick
      avgPressure: undefined,   // average vacuum pressure (from physics)
      finalNormEmittanceX: undefined,
      finalBunchLength: undefined,
      felSaturated: false,
      // Staffing
      staff: { operators: 1, technicians: 0, scientists: 0, engineers: 0 },
      staffCosts: { operators: 5, technicians: 8, scientists: 10, engineers: 12 }, // $/tick
      // Component health tracking
      componentHealth: {},      // id -> health (0-100)
      // Infrastructure tiles (paths, concrete pads)
      infrastructure: [],       // [{ type, col, row }]
      infraOccupied: {},        // "col,row" -> type
      // Facility equipment (off-beamline support systems)
      facilityEquipment: [],      // [{ id, type, col, row }]
      facilityGrid: {},           // "col,row" -> equipment id
      facilityNextId: 1,
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
    if (this.state.infraOccupied[key]) return false; // already occupied
    if (this.state.resources.funding < infra.cost) return false;

    this.state.resources.funding -= infra.cost;
    this.state.infrastructure.push({ type: infraType, col, row });
    this.state.infraOccupied[key] = infraType;
    return true;
  }

  placeInfraRect(startCol, startRow, endCol, endRow, infraType) {
    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return false;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    // Count new tiles and total cost
    let newTiles = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        if (!this.state.infraOccupied[c + ',' + r]) newTiles++;
      }
    }
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
        if (!this.state.infraOccupied[key]) {
          this.state.resources.funding -= infra.cost;
          this.state.infrastructure.push({ type: infraType, col: c, row: r });
          this.state.infraOccupied[key] = infraType;
          placed++;
        }
      }
    }

    if (placed > 0) {
      this.log(`Placed ${placed} ${infra.name} tiles ($${placed * infra.cost})`, 'good');
      this.emit('infrastructureChanged');
    }
    return placed > 0;
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

    const key = col + ',' + row;
    if (this.state.facilityGrid[key]) {
      this.log('Tile occupied!', 'bad');
      return false;
    }
    if (this.state.infraOccupied[key]) {
      this.log('Tile occupied!', 'bad');
      return false;
    }

    const id = 'fac_' + this.state.facilityNextId++;
    this.spend(comp.cost);
    const entry = { id, type: compType, col, row };
    this.state.facilityEquipment.push(entry);
    this.state.facilityGrid[key] = id;
    this.log(`Built ${comp.name}`, 'good');
    this.emit('facilityChanged');
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
    this.emit('facilityChanged');
    return true;
  }

  // === CONNECTIONS ===

  placeConnection(col, row, connType) {
    const key = col + ',' + row;
    if (!this.state.connections.has(key)) {
      this.state.connections.set(key, new Set());
    }
    const set = this.state.connections.get(key);
    if (set.has(connType)) {
      // Toggle off — remove this connection type from the tile
      set.delete(connType);
      if (set.size === 0) this.state.connections.delete(key);
      this.emit('connectionsChanged');
      return false; // removed
    }
    set.add(connType);
    this.emit('connectionsChanged');
    return true; // added
  }

  getConnectionsAt(col, row) {
    const key = col + ',' + row;
    return this.state.connections.get(key) || new Set();
  }

  // Check if a beamline component has a valid connection of the given type
  hasValidConnection(node, connType) {
    const conn = CONNECTION_TYPES[connType];
    if (!conn) return false;

    // Check all 4 adjacent tiles for the connection type
    const adjacentTiles = [
      { col: node.col, row: node.row - 1 },
      { col: node.col, row: node.row + 1 },
      { col: node.col + 1, row: node.row },
      { col: node.col - 1, row: node.row },
    ];

    for (const adj of adjacentTiles) {
      const connSet = this.getConnectionsAt(adj.col, adj.row);
      if (!connSet.has(connType)) continue;

      // Trace the connection path to see if it reaches a valid facility source
      if (this._traceConnectionToSource(adj.col, adj.row, connType)) {
        return true;
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
    switch (comp.category) {
      case 'vacuum': return 'vacuumPipe';
      case 'cryo': return 'cryoTransfer';
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
        return {
          type: node.type,
          length: t.length,
          stats: t.stats || {},
        };
      });

    // Gather research effects for physics
    const researchEffects = {};
    for (const key of ['luminosityMult', 'dataRateMult', 'energyCostMult', 'discoveryChance']) {
      const v = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
      researchEffects[key] = v;
    }

    // Run physics simulation
    this.runPhysics(physicsBeamline, researchEffects);
    this.checkInjectorLinks();
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

  toggleBeam() {
    if (this.state.beamOn) {
      this.state.beamOn = false;
      this.state.continuousBeamTicks = 0;
      this.log('Beam OFF', 'info');
    } else {
      if (!this.beamline.nodes.some(n => COMPONENTS[n.type]?.isSource)) { this.log('Need a Source!', 'bad'); return; }
      if (this.state.resources.energy < this.state.totalEnergyCost) { this.log('Not enough energy!', 'bad'); return; }
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

  // === GAME LOOP ===

  start() {
    if (this.tickInterval) return;
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

    // Energy recharge (power capacity from substations)
    const substations = this.state.beamline.filter(c => c.type === 'substation');
    this.state.maxElectricalPower = 500 + substations.length * 1500; // base 500 + 1500 per substation
    this.state.resources.energy = Math.min(
      this.state.resources.energy + 3,
      200 + this.state.resources.reputation * 20
    );

    if (this.state.beamOn) {
      if (this.state.resources.energy >= this.state.totalEnergyCost) {
        this.state.resources.energy -= this.state.totalEnergyCost;
        this.state.continuousBeamTicks++;
        this.state.beamOnTicks++;

        // Data from detectors (physics-driven)
        if (this.state.dataRate > 0) {
          const sciMult = 1 + this.state.staff.scientists * 0.1; // scientists boost data
          const dataGain = this.state.dataRate * sciMult;
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

        // Beam quality affects reputation gain passively
        if (this.state.beamQuality > 0.8 && this.state.tick % 60 === 0) {
          this.state.resources.reputation += 0.5;
        }

        // Component wear (every 10 ticks)
        if (this.state.tick % 10 === 0) {
          this._applyWear();
        }
      } else {
        this.state.beamOn = false;
        this.state.continuousBeamTicks = 0;
        this.log('Beam shut down: no energy!', 'bad');
        this.emit('beamToggled');
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

    // Research progress (scientists speed it up)
    if (this.state.activeResearch) {
      const r = RESEARCH[this.state.activeResearch];
      const sciBonus = 1 + this.state.staff.scientists * 0.05;
      this.state.researchProgress += sciBonus;
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

    // Auto-save every 30 ticks
    if (this.state.tick % 30 === 0) this.save();

    this.emit('tick');
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
      this.state.componentHealth[node.id] = Math.max(0, this.state.componentHealth[node.id] - baseWear);

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

      const eCost = def.energyCost * perf.energyMult;
      if (this.state.resources.energy < eCost) {
        machine.active = false;
        this.log(`${def.name} shut down: no energy!`, 'bad');
        this.emit('machineChanged');
        continue;
      }
      this.state.resources.energy -= eCost;

      this.state.resources.funding += def.baseFunding * perf.fundingMult;
      const dataGain = def.baseData * perf.dataMult;
      this.state.resources.data += dataGain;
      this.state.totalDataCollected += dataGain;

      if (def.reputationPerTick && machine.operatingMode === 'userOps') {
        this.state.resources.reputation += def.reputationPerTick;
      }

      if (this.state.tick % 10 === 0) {
        const wearRate = 0.01 + eCost * 0.001;
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
    localStorage.setItem('beamlineTycoon', JSON.stringify({
      version: 4,
      state: this.state,
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
      this.beamline.fromJSON(data.beamline);
      this.recalcBeamline();
      this.log('Game loaded.', 'info');
      this.emit('loaded');
      return true;
    } catch { return false; }
  }
}
