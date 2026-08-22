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
//   localX/localZ  exact model-local connector coordinates. These bypass the
//          side-derived lat/along position for visible authored hardware such
//          as a top cryogenic bayonet. They remain presentation-only.
//   normal model-local outward unit vector `{ x, y, z }`. Omit for the normal
//          horizontal side direction. `{ x: 0, y: 1, z: 0 }` mounts a fitting
//          on top-facing hardware. X/Z rotate with the placeable; Y does not.
//   out    extra stand-off along the port's outward normal, in metres
//   lat    distance from the component's centreline out to the connector, in
//          LOCAL metres (the unrotated frame: the axis the port's side faces).
//          Overrides the raycast, so author it when the ray misses — a port
//          over an open gap in the shell, say. Zero deliberately places
//          hanging hardware on the centreline. Clamped to the footprint.
//   along  position on the perpendicular local axis, in metres from the
//          footprint centre, signed. Overrides the port's own `offsetAlong`
//          fraction. Also clamped to the footprint.
//   allowOutsideFootprint  permits an authored lat/along mount on projecting
//          physical hardware such as an overhead support's crossarm.
//
// `lat`/`along`, `localX`/`localZ`, and `normal` are in the component's local
// frame, NOT world space: they mean the same thing at every rotation, and
// port-anchors.js turns their horizontal components by `dir`.
//
// A `_default` entry applies to every utility port on that type.

import { RF_PORT_STANDARDS } from './rf-port-standards.js';
import { BEAMLINE_COMPONENTS_RAW } from './beamline-components.raw.js';
import {
  DISTRIBUTION_FRONT_TERMINAL_LAYOUTS,
  DISTRIBUTION_TOP_INPUT_LAYOUTS,
} from './distribution-output-layout.js';

const STANDARD_RF_FEED_Y = RF_PORT_STANDARDS.standardFeed.heightMeters;

function roofTerminalAnchor({ x, y, z }) {
  return {
    y, localX: x, localZ: z,
    normal: { x: 0, y: 1, z: 0 },
  };
}

function frontTerminalAnchor({ x, y, z }) {
  return {
    y, localX: x, localZ: z,
    normal: { x: 0, y: 0, z: 1 },
  };
}

function frontTerminalAnchorBank(type, prefix) {
  return Object.fromEntries(DISTRIBUTION_FRONT_TERMINAL_LAYOUTS[type]
    .map((terminal, index) => [
      `${prefix}_${index + 1}`, frontTerminalAnchor(terminal),
    ]));
}

const TOP_NORMAL = Object.freeze({ x: 0, y: 1, z: 0 });

// The compact pad transformer keeps a reachable service-height roof bushing.
// Distribution inputs remain on their model-specific roof caps.
const COMPACT_HV_INPUT_Y = 1.55;

// All six straight-rack cable attachments share the crossbar terminal height.
export const INDOOR_HV_RACK_TERMINAL_Y = 2.00;

export const POWER_HV_INPUT_MOUNTS = Object.freeze({
  ...Object.fromEntries(Object.entries(DISTRIBUTION_TOP_INPUT_LAYOUTS)
    .map(([type, layout]) => [type, Object.freeze(roofTerminalAnchor(layout.input))])),
  // This service box is bolted straight to a host-side tap; its inlet faces
  // back into the tap instead of upward like a floor cabinet's roof bushing.
  poleMountTransformer: Object.freeze({
    y: 0.55, localX: 0, localZ: -0.25,
    normal: Object.freeze({ x: 0, y: 0, z: -1 }),
  }),
  padMountTransformer: Object.freeze({
    y: COMPACT_HV_INPUT_Y, localX: 0, localZ: -0.20, normal: TOP_NORMAL,
  }),
  hvTransformer: Object.freeze({
    y: 1.85, localX: 0, localZ: -0.35, normal: TOP_NORMAL,
  }),
  facilityTransformer: Object.freeze({
    y: 1.85, localX: 0, localZ: -0.35, normal: TOP_NORMAL,
  }),
  gridIntertieTransformer: Object.freeze({
    y: 1.85, localX: 0, localZ: -0.35, normal: TOP_NORMAL,
  }),
});

