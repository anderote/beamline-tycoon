// Stateful electrical operations: grid outages, breaker trips, UPS charge,
// standby-generator fuel, disconnects, and transfer switching.
//
// The utility descriptors remain the source of truth for electrical flow.
// This coordinator only advances saved device state from solver-published
// networks/flows and exposes public commands/status for Game and the UI. It
// deliberately does not discover networks or recompute electrical quantities.

import { COMPONENTS } from '../data/components.js';
import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { TRANSFER_MODES } from '../utility/electrical-state.js';

export const GENERATOR_REFUEL_COST = 25000;
export const BREAKER_AUTO_RETRY_TICKS = 15;

function rootState(state) {
  if (!state.powerReliability || typeof state.powerReliability !== 'object') {
    state.powerReliability = { devices: {} };
  }
  if (!state.powerReliability.devices
      || typeof state.powerReliability.devices !== 'object') {
    state.powerReliability.devices = {};
  }
  return state.powerReliability;
}

export function initialPowerDeviceState(def) {
  const control = def?.electricalControl;
  if (!control) return null;
  const out = {};
  if (control.kind === 'disconnect') out.switchClosed = true;
  if (control.kind === 'transfer') {
    out.transferMode = 'auto';
    out.transferActive = 'normal';
  }
  if (control.breaker) {
    out.breakerTripped = false;
    out.breakerOpen = false;
    out.overloadTicks = 0;
    out.breakerRetryTicks = 0;
  }
  if (control.battery) {
    out.batteryChargeTicks = control.battery.capacityTicks;
  }
  if (control.source?.kind === 'grid') out.outageTicksRemaining = 0;
  if (control.source?.kind === 'generator') {
    out.generatorEnabled = true;
    out.generatorFuelTicks = control.source.fuelTicks;
  }
  return out;
}

function placedById(state, id) {
  return (state.placeables || []).find(placeable => placeable?.id === id) || null;
}

function networkAtPort(state, utilityType, placeableId, portName) {
  const key = `${placeableId}:${portName}`;
  return (state.utilityNetworks?.get?.(utilityType) || []).find(network =>
    (network.ports || []).some(port => `${port.placeableId}:${port.portName}` === key)) || null;
}

function flowForNetwork(state, utilityType, network) {
  return network && state.utilityNetworkData?.get?.(utilityType)?.get?.(network.id) || null;
}

function monitoredPort(def, utilityType) {
  const ports = getUtilityPortsV2(def?.id);
  if (def?.electricalControl?.kind === 'transfer' && ports.pwr_out) return 'pwr_out';
  if (def?.electricalControl?.kind === 'disconnect') {
    if (ports.pwr_out?.utility === utilityType) return 'pwr_out';
    if (ports.hv_out?.utility === utilityType) return 'hv_out';
  }
  for (const [name, spec] of Object.entries(ports)) {
    if (spec?.utility === utilityType && spec.role === 'source') return name;
  }
  for (const [name, spec] of Object.entries(ports)) {
    if (spec?.utility === utilityType && spec.role === 'pass') return name;
  }
  return null;
}

function monitoredFlow(state, entry, def, utilityType) {
  const portName = monitoredPort(def, utilityType);
  const network = portName && networkAtPort(state, utilityType, entry.id, portName);
  return { portName, network, flow: flowForNetwork(state, utilityType, network) };
}

function sourceFlow(state, entry, utilityType) {
  const ports = getUtilityPortsV2(entry.type);
  const sourceName = Object.keys(ports).find(name =>
    ports[name]?.utility === utilityType && ports[name]?.role === 'source');
  const network = sourceName && networkAtPort(state, utilityType, entry.id, sourceName);
  return { portName: sourceName, network, flow: flowForNetwork(state, utilityType, network) };
}

