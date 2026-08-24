// Shared interpretation of instance-level electrical operating state.
//
// Content describes what a device CAN do (`electricalControl`,
// `electricalGroups`). The saved `state.powerReliability.devices[id]` entry
// describes what that particular placed device is doing right now. Keeping
// this interpretation in the utility layer lets discovery, the power solvers,
// and the game-side reliability coordinator agree without teaching data
// modules about mutable runtime state.

export const TRANSFER_MODES = Object.freeze(['auto', 'normal', 'backup']);

export function electricalDeviceState(worldState, placeableId) {
  return worldState?.powerReliability?.devices?.[placeableId] || null;
}

export function electricalSourceAvailability(worldState, placeable, def) {
  if (!worldState || !placeable || !def) return 1;
  const control = def.electricalControl || {};
  const live = electricalDeviceState(worldState, placeable.id) || {};
  if (live.breakerTripped === true || live.breakerOpen === true) return 0;

  if (control.source?.kind === 'grid' && (live.outageTicksRemaining || 0) > 0) {
    return 0;
  }
  if (control.source?.kind === 'generator') {
    if (live.generatorEnabled === false) return 0;
    if (!((live.generatorFuelTicks ?? control.source.fuelTicks ?? 0) > 0)) return 0;
  }
  return 1;
}

/**
 * Internal continuity groups for passive electrical ports on one device.
 * Each returned array is one isolated conductor. Separate arrays must never
 * be united: that is what lets a four-circuit tray carry four circuits rather
 * than shorting them into one bus.
 */
export function electricalInternalPortGroups(
  worldState, placeable, def, utilityType, passNames,
) {
  if (!Array.isArray(passNames) || passNames.length < 2) return [];
  const live = electricalDeviceState(worldState, placeable?.id) || {};
  const control = def?.electricalControl || {};

  if (control.kind === 'disconnect') {
    if (live.breakerTripped === true || live.breakerOpen === true
        || live.switchClosed === false) return [];
    return [passNames];
  }

  if (control.kind === 'transfer') {
    if (live.breakerTripped === true || live.breakerOpen === true) return [];
    const active = live.transferActive === 'backup' ? 'backup_in' : 'normal_in';
    const output = passNames.includes('pwr_out') ? 'pwr_out' : null;
    return output && passNames.includes(active) ? [[active, output]] : [];
  }

  const authored = def?.electricalGroups?.[utilityType];
  if (Array.isArray(authored)) {
    const allowed = new Set(passNames);
    return authored
      .map(group => (Array.isArray(group) ? group.filter(name => allowed.has(name)) : []))
      .filter(group => group.length >= 2);
  }

  return [passNames];
}
