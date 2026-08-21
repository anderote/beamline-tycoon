// Shared geometry for hardware mounted on a wall face.
//
// This is deliberately renderer-free. Placement, utility-port routing and the
// Three.js builders all need the same answer for a wall slot's position and
// orientation; keeping it here prevents the simulation from importing a
// renderer module merely to locate a connector.

/** Match WallBuilder's physical slab depth, plus a small no-z-fight gap. */
export function wallFixtureFaceOffset(wallDef) {
  const thickness = wallDef?.insetSubtiles
    ? 0.5 * wallDef.insetSubtiles
    : Math.max((Number(wallDef?.thickness) || 1.5) * 0.05, 0.025);
  return thickness / 2 + 0.025;
}

/** The quarter-turn direction whose local +Z points into the mounting tile. */
export function wallFixtureDir(site) {
  return ({ n: 0, e: 1, s: 2, w: 3 })[site?.edge] ?? 0;
}

/**
 * World pose for one of four sub-slots on a wall face. The edge is expressed
 * from the tile whose side the fixture protrudes into, which naturally makes
 * the two aliases of a physical wall its two independently usable faces.
 */
export function wallFixturePose(site, faceOffset = site?.faceOffset ?? 0.0625) {
  if (!site || !['n', 'e', 's', 'w'].includes(site.edge)) return null;
  const col = Math.floor(site.col || 0);
  const row = Math.floor(site.row || 0);
  const off = Math.max(0, Math.min(3, Math.floor(site.off ?? 1)));
  const f = (off + 0.5) / 4;
  const x0 = col * 2;
  const z0 = row * 2;
  switch (site.edge) {
    case 'n': return { x: x0 + 2 * f, z: z0 + faceOffset, yaw: 0 };
    case 'e': return { x: x0 + 2 - faceOffset, z: z0 + 2 * f, yaw: -Math.PI / 2 };
    case 's': return { x: x0 + 2 - 2 * f, z: z0 + 2 - faceOffset, yaw: Math.PI };
    case 'w': return { x: x0 + faceOffset, z: z0 + 2 - 2 * f, yaw: Math.PI / 2 };
    default: return null;
  }
}

/** Distance from a wall centre-plane to a cable terminal clear of the slab. */
export function wallPassThroughTerminalOffset(site, terminalClearance = 0.08) {
  const faceOffset = Number.isFinite(site?.faceOffset) ? Math.abs(site.faceOffset) : 0.0625;
  return faceOffset + Math.max(0, terminalClearance);
}

/**
 * Alias-independent identity for one quarter-wall slot. Opposite faces return
 * the same key, including their reversed `off` numbering.
 */
export function physicalWallFixtureSlotKey(site) {
  const pose = wallFixturePose(site, 0);
  if (!pose) return null;
  return `${Math.round(pose.x * 4)},${Math.round(pose.z * 4)}`;
}
