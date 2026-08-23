// Display-only operational status for placed objects and their utility groups.
//
// This module interprets already-published simulation state. It does not
// discover topology or recompute utility capacity: exact sink faults come from
// utilityPortIssues, while connected-network errors and saved electrical state
// provide the presentation context needed for source/pass-through ports.

import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { utilityPortIssues } from '../utility/port-issues.js';

export const OPERATIONAL_STATUS = Object.freeze({
  healthy: Object.freeze({
    tone: 'healthy', label: 'Operating normally', color: '#44ff88', rank: 0,
  }),
  warning: Object.freeze({
    tone: 'warning', label: 'Needs attention', color: '#ffcc44', rank: 1,
  }),
  critical: Object.freeze({
    tone: 'critical', label: 'Not operating', color: '#ff5555', rank: 2,
  }),
});

const issueCache = new WeakMap();

function status(tone, detail) {
  return { ...OPERATIONAL_STATUS[tone], detail };
}

function worse(a, b) {
  return (b?.rank ?? -1) > (a?.rank ?? -1) ? b : a;
}

function networkPorts(network) {
  const out = [];
  for (const collection of [network?.ports, network?.sources, network?.sinks]) {
    for (const port of collection || []) out.push(port);
  }
  return out;
}

function portKey(port) {
  return port?.portKey || (port?.placeableId && port?.portName
    ? `${port.placeableId}:${port.portName}` : '');
}

function groupKey(utilityType, role) {
  return `${utilityType}:${role}`;
}

function issuesForEntry(state, entry) {
  if (!state || typeof state !== 'object' || !entry?.id) return [];
  let cached = issueCache.get(state);
  if (!cached
      || cached.tick !== state.tick
      || cached.unwiredSinks !== state.unwiredSinks
      || cached.utilityNetworks !== state.utilityNetworks
      || cached.utilityNetworkData !== state.utilityNetworkData) {
    cached = {
      tick: state.tick,
      unwiredSinks: state.unwiredSinks,
      utilityNetworks: state.utilityNetworks,
      utilityNetworkData: state.utilityNetworkData,
      byEntry: new Map(),
    };
    issueCache.set(state, cached);
  }
  if (!cached.byEntry.has(entry.id)) {
    cached.byEntry.set(entry.id, utilityPortIssues(
      state,
      new Map([[entry.id, entry]]),
      getUtilityPortsV2,
    ).filter(issue => issue.placeableId === entry.id));
  }
  return cached.byEntry.get(entry.id);
}

function connectedNetworksFor(state, entryId, utilityType, portNames) {
  const wanted = new Set(portNames.map(name => `${entryId}:${name}`));
  return (state?.utilityNetworks?.get?.(utilityType) || []).filter(network =>
    networkPorts(network).some(port => wanted.has(portKey(port))));
}

function connectedNetworkStatus(state, utilityType, networks) {
  if (!networks.length) return null;
  const flows = networks
    .map(network => state?.utilityNetworkData?.get?.(utilityType)?.get?.(network.id))
    .filter(Boolean);
  if (!flows.length) return status('warning', 'Awaiting network data');

  let result = status('healthy', 'Connected');
  for (const flow of flows) {
    const errors = Array.isArray(flow.errors) ? flow.errors.filter(Boolean) : [];
    const qualities = Object.values(flow.perSinkQuality || {})
      .filter(value => Number.isFinite(value));
    const allUnserved = qualities.length > 0 && qualities.every(value => value <= 0);
    if (errors.some(error => error.severity === 'hard') || allUnserved) {
      result = worse(result, status('critical', 'Connected network is not operating'));
    } else if (errors.length > 0 || qualities.some(value => value < 1)) {
      result = worse(result, status('warning', 'Connected network needs attention'));
    }
  }
  return result;
}

