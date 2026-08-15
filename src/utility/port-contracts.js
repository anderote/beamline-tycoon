/**
 * Select a declared utility port by capability instead of by registry-specific
 * connector name. Object insertion order is the stable authored port order.
 *
 * @param {object} ports component `ports` map
 * @param {{utility: string, role?: string|string[], side?: string, index?: number}} selector
 * @returns {string|null}
 */
export function findUtilityPortName(ports, {
  utility,
  role = null,
  side = null,
  index = 0,
} = {}) {
  const roles = role == null ? null : new Set(Array.isArray(role) ? role : [role]);
  const matches = Object.entries(ports || {}).filter(([, port]) => {
    if (!port || port.utility !== utility) return false;
    if (roles && !roles.has(port.role)) return false;
    return side == null || port.side === side;
  });
  return matches[index]?.[0] || null;
}

/** Resolve an explicit port name or a capability selector against one def. */
export function resolveUtilityPortName(def, utility, ref = {}, defaultRole = null) {
  const ports = def?.ports || {};
  if (ref.port != null) {
    const declared = ports[ref.port];
    return declared?.utility === utility ? ref.port : null;
  }
  return findUtilityPortName(ports, {
    utility,
    role: ref.role ?? defaultRole,
    side: ref.side,
    index: ref.index ?? 0,
  });
}