export const INDOOR_HV_RACK_TAP_MOUNTS = Object.freeze({
  hv_tap_left: Object.freeze({
    y: INDOOR_HV_RACK_TERMINAL_Y, localX: -0.98, localZ: 0,
    normal: Object.freeze({ x: -1, y: 0, z: 0 }),
  }),
  hv_tap_right: Object.freeze({
    y: INDOOR_HV_RACK_TERMINAL_Y, localX: 0.98, localZ: 0,
    normal: Object.freeze({ x: 1, y: 0, z: 0 }),
  }),
});

export const UTILITY_POLE_HV_TAP_MOUNT = Object.freeze({
  y: COMPACT_HV_INPUT_Y, localX: 0, localZ: 0.30,
  normal: Object.freeze({ x: 0, y: 0, z: 1 }),
});

export const PORT_GEOMETRY_CLASS = Object.freeze({
  EXPLICIT_HARDWARE: 'explicit-hardware',
  GENERATED_HARDWARE: 'generated-hardware',
  UNREVIEWED: 'unreviewed',
});

// RF windows and cryogenic bayonets/headers are large, defining parts of the
// machine silhouette, so every beamline sink must name their exact mount.
// Power, cooling, vacuum, and data terminate in the utility-specific fitting
// generated by port-fitting-builder; shell measurement plus the authored
// height/face is their intentional geometry rather than an unstyled fallback.
const EXACT_HARDWARE_UTILITIES = new Set(['rfWaveguide', 'cryoTransfer']);
const GENERATED_HARDWARE_UTILITIES = new Set([
  'powerCable', 'hvCable', 'coolingWater', 'waterSupplyPipe', 'vacuumPipe', 'dataFiber',
]);

// RF source cabinets and the four-way manifold deliberately use the generated
// rectangular flange as their visible output hardware. Beamline RF sinks are
// excluded: their coupler windows are defining model geometry and stay exact.
const GENERATED_DEFINING_HARDWARE_PORTS = new Set([
  'magnetron.rf_out',
  'widebandDriverAmp.rf_out',
  'lowBandBuncherAmp.rf_out',
  'slac5045Klystron.rf_out',
  'twt.rf_out',
  'pulsedKlystron.rf_out',
  'cwKlystron.rf_out',
  'iot.rf_out',
  'waveguideManifold.bus_back',
  'waveguideManifold.bus_front',
  'waveguideManifold.bus_left',
  'waveguideManifold.bus_right',
  'multibeamKlystron.rf_out',
  'highPowerSSA.rf_out',
  'gyrotron.rf_out',
]);

