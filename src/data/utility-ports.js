// src/data/utility-ports.js
//
// Utility port assignments for beamline components and infrastructure.
// Ports sit on lateral side faces, mirrored on both sides.
// `offset` is 0→1 along the side face (0 = back, 1 = front).

export const UTILITY_PORT_PROFILES = {
  powerCable:   { color: 0x44cc44, radius: 0.02,  shape: 'round',       label: 'pwr'  },
  coolingWater: { color: 0x4488ff, radius: 0.04,  shape: 'round',       label: 'cool' },
  cryoTransfer: { color: 0x44aacc, radius: 0.06,  shape: 'round',       label: 'cryo' },
  rfWaveguide:  { color: 0xcc4444, width: 0.05, height: 0.035, shape: 'rect', label: 'RF' },
  dataFiber:    { color: 0xeeeeee, radius: 0.01,  shape: 'round',       label: 'data' },
  vacuumPipe:   { color: 0x888888, radius: 0.06,  shape: 'round',       label: 'vac'  },
};

const BEAMLINE_PORTS = {
  // Source
  source:              [{ type: 'powerCable', offset: 0.3 }],

  // Optics
  dipole:              [{ type: 'powerCable', offset: 0.3 }, { type: 'coolingWater', offset: 0.7 }],
  quadrupole:          [{ type: 'powerCable', offset: 0.3 }, { type: 'coolingWater', offset: 0.7 }],
  sextupole:           [{ type: 'powerCable', offset: 0.3 }, { type: 'coolingWater', offset: 0.7 }],
  splitter:            [{ type: 'powerCable', offset: 0.5 }],
  velocitySelector:    [{ type: 'powerCable', offset: 0.5 }],

  // RF — normal conducting
  rfq:                 [{ type: 'powerCable', offset: 0.2 }, { type: 'coolingWater', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  pillboxCavity:       [{ type: 'powerCable', offset: 0.3 }, { type: 'rfWaveguide', offset: 0.7 }],
  rfCavity:            [{ type: 'powerCable', offset: 0.2 }, { type: 'coolingWater', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  sbandStructure:      [{ type: 'powerCable', offset: 0.2 }, { type: 'coolingWater', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],

  // RF — superconducting
  halfWaveResonator:   [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  spokeCavity:         [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  ellipticalSrfCavity: [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  cryomodule:          [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],

  // Diagnostics
  bpm:                 [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  screen:              [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  ict:                 [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  wireScanner:         [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],

  // Endpoints
  faradayCup:          [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  beamStop:            [{ type: 'coolingWater', offset: 0.5 }],
  detector:            [{ type: 'powerCable', offset: 0.15 }, { type: 'coolingWater', offset: 0.45 }, { type: 'dataFiber', offset: 0.75 }],
  target:              [{ type: 'coolingWater', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
};

const INFRA_OUTPUT_PORTS = {
  substation:          [{ type: 'powerCable', offset: 0.5 }],
  powerPanel:          [{ type: 'powerCable', offset: 0.5 }],
  magnetron:           [{ type: 'rfWaveguide', offset: 0.5 }],
  solidStateAmp:       [{ type: 'rfWaveguide', offset: 0.5 }],
  twt:                 [{ type: 'rfWaveguide', offset: 0.5 }],
  pulsedKlystron:      [{ type: 'rfWaveguide', offset: 0.5 }],
  cwKlystron:          [{ type: 'rfWaveguide', offset: 0.5 }],
  iot:                 [{ type: 'rfWaveguide', offset: 0.5 }],
  multibeamKlystron:   [{ type: 'rfWaveguide', offset: 0.5 }],
  highPowerSSA:        [{ type: 'rfWaveguide', offset: 0.5 }],
  gyrotron:            [{ type: 'rfWaveguide', offset: 0.5 }],
  lcwSkid:             [{ type: 'coolingWater', offset: 0.5 }],
  chiller:             [{ type: 'coolingWater', offset: 0.5 }],
  coolingTower:        [{ type: 'coolingWater', offset: 0.5 }],
  coldBox4K:           [{ type: 'cryoTransfer', offset: 0.5 }],
  coldBox2K:           [{ type: 'cryoTransfer', offset: 0.5 }],
  roughingPump:        [{ type: 'vacuumPipe', offset: 0.5 }],
  turboPump:           [{ type: 'vacuumPipe', offset: 0.5 }],
  ionPump:             [{ type: 'vacuumPipe', offset: 0.5 }],
  negPump:             [{ type: 'vacuumPipe', offset: 0.5 }],
  tiSubPump:           [{ type: 'vacuumPipe', offset: 0.5 }],
  rackIoc:             [{ type: 'dataFiber', offset: 0.5 }],
  timingSystem:        [{ type: 'dataFiber', offset: 0.5 }],
  networkSwitch:       [{ type: 'dataFiber', offset: 0.5 }],
  archiver:            [{ type: 'dataFiber', offset: 0.5 }],
  bpmElectronics:      [{ type: 'dataFiber', offset: 0.5 }],
  blmReadout:          [{ type: 'dataFiber', offset: 0.5 }],
  llrfController:      [{ type: 'dataFiber', offset: 0.5 }],
  patchPanel:          [{ type: 'dataFiber', offset: 0.5 }],
};

export function getUtilityPorts(id) {
  return BEAMLINE_PORTS[id] || INFRA_OUTPUT_PORTS[id] || [];
}

export function isInfraOutput(id) {
  return id in INFRA_OUTPUT_PORTS;
}