function deviceStatus(state, entry, health) {
  let result = status('healthy', 'Operating normally');
  if (entry?.beamlineEnabled === false) {
    result = worse(result, status('critical', 'Switched off · acting as beam pipe'));
  }
  if (entry?.needsCommissioning === true) {
    result = worse(result, status('critical', 'Commissioning required'));
  }
  if (Number.isFinite(health)) {
    if (health <= 0) result = worse(result, status('critical', 'Broken'));
    else if (health < 100) {
      result = worse(result, status('warning', `Needs maintenance · ${Math.round(health)}% health`));
    }
  }

  const live = state?.powerReliability?.devices?.[entry?.id];
  if (!live) return result;
  if (live.breakerTripped === true) {
    result = worse(result, status('critical', 'Breaker tripped'));
  }
  if (live.switchClosed === false) {
    result = worse(result, status('critical', 'Switch open'));
  }
  if ((live.outageTicksRemaining || 0) > 0) {
    result = worse(result, status('critical', 'Grid outage'));
  }
  if (live.generatorEnabled === false) {
    result = worse(result, status('critical', 'Standby generator disabled'));
  } else if (Number.isFinite(live.generatorFuelTicks)) {
    if (live.generatorFuelTicks <= 0) {
      result = worse(result, status('critical', 'Out of fuel'));
    }
  }
  if (Number.isFinite(live.batteryChargeTicks)) {
    if (live.batteryChargeTicks <= 0) {
      // A depleted UPS can still pass healthy grid power, so this is an
      // attention state. If upstream power is also absent, the published
      // sink/source flow raises the equipment to critical below.
      result = worse(result, status('warning', 'Backup battery depleted'));
    }
  }
  if (live.transferActive === 'backup') {
    result = worse(result, status('warning', 'Running on backup power'));
  }
  return result;
}

/**
 * Return a single overall status plus one status per utility/direction group.
 * Group keys match componentUtilityPortGroups: `${utilityType}:${role}`.
 */
export function placeableOperationalStatus(state, entry, { health } = {}) {
  const base = deviceStatus(state, entry, health);
  const ports = getUtilityPortsV2(entry?.type);
  const groups = new Map();
  for (const [name, port] of Object.entries(ports)) {
    if (!port?.utility || !port?.role) continue;
    const key = groupKey(port.utility, port.role);
    const group = groups.get(key) || {
      utilityType: port.utility, role: port.role, portNames: [],
    };
    group.portNames.push(name);
    groups.set(key, group);
  }

  // Mousemove can request the same tooltip dozens of times between solves.
  // Cache only the published issue projection, invalidating when any of its
  // three authoritative state references changes.
  const issues = issuesForEntry(state, entry);
  const issueByPort = new Map(issues.map(issue => [issue.portName, issue]));
  const groupStatuses = {};
  let overall = base;

  for (const group of groups.values()) {
    let groupStatus = base;
    const connected = connectedNetworksFor(
      state, entry.id, group.utilityType, group.portNames,
    );

    if (group.role === 'sink') {
      for (const portName of group.portNames) {
        const issue = issueByPort.get(portName);
        if (issue?.severity === 'critical') {
          groupStatus = worse(groupStatus, status('critical', 'Required connection has no service'));
        } else if (issue?.severity === 'warning') {
          groupStatus = worse(groupStatus, status('warning', 'Required connection is under-served'));
        }
      }
      if (!connected.length) {
        groupStatus = worse(groupStatus, status('critical', 'Required connection is not connected'));
      } else if (!(state?.utilityNetworkData instanceof Map)) {
        groupStatus = worse(groupStatus, status('warning', 'Awaiting network data'));
      }
    } else {
      if (!connected.length) {
        groupStatus = worse(groupStatus, status('warning', group.role === 'source'
          ? 'Supply is available but not connected'
          : 'Pass-through is not connected'));
      } else {
        groupStatus = worse(
          groupStatus,
          connectedNetworkStatus(state, group.utilityType, connected),
        );
      }
    }

    groupStatuses[groupKey(group.utilityType, group.role)] = groupStatus;
    overall = worse(overall, groupStatus);
  }

  return { ...overall, groups: groupStatuses };
}
