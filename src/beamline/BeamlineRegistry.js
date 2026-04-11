// === LEGACY: designer-internal use only ===
// This multi-beamline registry is no longer used by the main map. It survives
// because BeamlineDesigner and DesignPlacer still operate on Beamline instances
// internally. The main map's source of truth is Game.state.beamPipes +
// state.placeables (derived into state.beamline by Game._deriveBeamGraph).

// === BEAMLINE REGISTRY ===
// Manages multiple independent Beamline instances with shared tile occupancy.

import { Beamline } from './Beamline.js';
import { canonicalAccentFor, CANONICAL_ACCENTS } from './accent-colors.js';

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
    physicsAlive: true,
    physicsEnvelope: null,
    discoveryChance: 0,
    photonRate: 0,
    collisionRate: 0,
    totalLossFraction: 0,
    componentHealth: {},
    felSaturated: false,
    machineType: machineType,
  };
}

export class BeamlineRegistry {
  constructor() {
    this.beamlines = new Map();       // id -> { id, name, status, beamline, beamState }
    this.sharedOccupied = {};         // "col,row" -> beamlineId
    this.nextBeamlineId = 1;
  }

  /**
   * Create a new beamline entry and add it to the registry.
   * Returns the entry object.
   */
  createBeamline(machineType) {
    const id = `bl-${this.nextBeamlineId}`;
    const name = `Beamline-${this.nextBeamlineId}`;
    // Default color rotates through the 8 canonical swatches so the first
    // 8 beamlines are visually distinct without the player picking anything.
    const accentColor = canonicalAccentFor(this.nextBeamlineId - 1);
    this.nextBeamlineId++;

    const entry = {
      id,
      name,
      accentColor,
      status: 'stopped',
      beamline: new Beamline(),
      beamState: makeDefaultBeamState(machineType),
    };

    this.beamlines.set(id, entry);
    return entry;
  }

  /** Get a beamline entry by id. */
  get(id) {
    return this.beamlines.get(id);
  }

  /** Get all beamline entries as an array. */
  getAll() {
    return Array.from(this.beamlines.values());
  }

  /** Get all nodes across all beamlines. */
  getAllNodes() {
    const all = [];
    for (const entry of this.beamlines.values()) {
      all.push(...entry.beamline.getAllNodes());
    }
    return all;
  }

  /** Find which beamline entry owns a given node ID. */
  getBeamlineForNode(nodeId) {
    for (const entry of this.beamlines.values()) {
      const found = entry.beamline.getAllNodes().some(n => n.id === nodeId);
      if (found) return entry;
    }
    return undefined;
  }

  /** Mark tiles as occupied in the shared grid. */
  occupyTiles(beamlineId, node) {
    for (const t of node.tiles) {
      this.sharedOccupied[t.col + ',' + t.row] = beamlineId;
    }
  }

  /** Free tiles from the shared grid. */
  freeTiles(node) {
    for (const t of node.tiles) {
      delete this.sharedOccupied[t.col + ',' + t.row];
    }
  }

  /** Check if a tile is occupied in the shared grid. */
  isTileOccupied(col, row) {
    return this.sharedOccupied[col + ',' + row] !== undefined;
  }

  /** Remove a beamline and free all its tiles from the shared grid. */
  removeBeamline(id) {
    const entry = this.beamlines.get(id);
    if (!entry) return false;

    // Free all tiles owned by this beamline's nodes
    for (const node of entry.beamline.getAllNodes()) {
      this.freeTiles(node);
    }

    this.beamlines.delete(id);
    return true;
  }

  /** Serialize the registry to a plain JSON-safe object. */
  toJSON() {
    const entries = [];
    for (const entry of this.beamlines.values()) {
      entries.push({
        id: entry.id,
        name: entry.name,
        status: entry.status,
        beamline: entry.beamline.toJSON(),
        beamState: JSON.parse(JSON.stringify(entry.beamState)),
      });
    }
    return {
      entries,
      sharedOccupied: { ...this.sharedOccupied },
      nextBeamlineId: this.nextBeamlineId,
    };
  }

  /** Restore registry state from serialized data. */
  fromJSON(data) {
    this.beamlines = new Map();
    this.nextBeamlineId = data.nextBeamlineId;
    this.sharedOccupied = { ...data.sharedOccupied };

    for (const e of data.entries) {
      const beamline = new Beamline();
      beamline.fromJSON(e.beamline);
      this.beamlines.set(e.id, {
        id: e.id,
        name: e.name,
        status: e.status,
        beamline,
        beamState: e.beamState,
      });
    }
  }
}
