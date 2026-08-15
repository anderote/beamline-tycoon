// === BEAMLINE REGISTRY ===
// Lightweight metadata store for beamline identity, status, and physics state.
// The pipe graph (state.beamPipes + state.placeables) is the source of truth
// for component ordering. This registry holds per-beamline metadata that
// doesn't belong on individual placeables: name, accent color, run status,
// and aggregated physics results (beamState).

import { canonicalAccentFor } from './accent-colors.js';

/**
 * Returns a default beam state object for a given machine type.
 * All physics/economy fields start at sensible defaults.
 */
export function makeDefaultBeamState(machineType) {
  return {
    beamEnergy: 0,
    beamCurrent: 0,
    beamQuality: 1,
    dataRate: 0,
    luminosity: 0,
    totalLength: 0,
    totalEnergyCost: 0,
    beamOnTicks: 0,
    continuousBeamTicks: 0,
    uptimeFraction: 1,
    totalBeamHours: 0,
    totalDataCollected: 0,
    rawDataStored: 0,
    rawDataDropped: 0,
    totalRawDataIngested: 0,
    totalDataProcessed: 0,
    dataWorkload: 'balanced',
    serviceRevenue: 0,
    serviceContract: null,
    serviceBandScore: 0,
    servicePerformanceScore: 0,
    physicsAlive: true,
    physicsEnvelope: null,
    discoveryChance: 0,
    photonRate: 0,
    collisionRate: 0,
    nDiagnostics: 0,
    totalLossFraction: 0,
    componentHealth: {},
    felSaturated: false,
    machineType: machineType,
  };
}

export class BeamlineRegistry {
  constructor() {
    this.beamlines = new Map();  // id -> { id, name, accentColor, status, sourceId, beamState }
    this.nextBeamlineId = 1;
  }

  /**
   * Create a new beamline entry.
   *
   * `typeId` is the BEAMLINE_TYPES id the player chose in the New Beamline
   * picker, and it is the ONLY authority on this beamline's identity from here
   * on: `beamState.machineType` is derived from it at creation and must never
   * be re-derived by guessing at the component list. A null typeId means an
   * untyped (pre-picker or scenario-authored) beamline, which keeps whatever
   * machineType it was handed.
   */
  createBeamline(machineType, sourceId = null, typeId = null) {
    const id = `bl-${this.nextBeamlineId}`;
    const name = `Beamline-${this.nextBeamlineId}`;
    const accentColor = canonicalAccentFor(this.nextBeamlineId - 1);
    this.nextBeamlineId++;

    const entry = {
      id,
      name,
      accentColor,
      status: 'stopped',
      sourceId,
      typeId: typeId || null,
      beamState: makeDefaultBeamState(machineType),
    };

    this.beamlines.set(id, entry);
    return entry;
  }

  get(id) { return this.beamlines.get(id); }
  getAll() { return Array.from(this.beamlines.values()); }

  /** Find the registry entry whose sourceId matches. */
  getBySourceId(sourceId) {
    for (const entry of this.beamlines.values()) {
      if (entry.sourceId === sourceId) return entry;
    }
    return null;
  }

  removeBeamline(id) {
    return this.beamlines.delete(id);
  }

  toJSON() {
    const entries = [];
    for (const entry of this.beamlines.values()) {
      entries.push({
        id: entry.id,
        name: entry.name,
        accentColor: entry.accentColor,
        status: entry.status,
        sourceId: entry.sourceId,
        typeId: entry.typeId ?? null,
        beamState: JSON.parse(JSON.stringify(entry.beamState)),
      });
    }
    return { entries, nextBeamlineId: this.nextBeamlineId };
  }

  fromJSON(data) {
    this.beamlines = new Map();
    this.nextBeamlineId = data.nextBeamlineId;

    for (const e of data.entries) {
      let accentColor = e.accentColor;
      if (accentColor == null) {
        const match = /^bl-(\d+)$/.exec(e.id);
        const ordinal = match ? parseInt(match[1], 10) - 1 : 0;
        accentColor = canonicalAccentFor(ordinal);
      }
      this.beamlines.set(e.id, {
        id: e.id,
        name: e.name,
        accentColor,
        status: e.status,
        sourceId: e.sourceId ?? null,
        typeId: e.typeId ?? null,
        beamState: e.beamState,
      });
    }
  }
}
