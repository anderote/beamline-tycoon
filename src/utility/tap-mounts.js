// Capability-based placement contract for equipment bolted directly to a
// utility port. Simulation snapping uses the ordinary logical port position;
// the stored vertical offset is presentation data and follows the host's
// authored connector height.

import { PLACEABLES } from '../data/placeables/index.js';
import {
  portAnchorOverride,
  POWER_HV_INPUT_MOUNTS,
} from '../data/utility-port-anchors.js';
import { levelOf, levelWorldY, normalizeLevel } from '../game/storeys.js';
import { portAnchor3D } from './port-anchors.js';
import {
  getPortSpec,
  placeableCenterWorld,
  placeableDirection,
  portApproachVec,
  portWorldPosition,
  rotateLocalOffset,
} from './ports.js';

export const HV_TAP_MOUNT_KIND = 'hvDistributionTap';
export const TAP_MOUNT_SNAP_DISTANCE_CELLS = 0.8;

function lineClaimsPort(lines, placeableId, portName, ignoreMountConnectionPlaceableId = null) {
  const iter = lines?.values ? lines.values() : (lines || []);
  for (const line of iter) {
    if (line?.mountConnectionPlaceableId === ignoreMountConnectionPlaceableId) continue;
    for (const ref of [line?.start, line?.end]) {
      if (ref?.placeableId === placeableId && ref?.portName === portName) return true;
    }
  }
  return false;
}

function directionIndex(vec) {
  if (vec?.dCol === 1) return 1;
  if (vec?.dRow === 1) return 2;
  if (vec?.dCol === -1) return 3;
  return 0;
}

function authoredHostAnchor(host, def, portName, fallback) {
  const mount = portAnchorOverride(host.type, portName);
  if (!Number.isFinite(mount?.localX) || !Number.isFinite(mount?.localZ)) {
    return fallback;
  }
  const centre = placeableCenterWorld(host, def);
  if (!centre) return fallback;
  const offset = rotateLocalOffset(
    { x: mount.localX, z: mount.localZ },
    placeableDirection(host, def),
  );
  return {
    x: centre.x + offset.x,
    y: Number.isFinite(mount.y) ? mount.y : fallback?.y,
    z: centre.z + offset.z,
  };
}

export function utilityTapMountCandidates(state, mountKind = HV_TAP_MOUNT_KIND, {
  level = 0,
  ignorePlaceableId = null,
} = {}) {
  const wantedLevel = normalizeLevel(level);
  const occupied = new Set((state?.placeables || [])
    .filter(entry => entry.id !== ignorePlaceableId && entry.utilityMount)
    .map(entry => `${entry.utilityMount.hostPlaceableId}:${entry.utilityMount.portName}`));
  const out = [];
  for (const host of state?.placeables || []) {
    if (!host || host.id === ignorePlaceableId || levelOf(host) !== wantedLevel) continue;
    const def = PLACEABLES[host.type];
    for (const [portName, spec] of Object.entries(def?.ports || {})) {
      if (spec?.connectionKind !== mountKind || spec.utility !== 'hvCable') continue;
      if (occupied.has(`${host.id}:${portName}`)) continue;
      if (lineClaimsPort(state?.utilityLines, host.id, portName, ignorePlaceableId)) continue;
      const position = portWorldPosition(host, def, portName);
      const outward = portApproachVec(host, def, portName);
      if (!position || !outward) continue;
      out.push({ host, def, portName, spec, position, outward });
    }
  }
  return out;
}

export function resolveUtilityTapMount(state, mount, {
  mountKind = HV_TAP_MOUNT_KIND,
  level = 0,
  ignorePlaceableId = null,
} = {}) {
  if (!mount?.hostPlaceableId || !mount?.portName) return null;
  const candidate = utilityTapMountCandidates(state, mountKind, {
    level, ignorePlaceableId,
  }).find(item => item.host.id === mount.hostPlaceableId && item.portName === mount.portName);
  if (!candidate) return null;
  const { host, def, portName, position, outward } = candidate;
  const measuredAnchor = portAnchor3D(host, def, portName);
  const anchor = authoredHostAnchor(host, def, portName, measuredAnchor);
  const dir = (directionIndex(outward) + 2) % 4;
  const inlet = POWER_HV_INPUT_MOUNTS.poleMountTransformer;
  const inletOffset = rotateLocalOffset(
    { x: inlet.localX, z: inlet.localZ }, dir,
  );
  // Align the service box's authored inlet directly with the host's authored
  // side tap. Using the host footprint edge here left a conspicuous gap on
  // narrow wood poles even though the direct connection has no cable.
  const worldX = (anchor?.x ?? position.x) - inletOffset.x;
  const worldZ = (anchor?.z ?? position.z) - inletOffset.z;
  return {
    utilityMount: {
      hostPlaceableId: host.id,
      portName,
      connectionKind: mountKind,
    },
    worldX,
    worldZ,
    mountY: (anchor?.y ?? 1.55) + levelWorldY(levelOf(host)) - inlet.y,
    dir,
    col: Math.floor(worldX / 2),
    row: Math.floor(worldZ / 2),
    subCol: 0,
    subRow: 0,
    linePoint: { col: position.x / 2, row: position.z / 2 },
  };
}

export function findUtilityTapMount(state, cursorGrid, options = {}) {
  if (!Number.isFinite(cursorGrid?.col) || !Number.isFinite(cursorGrid?.row)) return null;
  let best = null;
  for (const candidate of utilityTapMountCandidates(
    state, options.mountKind || HV_TAP_MOUNT_KIND, options,
  )) {
    const col = candidate.position.x / 2;
    const row = candidate.position.z / 2;
    const distance = Math.hypot(cursorGrid.col - col, cursorGrid.row - row);
    if (distance > (options.maxDistanceCells || TAP_MOUNT_SNAP_DISTANCE_CELLS)) continue;
    if (!best || distance < best.distance) {
      best = { candidate, distance };
    }
  }
  return best ? resolveUtilityTapMount(state, {
    hostPlaceableId: best.candidate.host.id,
    portName: best.candidate.portName,
  }, options) : null;
}

export function isUtilityTapMountDefinition(def) {
  return def?.mount === 'utilityTap' && typeof def.utilityTapMount === 'string';
}

export function mountedConnectionLine(state, placeableId) {
  const iter = state?.utilityLines?.values ? state.utilityLines.values() : [];
  for (const line of iter) {
    if (line?.mountConnectionPlaceableId === placeableId) return line;
  }
  return null;
}

export function utilityTapSpec(state, mount) {
  const host = state?.placeables?.find(entry => entry.id === mount?.hostPlaceableId);
  const def = host && PLACEABLES[host.type];
  return def && getPortSpec(def, mount.portName);
}
