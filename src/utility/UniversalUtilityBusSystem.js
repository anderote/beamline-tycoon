// Universal utility bus mutation/coordinator.
//
// The physical rack is utility-neutral. Each distinct utility connected to it
// claims one of four channels. A channel is represented by a real open-ended
// utility line along the rack path, so existing discovery/solvers account for
// source capacity and sink demand without a second network implementation.

export const UNIVERSAL_BUS_MAX_CHANNELS = 4;

export class UniversalUtilityBusSystem {
  constructor({ state, utilityLineSystem, emit = () => {}, log = () => {}, nextBusId } = {}) {
    this.state = state;
    this.utilityLineSystem = utilityLineSystem;
    this.emit = emit;
    this.log = log;
    this.nextBusId = nextBusId || (() => `ub_${Date.now()}`);
  }

  addBus({ path, taps = [], costFunding = 0 } = {}) {
    if (!Array.isArray(path) || path.length < 2) return null;
    const id = this.nextBusId();
    if (!Array.isArray(this.state.utilityBuses)) this.state.utilityBuses = [];
    this.state.utilityBuses.push({
      id, type: 'universalUtilityBus',
      path: path.map(p => ({ col: p.col, row: p.row })),
      taps: taps.map(t => ({ ...t, point: { ...t.point } })),
      channels: [],
      costFunding: Math.max(0, Number(costFunding) || 0),
    });
    this.emit('utilityLinesChanged', { busId: id });
    return id;
  }

  getBus(id) {
    return (this.state.utilityBuses || []).find(bus => bus?.id === id) || null;
  }

  channelLineId(busId, utilityType) {
    const bus = this.getBus(busId);
    const channel = bus?.channels?.find(c => c.utilityType === utilityType);
    if (!channel) return null;
    const line = this.state.utilityLines?.get?.(channel.lineId);
    return line ? channel.lineId : null;
  }

  ensureChannel(busId, utilityType) {
    const bus = this.getBus(busId);
    if (!bus || !utilityType) return { ok: false, reason: 'invalid_bus' };
    bus.channels = (bus.channels || []).filter(channel =>
      this.state.utilityLines?.get?.(channel.lineId));
    const existing = this.channelLineId(busId, utilityType);
    if (existing) return { ok: true, lineId: existing, created: false };
    const distinct = new Set((bus.channels || []).map(c => c.utilityType));
    if (!distinct.has(utilityType) && distinct.size >= UNIVERSAL_BUS_MAX_CHANNELS) {
      this.log('Universal Utility Bus already carries four utility types.', 'bad');
      return { ok: false, reason: 'bus_full' };
    }
    const slot = distinct.has(utilityType)
      ? (bus.channels.find(c => c.utilityType === utilityType)?.slot ?? 0)
      : distinct.size;
    const lineId = this.utilityLineSystem.addLine({
      utilityType, start: null, end: null, path: bus.path,
      manifold: {
        type: 'universalUtilityBus', busId, slot,
        trayFamily: 'universal-utility-bus', taps: bus.taps,
      },
    });
    if (!lineId) return { ok: false, reason: 'channel_rejected' };
    bus.channels = (bus.channels || []).filter(c => c.utilityType !== utilityType);
    bus.channels.push({ utilityType, lineId, slot });
    this.emit('utilityLinesChanged', { utilityType, busId });
    return { ok: true, lineId, created: true };
  }

  connectLine({ utilityType, line, busTapIds = {} } = {}) {
    const created = [];
    const tapLineIds = { ...(line?.tapLineIds || {}) };
    for (const end of ['start', 'end']) {
      const busId = busTapIds[end];
      if (!busId) continue;
      const channel = this.ensureChannel(busId, utilityType);
      if (!channel.ok) {
        for (const id of created) this.utilityLineSystem.removeLine(id);
        return null;
      }
      tapLineIds[end] = channel.lineId;
      if (channel.created) created.push(channel.lineId);
    }
    const lineId = this.utilityLineSystem.addLine({ ...line, utilityType, tapLineIds });
    if (!lineId) {
      for (const id of created) this.utilityLineSystem.removeLine(id);
      return null;
    }
    return lineId;
  }

  removeBus(busId) {
    const index = (this.state.utilityBuses || []).findIndex(bus => bus?.id === busId);
    if (index < 0) return false;
    const [bus] = this.state.utilityBuses.splice(index, 1);
    for (const channel of bus.channels || []) {
      if (this.state.utilityLines?.get?.(channel.lineId)) {
        this.utilityLineSystem.removeLine(channel.lineId);
      }
    }
    this.emit('utilityLinesChanged', { busId });
    return true;
  }
}

export default UniversalUtilityBusSystem;