function pct(value) {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

export class PowerReliabilityCoordinator {
  constructor({ state, rng, log, markTopologyDirty, canAfford, spend } = {}) {
    this.state = state;
    this.rng = rng || Math.random;
    this.log = log || (() => {});
    this.markTopologyDirty = markTopologyDirty || (() => {});
    this.canAfford = canAfford || (() => true);
    this.spend = spend || (() => {});
    rootState(this.state);
    this.initializeAll();
  }

  initializeAll() {
    const devices = rootState(this.state).devices;
    const liveIds = new Set((this.state.placeables || []).map(entry => entry?.id).filter(Boolean));
    for (const id of Object.keys(devices)) {
      if (!liveIds.has(id)) delete devices[id];
    }
    for (const entry of this.state.placeables || []) this.onPlaceablePlaced(entry);
  }

  onPlaceablePlaced(entry) {
    const def = COMPONENTS[entry?.type];
    const initial = initialPowerDeviceState(def);
    if (!entry?.id || !initial) return null;
    const devices = rootState(this.state).devices;
    if (!devices[entry.id]) devices[entry.id] = initial;
    else {
      // New fields receive safe defaults when a save predates the mechanic;
      // existing values always win.
      devices[entry.id] = { ...initial, ...devices[entry.id] };
    }
    return devices[entry.id];
  }

  onPlaceableRemoved(id) {
    const devices = rootState(this.state).devices;
    if (id && devices[id]) delete devices[id];
  }

  deviceState(id) {
    const entry = placedById(this.state, id);
    return entry ? this.onPlaceablePlaced(entry) : null;
  }

  /** Advance events whose state must be visible to this tick's solve. */
  beforeSolve() {
    let requiresResolve = false;
    for (const entry of this.state.placeables || []) {
      const def = COMPONENTS[entry.type];
      const source = def?.electricalControl?.source;
      if (source?.kind !== 'grid') continue;
      const live = this.onPlaceablePlaced(entry);
      if ((live.outageTicksRemaining || 0) > 0) {
        live.outageTicksRemaining--;
        if (live.outageTicksRemaining === 0) {
          this.log(`${def.name}: utility service restored.`, 'good');
          requiresResolve = true;
        }
        continue;
      }
      const chance = Number(source.outageChancePerTick) || 0;
      if (!(chance > 0) || this.rng() >= chance) continue;
      const min = Math.max(1, Math.floor(source.outageMinTicks || 10));
      const max = Math.max(min, Math.floor(source.outageMaxTicks || min));
      live.outageTicksRemaining = min + Math.floor(this.rng() * (max - min + 1));
      this.log(`${def.name}: external grid outage detected.`, 'bad');
      requiresResolve = true;
    }
    return { requiresResolve };
  }

  _setTransferActive(entry, live, active) {
    if (active !== 'normal' && active !== 'backup') return false;
    if (live.transferActive === active) return false;
    live.transferActive = active;
    this.log(`${COMPONENTS[entry.type]?.name || entry.type}: transferred to ${active} power.`,
      active === 'backup' ? 'warn' : 'good');
    return true;
  }

  _reconcileTransfer(entry, def, live) {
    const mode = TRANSFER_MODES.includes(live.transferMode) ? live.transferMode : 'auto';
    if (mode !== 'auto') return this._setTransferActive(entry, live, mode);

    const normal = flowForNetwork(
      this.state, 'powerCable', networkAtPort(this.state, 'powerCable', entry.id, 'normal_in'),
    );
    const backup = flowForNetwork(
      this.state, 'powerCable', networkAtPort(this.state, 'powerCable', entry.id, 'backup_in'),
    );
    const normalLive = (normal?.totalCapacity || 0) > 0;
    const backupLive = (backup?.totalCapacity || 0) > 0;
    const wanted = normalLive ? 'normal' : (backupLive ? 'backup' : live.transferActive || 'normal');
    return this._setTransferActive(entry, live, wanted);
  }

  _tickBreaker(entry, def, live) {
    const breaker = def.electricalControl?.breaker;
    if (!breaker) return false;
    if (live.breakerOpen === true) {
      live.overloadTicks = 0;
      return false;
    }
    if (live.breakerTripped) {
      const remaining = Number.isFinite(live.breakerRetryTicks) && live.breakerRetryTicks > 0
        ? live.breakerRetryTicks
        : BREAKER_AUTO_RETRY_TICKS;
      live.breakerRetryTicks = Math.max(0, remaining - 1);
      if (live.breakerRetryTicks > 0) return false;
      live.breakerTripped = false;
      live.overloadTicks = 0;
      this.log(`${def.name}: breaker attempting automatic reset.`, 'warn');
      return true;
    }
    const { flow } = monitoredFlow(this.state, entry, def, breaker.utility);
    const capacity = flow?.totalCapacity || 0;
    const demand = flow?.totalDemand || 0;
    const overloaded = capacity > 0 && demand > capacity * 1.001;
    live.overloadTicks = overloaded ? (live.overloadTicks || 0) + 1 : 0;
    if (live.overloadTicks < (breaker.tripDelayTicks || 5)) return false;
    live.breakerTripped = true;
    live.breakerRetryTicks = BREAKER_AUTO_RETRY_TICKS;
    this.log(`${def.name}: breaker tripped after sustained overload.`, 'bad');
    return true;
  }

  _tickBattery(entry, def, live) {
    const battery = def.electricalControl?.battery;
    if (!battery) return false;
    const cap = battery.capacityTicks;
    const before = Math.max(0, Math.min(cap, live.batteryChargeTicks ?? cap));
    const upstream = this.state.nodeQualities?.[entry.id]?.hvQuality || 0;
    const { flow } = sourceFlow(this.state, entry, 'powerCable');
    const demand = Math.max(0, flow?.totalDemand || 0);
    let next = before;
    if (upstream > 0) next = Math.min(cap, before + (battery.rechargePerTick || 1));
    else if (demand > 0 && before > 0) {
      const rating = def.electricalControl?.breaker?.rating || 100;
      next = Math.max(0, before - Math.max(0.05, demand / rating));
    }
    live.batteryChargeTicks = next;
    if (before > 0 && next <= 0) {
      this.log(`${def.name}: battery depleted.`, 'bad');
      return true;
    }
    return false;
  }

  _tickGenerator(entry, def, live) {
    const source = def.electricalControl?.source;
    if (source?.kind !== 'generator' || live.generatorEnabled === false) return false;
    const before = Math.max(0, live.generatorFuelTicks ?? source.fuelTicks ?? 0);
    const { flow } = sourceFlow(this.state, entry, 'powerCable');
    const demand = Math.max(0, flow?.totalDemand || 0);
    if (!(demand > 0) || !(before > 0)) return false;
    const rating = def.electricalControl?.breaker?.rating || 250;
    live.generatorFuelTicks = Math.max(0, before - Math.max(0.05, demand / rating));
    if (before > 0 && live.generatorFuelTicks <= 0) {
      this.log(`${def.name}: fuel exhausted.`, 'bad');
      return true;
    }
    return false;
  }

  /** Advance behavior that depends on solver-published flows. */
  afterSolve({ advance = true } = {}) {
    let requiresResolve = false;
    for (const entry of this.state.placeables || []) {
      const def = COMPONENTS[entry.type];
      if (!def?.electricalControl) continue;
      const live = this.onPlaceablePlaced(entry);
      if (def.electricalControl.kind === 'transfer') {
        requiresResolve = this._reconcileTransfer(entry, def, live) || requiresResolve;
      }
      if (advance) {
        requiresResolve = this._tickBreaker(entry, def, live) || requiresResolve;
        requiresResolve = this._tickBattery(entry, def, live) || requiresResolve;
        requiresResolve = this._tickGenerator(entry, def, live) || requiresResolve;
      }
    }
    if (requiresResolve) this.markTopologyDirty();
    return { requiresResolve };
  }

  status(id) {
    const entry = placedById(this.state, id);
    const def = COMPONENTS[entry?.type];
    const control = def?.electricalControl;
    if (!entry || !control) return null;
    const live = this.onPlaceablePlaced(entry);
    const rows = [];
    if (control.kind === 'disconnect') {
      rows.push({ label: 'Switch', value: live.switchClosed === false ? 'Open' : 'Closed' });
    }
    if (control.kind === 'transfer') {
      rows.push({ label: 'Transfer mode', value: live.transferMode || 'auto' });
      rows.push({ label: 'Active source', value: live.transferActive || 'normal' });
    }
    if (control.breaker) {
      rows.push({
        label: 'Breaker',
        value: live.breakerTripped ? 'TRIPPED' : (live.breakerOpen ? 'Open' : 'Closed'),
      });
      if (live.breakerTripped) {
        const retryTicks = Number.isFinite(live.breakerRetryTicks)
          && live.breakerRetryTicks > 0
          ? live.breakerRetryTicks
          : BREAKER_AUTO_RETRY_TICKS;
        rows.push({
          label: 'Auto retry',
          value: `${Math.ceil(retryTicks)} s`,
        });
      }
      const { flow } = monitoredFlow(this.state, entry, def, control.breaker.utility);
      if (flow) {
        rows.push({ label: 'Measured demand', value: `${Math.round(flow.totalDemand || 0)} kW` });
        rows.push({ label: 'Available capacity', value: `${Math.round(flow.totalCapacity || 0)} kW` });
        const utilization = (flow.totalCapacity || 0) > 0
          ? (flow.totalDemand || 0) / flow.totalCapacity : 0;
        rows.push({ label: 'Utilization', value: pct(utilization) });
      }
    }
    if (control.battery) {
      rows.push({
        label: 'Battery',
        value: pct((live.batteryChargeTicks || 0) / control.battery.capacityTicks),
      });
    }
    if (control.source?.kind === 'grid') {
      rows.push({
        label: 'Grid service',
        value: (live.outageTicksRemaining || 0) > 0
          ? `OUTAGE · ${Math.ceil(live.outageTicksRemaining)} ticks`
          : 'Online',
      });
    }
    if (control.source?.kind === 'generator') {
      rows.push({ label: 'Standby', value: live.generatorEnabled === false ? 'Disabled' : 'Enabled' });
      rows.push({
        label: 'Fuel',
        value: pct((live.generatorFuelTicks || 0) / (control.source.fuelTicks || 1)),
      });
    }
    return { rows };
  }

  actions(id) {
    const entry = placedById(this.state, id);
    const def = COMPONENTS[entry?.type];
    const control = def?.electricalControl;
    if (!entry || !control) return [];
    const live = this.onPlaceablePlaced(entry);
    const actions = [];
    if (control.kind === 'disconnect') {
      actions.push({
        id: 'toggleSwitch',
        label: live.switchClosed === false ? 'Close switch' : 'Open switch',
      });
    }
    if (control.kind === 'transfer') {
      const index = TRANSFER_MODES.indexOf(live.transferMode || 'auto');
      const next = TRANSFER_MODES[(index + 1) % TRANSFER_MODES.length];
      actions.push({ id: 'cycleTransfer', label: `Transfer: ${live.transferMode || 'auto'} → ${next}` });
    }
    if (live.breakerTripped) actions.push({ id: 'resetBreaker', label: 'Reset breaker' });
    else if (control.breaker && control.kind !== 'disconnect') {
      actions.push({
        id: 'toggleBreaker',
        label: live.breakerOpen ? 'Close breaker' : 'Open breaker',
      });
    }
    if (control.source?.kind === 'generator') {
      actions.push({
        id: 'toggleGenerator',
        label: live.generatorEnabled === false ? 'Enable standby' : 'Disable standby',
      });
      if ((live.generatorFuelTicks || 0) < control.source.fuelTicks) {
        actions.push({ id: 'refuelGenerator', label: `Refuel ($${GENERATOR_REFUEL_COST.toLocaleString()})` });
      }
    }
    return actions;
  }

  dispatch(id, action) {
    const entry = placedById(this.state, id);
    const def = COMPONENTS[entry?.type];
    const control = def?.electricalControl;
    const live = entry && control && this.onPlaceablePlaced(entry);
    if (!live) return { ok: false };
    let topologyChanged = false;
    let poweredOn = false;
    if (action === 'toggleSwitch' && control.kind === 'disconnect') {
      live.switchClosed = live.switchClosed === false;
      topologyChanged = true;
      poweredOn = live.switchClosed !== false;
    } else if (action === 'cycleTransfer' && control.kind === 'transfer') {
      const index = TRANSFER_MODES.indexOf(live.transferMode || 'auto');
      live.transferMode = TRANSFER_MODES[(index + 1) % TRANSFER_MODES.length];
      if (live.transferMode !== 'auto') {
        topologyChanged = this._setTransferActive(entry, live, live.transferMode);
      }
    } else if (action === 'resetBreaker' && live.breakerTripped) {
      live.breakerTripped = false;
      live.overloadTicks = 0;
      live.breakerRetryTicks = 0;
      topologyChanged = control.kind === 'disconnect' || control.kind === 'transfer';
      poweredOn = true;
    } else if (action === 'toggleBreaker' && control.breaker
        && control.kind !== 'disconnect' && !live.breakerTripped) {
      live.breakerOpen = live.breakerOpen !== true;
      live.overloadTicks = 0;
      live.breakerRetryTicks = 0;
      poweredOn = live.breakerOpen !== true;
    } else if (action === 'toggleGenerator' && control.source?.kind === 'generator') {
      live.generatorEnabled = live.generatorEnabled === false;
      poweredOn = live.generatorEnabled !== false;
    } else if (action === 'refuelGenerator' && control.source?.kind === 'generator') {
      const cost = { funding: GENERATOR_REFUEL_COST };
      if (!this.canAfford(cost)) return { ok: false, reason: 'unaffordable' };
      this.spend(cost);
      live.generatorFuelTicks = control.source.fuelTicks;
      return { ok: true, topologyChanged: false, requiresResolve: true, resourcesChanged: true };
    } else {
      return { ok: false };
    }
    if (topologyChanged) this.markTopologyDirty();
    return { ok: true, topologyChanged, requiresResolve: true, poweredOn };
  }
}

export default PowerReliabilityCoordinator;
