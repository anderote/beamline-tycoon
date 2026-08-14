// src/data/utility-port-anchors.js
//
// Hand-authored 3D anchors for utility ports: where on a component's MODEL the
// connector sits, as opposed to where on its FOOTPRINT the sim thinks the port
// is (that stays `portWorldPosition` and is not affected by anything here).
//
// Only the height and the outward stand-off are authored. The x/z stay the
// footprint-edge midpoint, so a port's identity, snapping, pathing and pricing
// are untouched — this table moves the picture, never the model.
//
// Absent entries are NOT an error: src/utility/port-anchors.js derives a height
// from the component's own model bounds. Author an entry when the derived
// mid-shell height lands somewhere silly — a port that should be at the base of
// a tall cryostat, or on the lid of a squat pump.
//
// Fields, all optional per port:
//   y    height in metres above ground for the connector centre
//   out  extra stand-off along the port's outward normal, in metres
//
// A `_default` entry applies to every utility port on that type.

export const PORT_ANCHOR_OVERRIDES = {
  // --- on-pipe modules -----------------------------------------------------
  // These straddle the beam pipe, whose centreline is ~1 m up; their services
  // land on the yoke just under it rather than at mid-model height.
  quadrupole: { _default: { y: 0.85 } },
  sextupole: { _default: { y: 0.85 } },
  dipole: { _default: { y: 0.8 } },
  bpm: { _default: { y: 0.75, out: 0.05 } },
  blmReadout: { _default: { y: 0.75, out: 0.05 } },

  // RF structures take their waveguide high on the body and their cooling low,
  // which is the one place the two ports genuinely want different heights.
  pillboxCavity: { _default: { y: 0.95 }, rf_in: { y: 1.25 }, cool_in: { y: 0.55 } },
  ellipticalSrfCavity: { _default: { y: 1.0 }, rf_in: { y: 1.3 }, cool_in: { y: 0.6 } },
  spokeCavity: { _default: { y: 0.95 }, rf_in: { y: 1.25 } },
  buncher: { _default: { y: 0.9 }, rf_in: { y: 1.2 } },
  cryomodule: { _default: { y: 1.15 }, cryo_in: { y: 0.7 }, rf_in: { y: 1.45 } },

  // --- support plant -------------------------------------------------------
  // Tall cabinets: feed at the bottom where the gland plate is, not mid-face.
  hvTransformer: { _default: { y: 0.7 } },
  switchgear: { _default: { y: 0.7 } },
  powerBus: { _default: { y: 0.5 } },

  // Pumps are squat and top-connected.
  turboPump: { _default: { y: 0.85 } },
  roughingPump: { _default: { y: 0.5 } },
  ionPump: { _default: { y: 0.6 } },
  vacuumManifold: { _default: { y: 0.6 } },

  waveguideManifold: { _default: { y: 1.1 } },
  pulsedKlystron: { _default: { y: 1.0 } },
  cwKlystron: { _default: { y: 1.0 } },
  multibeamKlystron: { _default: { y: 1.0 } },
  chiller: { _default: { y: 0.8 } },
  coolingTower: { _default: { y: 1.0 } },
};

/**
 * The authored anchor for one port, or null. `_default` fills in for ports the
 * table does not name individually.
 */
export function portAnchorOverride(type, portName) {
  const entry = PORT_ANCHOR_OVERRIDES[type];
  if (!entry) return null;
  const specific = entry[portName];
  const fallback = entry._default;
  if (!specific && !fallback) return null;
  return { ...(fallback || {}), ...(specific || {}) };
}

export default PORT_ANCHOR_OVERRIDES;
