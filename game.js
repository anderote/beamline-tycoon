// === BEAMLINE TYCOON: GAME ENGINE ===

class Game {
  constructor(beamline) {
    this.beamline = beamline;

    this.state = {
      resources: { funding: 500, energy: 100, reputation: 0, data: 0 },
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
    if (!comp.requires) return false;
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

  save() {
    localStorage.setItem('beamlineTycoon', JSON.stringify({
      state: this.state,
      beamline: this.beamline.toJSON(),
    }));
  }

  load() {
    const raw = localStorage.getItem('beamlineTycoon');
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      Object.assign(this.state, data.state);
      this.beamline.fromJSON(data.beamline);
      this.recalcBeamline();
      this.log('Game loaded.', 'info');
      this.emit('loaded');
      return true;
    } catch { return false; }
  }
}
