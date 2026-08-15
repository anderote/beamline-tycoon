// src/data/utility-port-anchors.js
//
// Hand-authored 3D anchors for utility ports: where on a component's MODEL the
// connector sits, as opposed to where on its FOOTPRINT the sim thinks the port
// is (that stays `portWorldPosition` and is not affected by anything here).
//
// Nothing in this table can move a port. It moves the picture of one: the
// drawn connector, its dot and the cable end. Identity, snapping, pathing and
// pricing keep reading the sim's footprint point.
//
// Absent entries are NOT an error, and are the normal case: src/utility/
// port-anchors.js measures the component's own model — bounds for the height,
// a raycast against the shell for how far out the connector bolts on. Author an
// entry only when the measurement lands somewhere silly, which is usually a
// model whose silhouette does not describe where its hardware really is: a port
// that belongs at the base of a tall cryostat, or on the lid of a squat pump.
//
// Fields, all optional per port:
//   y      height in metres above ground for the connector centre
//   out    extra stand-off along the port's outward normal, in metres
//   lat    distance from the component's centreline out to the connector, in
//          LOCAL metres (the unrotated frame: the axis the port's side faces).
//          Overrides the raycast, so author it when the ray misses — a port
//          over an open gap in the shell, say. Clamped to the footprint.
//   along  position on the perpendicular local axis, in metres from the
//          footprint centre, signed. Overrides the port's own `offsetAlong`
//          fraction. Also clamped to the footprint.
//
// `lat`/`along` are in the component's local frame, NOT world space: they mean
// the same thing at every rotation, and port-anchors.js turns them by `dir`.
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
  // Electrical hardware uses readable terminal banks rather than model-bound
  // midpoints. Transformer secondaries sit high on the front cable side;
  // panels put branch plugs in a vertical front-edge strip and isolate the HV
  // gland low on the rear. These are presentation mounts only.
  padMountTransformer: {
    _default: { y: 0.78, lat: 0.42 },
    hv_out_1: { along: 0 },
  },
  facilityTransformer: {
    _default: { y: 1.55, lat: 0.82 },
    hv_out_1: { along: -0.25 }, hv_out_2: { along: 0.25 },
  },
  hvTransformer: {
    _default: { y: 1.42, lat: 0.82 },
    hv_out_1: { y: 1.25, along: -0.34 }, hv_out_2: { y: 1.25, along: 0.34 },
    hv_out_3: { y: 1.58, along: -0.34 }, hv_out_4: { y: 1.58, along: 0.34 },
  },
  gridIntertieTransformer: {
    _default: { y: 1.38, lat: 0.82 },
    hv_out_1: { y: 1.22, along: -0.36 }, hv_out_2: { y: 1.22, along: 0 },
    hv_out_3: { y: 1.22, along: 0.36 }, hv_out_4: { y: 1.58, along: -0.36 },
    hv_out_5: { y: 1.58, along: 0 }, hv_out_6: { y: 1.58, along: 0.36 },
  },
  switchgear: {
    _default: { y: 0.7, lat: 0.66 },
    hv_in: { y: 0.42, along: -0.28 },
    hv_out_1: { y: 0.55, along: 0.27 }, hv_out_2: { y: 0.92, along: 0.27 },
    hv_out_3: { y: 1.29, along: 0.27 }, hv_out_4: { y: 1.66, along: 0.27 },
  },
  // The SSA's logical HV port already exists. Mount it on the dedicated
  // conduit at the low rear corner so it cannot be mistaken for the tall RF
  // combining spine beside it.
  solidStateAmp: {
    _default: { y: 1.2, lat: 0.46, along: 0 },
    hv_in: { y: 0.37, along: 0.32 },
    rf_out: { y: 1.55, along: 0 },
  },
  powerPanel: {
    _default: { y: 0.5, lat: 0.19 }, hv_in: { y: 0.30, along: -0.15 },
    pwr_out_1: { y: 0.30, along: 0.15 }, pwr_out_2: { y: 0.62, along: 0.15 },
    pwr_out_3: { y: 0.94, along: 0.15 }, pwr_out_4: { y: 1.26, along: 0.15 },
  },
  sectionDistributionPanel: {
    _default: { y: 0.5, lat: 0.24 }, hv_in: { y: 0.32, along: -0.38 },
    pwr_out_1: { y: 0.32, along: 0.38 }, pwr_out_2: { y: 0.55, along: 0.38 },
    pwr_out_3: { y: 0.78, along: 0.38 }, pwr_out_4: { y: 1.01, along: 0.38 },
    pwr_out_5: { y: 1.24, along: 0.38 }, pwr_out_6: { y: 1.47, along: 0.38 },
  },
  mainDistributionPanel: {
    _default: { y: 0.5, lat: 0.26 }, hv_in: { y: 0.32, along: -0.56 },
    pwr_out_1: { y: 0.32, along: 0.56 }, pwr_out_2: { y: 0.52, along: 0.56 },
    pwr_out_3: { y: 0.72, along: 0.56 }, pwr_out_4: { y: 0.92, along: 0.56 },
    pwr_out_5: { y: 1.12, along: 0.56 }, pwr_out_6: { y: 1.32, along: 0.56 },
    pwr_out_7: { y: 1.52, along: 0.56 }, pwr_out_8: { y: 1.72, along: 0.56 },
  },
  mcc: {
    _default: { y: 0.7, lat: 0.41 }, hv_in: { y: 0.34, along: -0.68 },
    pwr_out_1: { y: 0.42, along: -0.58 }, pwr_out_2: { y: 0.78, along: -0.58 },
    pwr_out_3: { y: 1.14, along: -0.58 }, pwr_out_4: { y: 1.50, along: -0.58 },
    pwr_out_5: { y: 0.42, along: 0.58 }, pwr_out_6: { y: 0.78, along: 0.58 },
    pwr_out_7: { y: 1.14, along: 0.58 }, pwr_out_8: { y: 1.50, along: 0.58 },
  },
  ups: {
    _default: { y: 0.7, lat: 0.41 }, hv_in: { y: 0.34, along: -0.48 },
    pwr_out_1: { y: 0.72, along: 0.48 }, pwr_out_2: { y: 1.38, along: 0.48 },
  },
  powerBus: {
    _default: { y: 0.84, lat: 0.21 }, pwr_in: { y: 0.92, lat: 0.71, along: 0 },
    pwr_out_1: { along: -0.54 }, pwr_out_2: { along: -0.54 },
    pwr_out_3: { along: -0.18 }, pwr_out_4: { along: -0.18 },
    pwr_out_5: { along: 0.18 }, pwr_out_6: { along: 0.18 },
    pwr_out_7: { along: 0.54 }, pwr_out_8: { along: 0.54 },
  },
  spiderBox: {
    _default: { y: 0.12, lat: 0.22, along: 0 },
  },

  // Pumps are squat and top-connected.
  turboPump: { _default: { y: 0.85 } },
  roughingPump: { _default: { y: 0.5 } },
  ionPump: { _default: { y: 0.6 } },
  vacuumManifold: { _default: { y: 0.6 } },

  waveguideManifold: { _default: { y: 1.1 } },
  solidStateAmp: {
    _default: { y: 0.95, lat: 0.48 },
    // Dedicated low rear HV gland, kept clear of the four RF flanges above.
    hv_in: { y: 0.37, along: 0.32 },
    rf_out_1: { y: 0.78, along: -0.30 }, rf_out_2: { y: 0.78, along: -0.10 },
    rf_out_3: { y: 1.12, along: 0.10 }, rf_out_4: { y: 1.12, along: 0.30 },
  },
  pulsedKlystron: { _default: { y: 1.0 } },
  cwKlystron: { _default: { y: 1.0 } },
  multibeamKlystron: { _default: { y: 1.0 } },
  chiller: { _default: { y: 0.8 } },
  coolingTower: { _default: { y: 1.0 } },

  // === Measured against the 3D models ======================================
  // Everything below was authored after walking each type's ROLE_BUILDERS
  // output headless and reading the real world-space extents of its sub-meshes
  // (beam pipe at y = 1.0, stands from the floor up, cooling manifolds, top
  // waveguide runs). The heights quoted in the comments are those measured
  // spans, so a builder that moves its hardware invalidates the number here.

  // --- on-pipe hardware that hangs off the pipe, not off the floor ---------
  // These models have no geometry below ~0.8 m at all: mid-shell derivation
  // put their connector under the pipe in open air. Straight onto the part.
  bellows: { _default: { y: 1.0, out: 0.05 } },              // convolution 0.82..1.18, dead on the axis
  ict: { _default: { y: 1.0, out: 0.05 }, data_in: { y: 1.25 } },  // toroid 0.82..1.18; signal off the 1.18..1.30 stalk
  baGauge: { _default: { y: 1.22, out: 0.05 } },             // hot-filament tube 1.14..1.25, cable to the head
  coldCathodeGauge: { _default: { y: 1.2, out: 0.05 } },     // gauge body 1.07..1.27, HV lead on the body
  negPump: { _default: { y: 0.5 } },                         // cartridge 0.03..0.53, port out of its top
  tiSubPump: { _default: { y: 0.55 } },                      // filament head 0.535..0.625 caps a 0.51 body

  // Screens and scanners: the can straddles the pipe and the actuator and
  // camera sit on a head above it, so signal goes high and power stays at
  // the pipe.
  screen: { _default: { y: 1.0 }, data_in: { y: 1.35 } },    // pipe 0.82..1.18, camera head 1.18..1.73
  wireScanner: { _default: { y: 1.0 } },                     // whole model is 0.84..1.16 around the axis
  aperture: { _default: { y: 1.0 } },                        // jaws 0.65..1.35, centred on the axis
  emittanceFilter: { _default: { y: 1.0 } },                 // slit body 0.7..1.3
  velocitySelector: { _default: { y: 1.0 }, pwr_in: { y: 1.35 } },  // plates 0.72..1.28; HV stack 1.28..1.58

  // Magnets that are modelled as a plain box rather than a yoke. The box sits
  // on the floor and tops out at the beam line, so the derived 0.35 was down
  // by the skirt. Match the quadrupole/dipole family instead.
  solenoid: { _default: { y: 0.8 } },
  collimator: { _default: { y: 0.8 }, cool_in: { y: 0.6 } },
  chicane: { _default: { y: 0.8 } },
  undulator: { _default: { y: 0.8 }, cool_in: { y: 0.6 } },
  combinedFunctionMagnet: { _default: { y: 0.8 } },
  injectionSeptum: { _default: { y: 0.8 } },
  collisionPoint: { _default: { y: 0.8 }, data_in: { y: 1.0 } },
  energyDegrader: { _default: { y: 0.8 }, cool_in: { y: 0.6 } },
  scanningMagnet: { _default: { y: 0.85 }, cool_in: { y: 0.6 } },
  recirculationArc: { _default: { y: 0.85 } },               // arc magnets 0.78..1.32 on a 0.78 stand
  crystalChannelStage: { _default: { y: 0.9 } },             // goniometer block 0..1.66, pipe 0.75..1.4
  fastKicker: { _default: { y: 0.95 }, data_in: { y: 1.15 } },  // ferrite frame 0.81..1.69 around a 1.0 pipe
  finalFocusDoublet: { _default: { y: 0.9 }, cryo_in: { y: 0.7 } },  // coils 0.58..1.42 on a 0.69 stand
  plasmaAfterburner: { _default: { y: 0.9 }, cool_in: { y: 0.7 } },  // cell body 0..1.48, stand to 0.78

  // --- accelerating structures --------------------------------------------
  // Same split the pillbox already documents: waveguide onto the run along
  // the top of the structure, cooling onto the manifold just above the stand.
  rfCavity: { _default: { y: 0.95 }, rf_in: { y: 1.45 }, cool_in: { y: 0.6 } },       // cells 0.5..1.5, WG 1.5..1.72
  rfq: { _default: { y: 1.0 }, rf_in: { y: 1.5 }, cool_in: { y: 0.55 } },             // vanes 0.4..1.6, WG 1.55..1.9
  sbandStructure: { _default: { y: 0.95 }, rf_in: { y: 1.35 }, cool_in: { y: 0.6 } }, // copper 0.48..1.52
  cbandStructure: { _default: { y: 0.95 }, rf_in: { y: 1.3 }, cool_in: { y: 0.65 } }, // copper 0.56..1.44
  xbandStructure: { _default: { y: 0.95 }, rf_in: { y: 1.25 }, cool_in: { y: 0.75 } },// copper 0.66..1.34, tall 0.9 stand
  twoBeamModule: { _default: { y: 1.1 }, rf_in: { y: 1.45 }, cool_in: { y: 0.7 } },   // drive+main stack 0.81..1.9

  // Cryostats. The vessel is the tall part; the transfer line lands low where
  // the cold end and the valve box are, the coupler high on the shell — the
  // same shape as the `cryomodule` entry above.
  halfWaveResonator: { _default: { y: 1.1 }, rf_in: { y: 1.55 }, cryo_in: { y: 0.7 } },  // vessel 0.06..2.26
  srf650Cryomodule: { _default: { y: 1.15 }, rf_in: { y: 1.45 }, cryo_in: { y: 0.7 } },  // vessel 0.36..1.96
  srf805Cryomodule: { _default: { y: 1.15 }, rf_in: { y: 1.45 }, cryo_in: { y: 0.7 } },  // vessel 0.47..1.85
  cwCryomodule: { _default: { y: 1.15 }, rf_in: { y: 1.45 }, cryo_in: { y: 0.7 } },      // vessel 0.46..1.86
  nbSnCryomodule: { _default: { y: 1.1 }, rf_in: { y: 1.4 }, cryo_in: { y: 0.7 } },      // vessel 0.55..1.76
  srfLinacSector: { _default: { y: 1.15 }, rf_in: { y: 1.45 }, cryo_in: { y: 0.7 } },    // vessel 0.51..1.81

  // --- endpoints and big machines -----------------------------------------
  // A dump or a target is a squat block of shielding: the water goes in low
  // and close to the skid, and only the vacuum port belongs on the axis.
  beamStop: { _default: { y: 0.6 }, cool_in: { y: 0.55 }, vac_in: { y: 1.0 } },   // block 0.4..1.6 on a 0.4 skid
  target: { _default: { y: 0.9 }, cool_in: { y: 0.55 }, vac_in: { y: 1.0 }, data_in: { y: 1.2 } },  // cooling plate 0.46..0.53
  beamDump: { _default: { y: 0.5 } },                                            // 1.5 m shielding block, services at its foot
  faradayCup: { _default: { y: 1.0 }, data_in: { y: 1.3 }, pwr_in: { y: 0.85 } },// can 0.7..1.3, signal stalk to 1.485
  detector: { _default: { y: 1.2 }, cool_in: { y: 0.7 }, vac_in: { y: 1.0 }, data_in: { y: 1.5 } },  // barrel -0.33..2.48
  hawkingDetector: { _default: { y: 1.1 }, cool_in: { y: 0.7 }, vac_in: { y: 1.0 } },  // yoke 0..1.85, pipe stub at 1.0
  blackHoleChamber: { _default: { y: 1.2 }, cool_in: { y: 0.8 }, vac_in: { y: 1.0 } }, // chamber 0.69..2.25 on a 1.55 cradle

  // Machines still drawn as a plain box: the box stands on the floor and is
  // metres tall, so mid-shell derivation climbed a blank wall. Feed at the
  // base gland, RF and beam ports at working height.
  vanDeGraaff: { _default: { y: 0.7 }, vac_in: { y: 1.0 } },                     // 3 m column
  cockcroftWalton: { _default: { y: 0.7 }, cool_in: { y: 0.6 }, vac_in: { y: 1.0 } },  // 4 m rectifier stack
  cyclotron30: { _default: { y: 0.9 }, cool_in: { y: 0.6 } },                    // 3 m yoke
  cyclotron70: { _default: { y: 0.9 }, cool_in: { y: 0.6 } },                    // 4 m yoke
  cyclotron230: { _default: { y: 0.9 }, cool_in: { y: 0.6 } },                   // 4 m yoke
  positronSource: { _default: { y: 0.9 }, rf_in: { y: 1.4 }, cool_in: { y: 0.6 } },
  lwfaStation: { _default: { y: 0.9 }, cool_in: { y: 0.6 }, data_in: { y: 1.1 } },
  industrialLinac: { _default: { y: 0.85 }, rf_in: { y: 1.2 }, cool_in: { y: 0.7 } },  // 0.94 m tube centred on the axis

  // --- support plant -------------------------------------------------------
  // The other two bus heads, so all four read alike: powerBus 0.5 and
  // vacuumManifold 0.6 are already authored above.
  coolingManifold: { _default: { y: 0.5 } },
  fiberBus: { _default: { y: 0.55 } },

  // Cooling-plant anchors coincide with the visible header stubs authored in
  // cooling-builder.js. Keeping these local coordinates explicit prevents a
  // sparse/open model from recovering a nearby but unrelated shell surface.
  packageChiller: {
    _default: { y: 0.36, lat: 0.48 },
    cool_out_a: { along: -0.30 }, cool_out_b: { along: -0.10 },
    cool_out_c: { along: 0.10 }, cool_out_d: { along: 0.30 },
    cool_out_side: { along: -0.18 }, cool_out_side_2: { along: 0.18 },
  },
  lcwSkid: {
    _default: { y: 1.09, lat: 0.465 },
    cool_out: { along: -0.66 }, cool_out_2: { along: -0.22 },
    cool_out_3: { along: 0.22 }, cool_out_4: { along: 0.66 },
    cool_out_5: { along: -0.30 }, cool_out_6: { along: 0.30 },
  },
  dualCircuitChiller: {
    _default: { y: 0.54, lat: 0.72 },
    cool_out: { along: -0.50 }, cool_out_2: { along: -0.17 },
    cool_out_3: { along: 0.17 }, cool_out_4: { along: 0.50 },
    cool_out_5: { along: -0.25 }, cool_out_6: { along: 0.25 },
  },
  chiller: {
    _default: { y: 0.74, lat: 0.72 },
    cool_out: { along: -0.72 }, cool_out_2: { along: -0.30 },
    cool_out_3: { along: 0.15 }, cool_out_4: { along: 0.60 },
    cool_out_5: { along: -0.35 }, cool_out_6: { along: 0.35 },
  },
  fanCoilCooler: {
    _default: { y: 0.17, lat: 0.44 },
    cool_out: { along: -0.10 }, cool_out_2: { along: 0.10 },
  },
  dryCoolerBank: {
    _default: { y: 0.68, lat: 1.36 },
    cool_out: { along: -0.45 }, cool_out_2: { along: 0.45 },
  },
  coolingTower: {
    _default: { y: 0.15, lat: 0.95 },
    cool_out: { along: -0.80 }, cool_out_2: { along: 0.80 },
  },
  bakeoutSystem: { _default: { y: 0.5 } },  // 1 m trolley; its box's mid-shell is already 0.5
  areaMonitor: { _default: { y: 0.5 } },    // small head on a post — 0.35 sat on its bottom edge
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
