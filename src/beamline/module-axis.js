// src/beamline/module-axis.js
//
// Compute a beamline module's through-axis in world coordinates given its
// port definitions and placement direction. A module has a beam axis only
// if it has both an "entry-like" port (side=back) and an "exit-like" port
// (side=front) — sources and endpoints return null.

function rotate(vec, dir) {
  const d = ((dir % 4) + 4) % 4;
  switch (d) {
    case 0: return { dCol: vec.dCol, dRow: vec.dRow };
    case 1: return { dCol: -vec.dRow, dRow: vec.dCol };
    case 2: return { dCol: -vec.dCol, dRow: -vec.dRow };
    case 3: return { dCol: vec.dRow, dRow: -vec.dCol };
  }
}

export function moduleBeamAxis(def, dir = 0) {
  const ports = def?.ports;
  if (!ports) return null;
  const entry = Object.values(ports).find(p => p.side === 'back');
  const exit  = Object.values(ports).find(p => p.side === 'front');
  if (!entry || !exit) return null;
  const local = { dCol: 0, dRow: 1 };  // back → front in dir=0 local space
  return rotate(local, dir);
}

export function axisMatchesDirection(a, b) {
  if (!a || !b) return false;
  const same     = a.dCol ===  b.dCol && a.dRow ===  b.dRow;
  const opposite = a.dCol === -b.dCol && a.dRow === -b.dRow;
  return same || opposite;
}
