// Capability-based placement contract for equipment bolted directly to a
// utility port. Simulation snapping uses the ordinary logical port position;
// the stored vertical offset is presentation data and follows the host's
// authored connector height.

import { PLACEABLES } from '../data/placeables/index.js';
import { levelOf, levelWorldY, normalizeLevel } from '../game/storeys.js';
import { portAnchor3D } from './port-anchors.js';
import { getPortSpec, portApproachVec, portWorldPosition } from './ports.js';

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
  const anchor = portAnchor3D(host, def, portName);
  // The compact box is 0.5 m deep. Its back-face inlet lands directly on the
  // host tap when the centre is offset outward by half that depth.
  const worldX = position.x + outward.dCol * 0.25;
  const worldZ = position.z + outward.dRow * 0.25;
  return {
    utilityMount: {
      hostPlaceableId: host.id,
      portName,
      connectionKind: mountKind,
    },
    worldX,
    worldZ,
    // The transformer's local HV inlet is 0.55 m above its base.
    mountY: (anchor?.y ?? 1.55) + levelWorldY(levelOf(host)) - 0.55,
    dir: (directionIndex(outward) + 2) % 4,
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