// Generated beamline fittings still need physically meaningful service bands.
// Vacuum tees meet the beam chamber at the 1 m beam axis; cooling manifolds
// stay low beside coils/heat sinks; data pickup boxes sit above power hardware.
// Exact per-port entries below win over these family defaults.
const BEAMLINE_SERVICE_BANDS = Object.freeze({
  vac_in: Object.freeze({ y: 1.0 }),
  cool_in: Object.freeze({ y: 0.6 }),
  hot_out: Object.freeze({ y: 0.65 }),
  data_in: Object.freeze({ y: 1.2 }),
});

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
  pillboxCavity: {
    _default: { y: 0.95 }, rf_in: { y: STANDARD_RF_FEED_Y, lat: 0.5, along: 0 }, cool_in: { y: 0.55 },
  },
  buncher: { _default: { y: 0.9 }, rf_in: { y: STANDARD_RF_FEED_Y, lat: 0.5, along: 0 } },
  ncRfGun: { _default: { y: 0.9 }, rf_in: { y: 1.08, lat: 0.63, along: 0.02 } },
  srfGun: {
    _default: { y: 1.0 }, rf_in: { y: 1.05, lat: 0.76, along: 0.38 },
    cryo_in: {
      y: 1.84, localX: 0, localZ: -0.2,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  ecrIonSource: { _default: { y: 0.9 }, rf_in: { y: 1.05, lat: 0.77, along: -0.49 } },
  // The TESLA module's visible fundamental-power-coupler row is on local -X
  // at beam height. The one routable feed lands on the first window beside
  // the module centre instead of floating above the vacuum jacket near its
  // downstream end.
  cryomodule: {
    _default: { y: 1.15 },
    // Helium-return header on the +X shoulder of the vessel.
    cryo_in: {
      y: 1.5, localX: 0.55, localZ: 0,
      normal: { x: 1, y: 0, z: 0 },
    },
    rf_in: { y: 1.0, lat: 0.76, along: 0.390625 },
  },

  // Cryogenic plant outlets coincide with visible bayonet caps rather than a
  // generic point on the refrigerator cabinet.
  ln2Dewar: {
    cryo_out: {
      y: 0.21, localX: 0.48, localZ: 0,
      normal: { x: 1, y: 0, z: 0 },
    },
  },
  cryocooler: {
    _default: { y: 0.8 },
    cryo_out: {
      y: 0.71, localX: 0.495, localZ: 0,
      normal: { x: 1, y: 0, z: 0 },
    },
  },
  ln2Precooler: {
    _default: { y: 0.75 },
    cryo_out: {
      y: 0.75, localX: 0, localZ: 0.65,
      normal: { x: 0, y: 0, z: 1 },
    },
  },
  heCompressor: {
    _default: { y: 0.8 },
    cryo_out: {
      y: 0.30, localX: 0.86, localZ: 1.48,
      normal: { x: 0, y: 0, z: 1 },
    },
  },
  coldBox4K: {
    _default: { y: 0.8 },
    cryo_out: {
      y: 0.62, localX: 0.49, localZ: 1.32,
      normal: { x: 1, y: 0, z: 0 },
    },
  },
  coldBox2K: {
    _default: { y: 0.8 },
    cryo_out: {
      y: 0.78, localX: 0.15, localZ: 0.95,
      normal: { x: 1, y: 0, z: 0 },
    },
  },
  cryomoduleHousing: {
    _default: { y: 1.0 },
    cryo_out: {
      y: 2.30, localX: 0, localZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  heRecovery: {
    _default: { y: 0.8 },
    cryo_out: {
      y: 0.83, localX: 0.35, localZ: 1.25,
      normal: { x: 0, y: 0, z: 1 },
    },
  },
  heRecoveryHeader: {
    cryo_out: {
      y: 0.62, localX: 0, localZ: 0.98,
      normal: { x: 0, y: 0, z: 1 },
    },
  },
  heGasBag: {
    cryo_out: {
      y: 0.13, localX: 0, localZ: -0.70,
      normal: { x: 0, y: 0, z: -1 },
    },
  },
  hePurifier: {
    _default: { y: 0.8 },
    cryo_out: {
      y: 1.52, localX: 0.24, localZ: -0.32,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  heLiquefier: {
    _default: { y: 0.8 },
    cryo_out: {
      y: 0.83, localX: 0.83, localZ: 0.72,
      normal: { x: 1, y: 0, z: 0 },
    },
  },
  cryoValveBox: {
    _default: { y: 0.5 },
    bus_back: {
      y: 0.50, localX: -0.20, localZ: -0.74,
      normal: { x: 0, y: 0, z: -1 },
    },
    bus_front: {
      y: 0.50, localX: 0.20, localZ: 0.74,
      normal: { x: 0, y: 0, z: 1 },
    },
    bus_left: {
      y: 0.36, localX: -0.495, localZ: -0.30,
      normal: { x: -1, y: 0, z: 0 },
    },
    bus_right: {
      y: 0.36, localX: 0.495, localZ: 0.30,
      normal: { x: 1, y: 0, z: 0 },
    },
  },

  // --- support plant -------------------------------------------------------
  // Electrical hardware uses readable terminal banks rather than model-bound
  // midpoints. Distribution inputs terminate on roof insulators, while branch
  // outputs terminate at visible glands beside their front breaker controls.
  // Transformer inputs remain on their actual roof bushings. These are
  // presentation mounts only.
  padMountTransformer: {
    _default: { y: 0.78, lat: 0.42 },
    hv_in: POWER_HV_INPUT_MOUNTS.padMountTransformer,
    hv_out_1: { along: 0 },
  },
  gridServicePoint: {
    _default: { y: 1.25, lat: 0.72 },
    hv_out_1: { along: -0.34 }, hv_out_2: { along: 0.34 },
  },
  poleMountTransformer: {
    _default: { y: 0.16, lat: 0.31 },
    hv_in: POWER_HV_INPUT_MOUNTS.poleMountTransformer,
    ...frontTerminalAnchorBank('poleMountTransformer', 'pwr_out'),
  },
  facilityTransformer: {
    _default: { y: 1.55, lat: 0.82 },
    hv_in: POWER_HV_INPUT_MOUNTS.facilityTransformer,
    hv_out_1: { along: -0.25 }, hv_out_2: { along: 0.25 },
  },
  hvTransformer: {
    _default: { y: 1.42, lat: 0.82 },
    hv_in: POWER_HV_INPUT_MOUNTS.hvTransformer,
    // Match the 4×4 wall feedthrough: one 1.45 m-high row at 0.5 m centres.
    hv_out_1: { y: 1.45, along: -0.75 }, hv_out_2: { y: 1.45, along: -0.25 },
    hv_out_3: { y: 1.45, along: 0.25 }, hv_out_4: { y: 1.45, along: 0.75 },
  },
  gridIntertieTransformer: {
    _default: { y: 1.38, lat: 0.82 },
    hv_in: POWER_HV_INPUT_MOUNTS.gridIntertieTransformer,
    hv_out_1: { y: 1.22, along: -0.36 }, hv_out_2: { y: 1.22, along: 0 },
    hv_out_3: { y: 1.22, along: 0.36 }, hv_out_4: { y: 1.58, along: -0.36 },
    hv_out_5: { y: 1.58, along: 0 }, hv_out_6: { y: 1.58, along: 0.36 },
  },
  compactHvDistributor: {
    _default: { y: 0.45, lat: 0.21 },
    hv_in: POWER_HV_INPUT_MOUNTS.compactHvDistributor,
    ...frontTerminalAnchorBank('compactHvDistributor', 'hv_out'),
  },
  switchgear: {
    _default: { y: 0.7, lat: 0.66 },
    hv_in: POWER_HV_INPUT_MOUNTS.switchgear,
    ...frontTerminalAnchorBank('switchgear', 'hv_out'),
  },
  powerPanel: {
    _default: { y: 0.5, lat: 0.19 },
    hv_in: POWER_HV_INPUT_MOUNTS.powerPanel,
    ...frontTerminalAnchorBank('powerPanel', 'pwr_out'),
  },
  sectionDistributionPanel: {
    _default: { y: 0.5, lat: 0.24 },
    hv_in: POWER_HV_INPUT_MOUNTS.sectionDistributionPanel,
    ...frontTerminalAnchorBank('sectionDistributionPanel', 'pwr_out'),
  },
  mainDistributionPanel: {
    _default: { y: 0.5, lat: 0.26 },
    hv_in: POWER_HV_INPUT_MOUNTS.mainDistributionPanel,
    ...frontTerminalAnchorBank('mainDistributionPanel', 'pwr_out'),
  },
  mcc: {
    _default: { y: 0.7, lat: 0.41 },
    hv_in: POWER_HV_INPUT_MOUNTS.mcc,
    ...frontTerminalAnchorBank('mcc', 'pwr_out'),
  },
  ups: {
    _default: { y: 0.7, lat: 0.41 },
    hv_in: POWER_HV_INPUT_MOUNTS.ups,
    ...frontTerminalAnchorBank('ups', 'pwr_out'),
  },
  powerBus: {
    _default: { y: 0.84, lat: 0.21 }, pwr_in: { y: 0.92, lat: 0.71, along: 0 },
    pwr_out_1: { along: -0.54 }, pwr_out_2: { along: -0.54 },
    pwr_out_3: { along: -0.18 }, pwr_out_4: { along: -0.18 },
    pwr_out_5: { along: 0.18 }, pwr_out_6: { along: 0.18 },
    pwr_out_7: { along: 0.54 }, pwr_out_8: { along: 0.54 },
  },
  powerWallPassThrough: {
    _default: { y: 1.25, lat: 0.22, out: 0.04 },
  },
  meterMain: {
    _default: { y: 1.35, lat: 0.22, out: 0.04 },
  },
  hvWallPassThrough: {
    _default: { y: 1.45, lat: 0.22, out: 0.07 },
  },
  indoorHvCableRack: {
    _default: { y: INDOOR_HV_RACK_TERMINAL_Y, lat: 0, out: -0.06 },
    hv_1: { along: -0.60 }, hv_2: { along: -0.20 },
    hv_3: { along: 0.20 }, hv_4: { along: 0.60 },
    ...INDOOR_HV_RACK_TAP_MOUNTS,
  },
  indoorHvCableRack1Way: {
    hv_1: {
      y: INDOOR_HV_RACK_TERMINAL_Y, localX: 0, localZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  indoorHvCableRack2Way: {
    _default: { y: INDOOR_HV_RACK_TERMINAL_Y, lat: 0, out: -0.06 },
    hv_1: { along: -0.10 }, hv_2: { along: 0.30 },
    hv_tap_left: {
      y: INDOOR_HV_RACK_TERMINAL_Y, localX: -0.49, localZ: 0,
      normal: { x: -1, y: 0, z: 0 },
    },
  },
  indoorHvCableCornerRack: {
    _default: { y: 2.00, out: -0.06 },
    hv_1: { lat: 0.75 / Math.SQRT2, along: -0.75 / Math.SQRT2 },
    hv_2: { lat: 0.25 / Math.SQRT2, along: -0.25 / Math.SQRT2 },
    hv_3: { lat: 0.25 / Math.SQRT2, along: 0.25 / Math.SQRT2 },
    hv_4: { lat: 0.75 / Math.SQRT2, along: 0.75 / Math.SQRT2 },
  },
  disconnectSwitch: {
    _default: { y: 1.55, lat: 0.20, out: 0.08 },
  },
  hvDuctBankVault: {
    _default: { y: 0.18, lat: 0.30, out: 0.03 },
  },
  // Each anchor is the metal cap of one visible insulator. A crossarm projects
  // beyond the pole's compact placement footprint, so these authored mounts
  // deliberately bypass the ordinary footprint clamp.
  utilityPole: {
    _default: { lat: 0.05, out: 0, allowOutsideFootprint: true },
    hv_in: { y: 6.4064, along: -0.91 },
    hv_out: { y: 6.4064, along: 0.91 },
    hv_3: { y: 5.3536, along: -0.91 },
    hv_4: { y: 5.3536, along: 0.91 },
    hv_tap: UTILITY_POLE_HV_TAP_MOUNT,
  },
  // Six hanging-insulator tips across the tower's three conductor tiers.
  transmissionTower: {
    _default: { lat: 0.05, out: 0, allowOutsideFootprint: true },
    hv_in: { y: 4.6894, along: -1.18 },
    hv_out: { y: 4.6894, along: 1.18 },
    hv_3: { y: 6.0286, along: -1.00 },
    hv_4: { y: 6.0286, along: 1.00 },
    hv_5: { y: 7.2004, along: -0.82 },
    hv_6: { y: 7.2004, along: 0.82 },
  },
  cableTray: {
    _default: { y: 2.35, lat: 0.46, out: 0.02 },
  },
  elevatedWireTray: {
    _default: { y: 1.78, lat: 0.46, out: 0.02 },
  },
  cableRiser: {
    _default: { y: 0.18, lat: 0.42, out: 0.02 },
    pwr_out_1: { y: 2.35, along: -0.14 },
    pwr_out_2: { y: 2.35, along: 0.14 },
  },
  automaticTransferSwitch: {
    _default: { y: 0.82, lat: 0.56 },
    normal_in: { y: 0.55, along: -0.28 },
    backup_in: { y: 1.18, along: -0.28 },
    pwr_out: { y: 0.82, along: 0.28 },
  },
  backupGenerator: {
    _default: { y: 0.92, lat: 0.72, out: 0.05 },
  },
  spiderBox: {
    _default: { y: 0.12, lat: 0.22, along: 0 },
  },

  // Pumps are squat and top-connected.
  turboPump: { _default: { y: 0.85 } },
  roughingPump: { _default: { y: 0.5 } },
  roughingPumpCart: { _default: { y: 0.98, lat: 0.24, along: 0.24 } },
  turboPumpCart: { _default: { y: 0.90, lat: 0.24, along: 0.24 } },
  vacuumCart: { _default: { y: 1.0, lat: 0.70, along: 0.42 } },
  highCapacityVacuumStation: { _default: { y: 1.05, lat: 1.4, along: 1.38 } },
  ionPump: { _default: { y: 0.6 } },
  vacuumManifold: { _default: { y: 0.6 } },
  vacuumManifold8: { _default: { y: 0.6 } },

  waveguideManifold: { _default: { y: 1.1 } },
  solidStateAmp: {
    _default: { y: 0.95, lat: 0.48 },
    // Dedicated low front HV gland, opposite the four rear RF flanges.
    hv_in: { y: 0.37, along: 0.30 },
    rf_out_1: { y: 0.78, along: -0.30 }, rf_out_2: { y: 0.78, along: -0.10 },
    rf_out_3: { y: 1.12, along: 0.10 }, rf_out_4: { y: 1.12, along: 0.30 },
  },
  // The RF flange sits on the output cavity above the solenoid midpoint. Keep
  // the HV gland at the ordinary service height while routing the rectangular
  // guide from the stub the model actually draws.
  slac5045Klystron: { _default: { y: 1.0 }, rf_out: { y: 1.41 } },
  pulsedKlystron: { _default: { y: 1.0 }, rf_out: { y: 1.2 } },
  cwKlystron: { _default: { y: 1.0 }, rf_out: { y: 1.2 } },
  multibeamKlystron: { _default: { y: 1.0 }, rf_out: { y: 1.2 } },
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
  dcInjector: { _default: { y: 0.9 }, hv_in: { y: 0.45 }, cool_in: { y: 0.55 } },
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
  finalFocusDoublet: {
    _default: { y: 0.9 },
    cryo_in: {
      y: 1.72, localX: 0, localZ: -0.914,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  plasmaAfterburner: { _default: { y: 0.9 }, cool_in: { y: 0.7 } },  // cell body 0..1.48, stand to 0.78

  // --- accelerating structures --------------------------------------------
  // Same split the pillbox already documents: waveguide onto the run along
  // the top of the structure, cooling onto the manifold just above the stand.
  rfCavity: {
    _default: { y: 0.95 }, rf_in: { y: STANDARD_RF_FEED_Y, lat: 0.46, along: 0 }, cool_in: { y: 0.6 },
  },
  protonLinacFrontEnd: {
    _default: { y: 0.9 }, rf_in: { y: 1.08, lat: 0.92, along: -1.25 },
    cryo_in: {
      y: 1.62, localX: 0.87, localZ: 1.15,
      normal: { x: 1, y: 0, z: 0 },
    },
  },
  rfq: { _default: { y: 1.0 }, rf_in: { y: 1.0, lat: 1.0, along: -0.77 }, cool_in: { y: 0.55 } },
  dtl: { _default: { y: 0.95 }, rf_in: { y: 1.12, lat: 0.73, along: -0.78 } },
  sbandStructure: {
    _default: { y: 0.95 }, rf_in: { y: 1.35, lat: 0.64, along: 0.914 }, cool_in: { y: 0.6 },
  },
  cbandStructure: {
    _default: { y: 0.95 }, rf_in: { y: 1.0, lat: 0.90, along: -1.22 }, cool_in: { y: 0.65 },
  },
  xbandStructure: {
    _default: { y: 0.95 }, rf_in: { y: 1.42, lat: 1.445, along: 0 }, cool_in: { y: 0.75 },
  },
  twoBeamModule: {
    _default: { y: 1.1 }, rf_in: { y: 1.15, lat: 0.385, along: -4.76 }, cool_in: { y: 0.7 },
  },

  // Cryostats. Cryogenic transfer lands low at the valve box. RF lands on an
  // actual rectangular fundamental-power-coupler window: those windows are
  // centred at beam height in _srfCryomoduleRoles, not high on the jacket.
  // `lat` is the outer flange face and `along` selects one of the rendered
  // representative windows (the centre window where an odd bank has one).
  halfWaveResonator: {
    _default: { y: 1.1 }, rf_in: { y: 1.0, lat: 0.75, along: 0 },
    cryo_in: {
      y: 2.30, localX: 0, localZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  // The spoke vessel renders two equivalent top stubs. The routable service
  // lands on the downstream one; the other is the internal return connection.
  spokeCavity: {
    _default: { y: 0.95 },
    rf_in: { y: 1.0, lat: 0.75, along: 0.465 },
    cryo_in: {
      y: 2.45, localX: 0, localZ: 0.5952,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  ellipticalSrfCavity: {
    _default: { y: 1.0 },
    rf_in: { y: 1.0, lat: 0.75, along: -0.468 }, cool_in: { y: 0.6 },
    cryo_in: {
      y: 1.68, localX: 0, localZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  srf650Cryomodule: {
    _default: { y: 1.15 }, rf_in: { y: 1.0, lat: 1.0, along: 0 },
    cryo_in: {
      y: 2.0, localX: 0, localZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  srf805Cryomodule: {
    _default: { y: 1.15 }, rf_in: { y: 1.0, lat: 0.94, along: 1.296 },
    cryo_in: {
      y: 1.89, localX: 0, localZ: 2.52,
      normal: { x: 0, y: 1, z: 0 },
    },
  },
  cwCryomodule: {
    _default: { y: 1.15 },
    cryo_in: {
      y: 1.885, localX: 0, localZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    },
    rf_in: { y: 1.0, lat: 0.95, along: 0 },
    rf_in_2: { y: 1.0, lat: 0.95, along: -1.728 },
    rf_in_3: { y: 1.0, lat: 0.95, along: 1.728 },
    vac_in: { y: 1.0, along: 1.728 },
    vac_in_2: { y: 1.0, along: -1.728 },
    vac_in_3: { y: 1.0, along: 0 },
  },
  nbSnCryomodule: {
    _default: { y: 1.1 },
    cryo_in: {
      y: 1.80, localX: 0, localZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    },
    rf_in: { y: 1.0, lat: 0.95, along: 1.296 },
    rf_in_2: { y: 1.0, lat: 0.95, along: -1.296 },
    vac_in: { y: 1.0, along: 1.296 },
    vac_in_2: { y: 1.0, along: -1.296 },
  },
  srfLinacSector: {
    _default: { y: 1.15 },
    // Sector supply attaches to the visible longitudinal distribution header.
    cryo_in: {
      y: 1.294, localX: -0.76, localZ: 0,
      normal: { x: -1, y: 0, z: 0 },
    },
    rf_in: { y: 1.0, lat: 0.90, along: 0 },
    rf_in_2: { y: 1.0, lat: 0.90, along: -3.312 },
    rf_in_3: { y: 1.0, lat: 0.90, along: 3.312 },
    vac_in: { y: 1.0, along: 3.312 },
    vac_in_2: { y: 1.0, along: -3.312 },
    vac_in_3: { y: 1.0, along: 0 },
  },

  // --- endpoints and big machines -----------------------------------------
  // A dump or a target is a squat block of shielding: the water goes in low
  // and close to the skid, and only the vacuum port belongs on the axis.
  beamStop: { _default: { y: 0.6 }, cool_in: { y: 0.55 }, vac_in: { y: 1.0 } },   // block 0.4..1.6 on a 0.4 skid
  target: { _default: { y: 0.9 }, cool_in: { y: 0.55 }, vac_in: { y: 1.0 }, data_in: { y: 1.2 } },  // cooling plate 0.46..0.53
  beamDump: { _default: { y: 0.5 } },                                            // 1.5 m shielding block, services at its foot
  faradayCup: { _default: { y: 1.0 }, data_in: { y: 1.3 }, pwr_in: { y: 0.85 } },// can 0.7..1.3, signal stalk to 1.485
  xRayConverterStation: { _default: { y: 0.9 }, pwr_in: { y: 0.45 }, cool_in: { y: 0.55 }, data_in: { y: 1.25 } },
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
  positronSource: { _default: { y: 0.9 }, rf_in: { y: 1.05, lat: 0.72, along: 0 }, cool_in: { y: 0.6 } },
  lwfaStation: { _default: { y: 0.9 }, cool_in: { y: 0.6 }, data_in: { y: 1.1 } },
  industrialLinac: {
    _default: { y: 0.85 }, rf_in: { y: 1.05, lat: 0.49, along: -0.18 }, cool_in: { y: 0.7 },
  },

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
  const specific = entry?.[portName];
  const fallback = entry?._default;
  const serviceBand = BEAMLINE_COMPONENTS_RAW[type]
    ? BEAMLINE_SERVICE_BANDS[portName]
    : null;
  if (!specific && !fallback && !serviceBand) return null;
  return { ...(fallback || {}), ...(serviceBand || {}), ...(specific || {}) };
}

/**
 * Semantic review status for one utility port's presentation mount.
 * Callers pass the already-resolved port spec so this dependency-neutral data
 * module never imports the component registry.
 */
export function portGeometryClassification(type, portName, portSpec) {
  const utility = portSpec?.utility;
  if (EXACT_HARDWARE_UTILITIES.has(utility)) {
    if (GENERATED_DEFINING_HARDWARE_PORTS.has(`${type}.${portName}`)) {
      return PORT_GEOMETRY_CLASS.GENERATED_HARDWARE;
    }
    const resolved = portAnchorOverride(type, portName);
    const hasExactPosition = Number.isFinite(resolved?.localX)
        && Number.isFinite(resolved?.localZ)
      || Number.isFinite(resolved?.lat) && Number.isFinite(resolved?.along);
    const hasExactNormal = resolved?.normal
      ? Number.isFinite(resolved.normal.x) && Number.isFinite(resolved.normal.y)
        && Number.isFinite(resolved.normal.z)
      : portSpec?.side != null;
    return Number.isFinite(resolved?.y) && hasExactPosition && hasExactNormal
      ? PORT_GEOMETRY_CLASS.EXPLICIT_HARDWARE
      : PORT_GEOMETRY_CLASS.UNREVIEWED;
  }
  if (GENERATED_HARDWARE_UTILITIES.has(utility)) {
    return PORT_GEOMETRY_CLASS.GENERATED_HARDWARE;
  }
  return PORT_GEOMETRY_CLASS.UNREVIEWED;
}

export default PORT_ANCHOR_OVERRIDES;
