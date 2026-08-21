// Beamline components — particle accelerator modules placed in Beamline build mode.
// subL/subW define size in sub-units (1 sub-unit = 50cm)
//
// physicsType declares how the physics engine (beam_physics/) models the
// component. It must be one of KNOWN_PHYSICS_TYPES in beam_physics/gameplay.py
// — gameplay.py raises ValueError on a missing or unknown value, so a new
// component cannot silently skip physics. Components the engine doesn't model
// (diagnostics, passive filters, septa) declare 'drift': the beam passes
// through unaffected. Gameplay-side behavior (SRF quench,
// capture efficiency, transit-time factor) still keys on the game `id`, which
// physics receives as game_type.
//
// `beamlineTypes` is an OPTIONAL allowlist of BEAMLINE_TYPES ids (see
// src/data/beamline-types.js). OMITTED MEANS TRUNK — visible in every type's
// palette. Declare it only for hardware that is genuinely special-purpose: an
// ion front end, a beta=1 structure, an insertion device, a productive
// endpoint. The opposite statement — "this general hardware is wrong for that
// type" — lives on the type's `excludes` instead, so a type's identity reads
// in one place rather than being scattered across 36 component entries.
//
// The split that does the most work here is the RF one, and it is real
// physics, not flavour: the cells of a 1.3 GHz elliptical cavity are cut for a
// particle moving at the speed of light, so a 70 MeV proton (beta = 0.37)
// arrives at each gap with the wrong phase and gets DECELERATED. The trunk
// therefore holds exactly one accelerating structure (pillboxCavity, low
// enough in frequency and energy to work for either species); everything above
// it is allowlisted to one side of the beta divide or the other.
//
// The deferred component backlog lives at docs/full-beamline-component-list.md
// and should be referenced when restoring additional post-MVP hardware.
export const BEAMLINE_COMPONENTS_RAW = {
  source: {
    id: 'source',
    physicsType: 'source',
    name: 'Thermionic Electron Gun',
    desc: 'Simple, cheap, reliable thermionic electron gun — a heated cathode in a DC extraction field. Cathode heat raises emission while extraction voltage trades current for injection energy. It readily supplies hundreds of milliamps and can approach 1 A when run hot and low-voltage, but that beam is difficult to transport cleanly.',
    category: 'source',
    subsection: 'electron',
    cost: { funding: 200000 },
    // Catalogue values mirror component-physics.js at the default controls.
    // Emittance remains live/derived after placement (cathode temperature
    // changes it), but the build card still needs the default for comparison.
    stats: { beamCurrent: 250, emittance: 1.35 },
    energyCost: 15,
    apertureRadius: 40,
    // RMS beam radius at the source exit. The backend derives Twiss beta from
    // this and the live normalized emittance instead of assigning every source
    // the same 10 m beta function.
    sourceBeamRadiusMm: 5,
    subL: 4,
    subW: 4,
    subH: 4, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 5,
    maxCount: 2,
    unlocked: true,
    isSource: true,
    spriteKey: 'source',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    params: { extractionVoltage: 50, cathodeTemperature: 1200 },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    // The rugged baseline option for every electron machine.
    beamlineTypes: ['testStand', 'ebeamProcessing', 'lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable'],
  },
  dcPhotoGun: {
    id: 'dcPhotoGun',
    physicsType: 'source',
    name: 'DC Photocathode Gun',
    desc: 'A laser-driven photocathode in a high-voltage DC electrode stack. Cleaner and brighter than a thermionic gun, with laser power setting current and spot size trading charge density against emittance. A strong starter for test stands and light-source injectors.',
    category: 'source',
    subsection: 'electron',
    cost: { funding: 650000 },
    stats: { beamCurrent: 1.67, emittance: 0.44 },
    energyCost: 24,
    apertureRadius: 32,
    subL: 4,
    subW: 4,
    subH: 4, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 5,
    maxCount: 2,
    unlocked: true,
    isSource: true,
    spriteKey: 'dcPhotoGun',
    spriteColor: 0x42a5d5,
    accentColor: 0x42a5d5,
    params: { extractionVoltage: 200, laserPower: 0.5, laserSpotSize: 1.0 },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: { exit: { side: 'front' } },
    beamlineTypes: ['testStand', 'ebeamProcessing', 'lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'dataFiber'],
  },
  ncRfGun: {
    id: 'ncRfGun',
    physicsType: 'source',
    name: 'Normal-Conducting RF Gun',
    desc: 'A copper two-cell photoinjector that launches short electron bunches directly into an RF field. It costs more power and cooling than a DC gun, but starts with tighter bunch timing and a compact accelerating section.',
    category: 'source',
    subsection: 'electron',
    cost: { funding: 1200000 },
    stats: { beamCurrent: 1.0, emittance: 1.0 },
    energyCost: 70,
    apertureRadius: 28,
    subL: 4,
    subW: 4,
    subH: 4, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 6,
    maxCount: 2,
    unlocked: true,
    isSource: true,
    spriteKey: 'ncRfGun',
    spriteColor: 0xd77a35,
    accentColor: 0xd77a35,
    params: { peakField: 120, rfPhase: -30, laserSpotSize: 0.8 },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: { exit: { side: 'front' } },
    beamlineTypes: ['testStand', 'ebeamProcessing', 'lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide', 'dataFiber'],
    rfFrequency: 2856,
    rfBand: 'sband',
    rfPowerRequired: 12,
  },
  srfGun: {
    id: 'srfGun',
    physicsType: 'source',
    name: 'Superconducting RF Gun',
    desc: 'A superconducting photoinjector built for high-repetition-rate, low-emittance beams. The niobium cavity needs RF, cryogenics, precise timing, and an experienced facility — expensive infrastructure repaid with excellent beam brightness.',
    category: 'source',
    subsection: 'electron',
    cost: { funding: 8000000 },
    stats: { beamCurrent: 0.065, emittance: 0.001 },
    energyCost: 110,
    apertureRadius: 32,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'box',
    interiorVolume: 9,
    maxCount: 2,
    requires: 'srfGunTech',
    isSource: true,
    spriteKey: 'srfGun',
    spriteColor: 0x6f86c9,
    accentColor: 0x6f86c9,
    params: { gradient: 20, repRate: 650, laserSpotSize: 1.0 },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: { exit: { side: 'front' } },
    beamlineTypes: ['testStand', 'ebeamProcessing', 'lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide', 'dataFiber'],
    rfFrequency: 1300,
    rfBand: 'lband',
    rfPowerRequired: 18,
  },
  penningIonSource: {
    id: 'penningIonSource',
    physicsType: 'source',
    name: 'Penning Ion Source',
    desc: 'A compact crossed-field proton source. Opposed cathodes and a permanent-magnet yoke trap electrons in a long discharge path, making a steady low-cost beam with modest current. Simple enough for an opening proton front end.',
    category: 'source',
    subsection: 'proton',
    cost: { funding: 250000 },
    stats: { beamCurrent: 25 },
    energyCost: 18,
    apertureRadius: 24,
    sourceBeamRadiusMm: 5,
    sourceSpaceChargeCompensation: 0.95,
    subL: 4,
    subW: 4,
    subH: 4, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 4,
    maxCount: 2,
    unlocked: true,
    isSource: true,
    spriteKey: 'ionSource',
    spriteColor: 0x8b72c7,
    accentColor: 0x8b72c7,
    params: { particleType: 'proton', extractionVoltage: 30, dischargeCurrent: 2.5, magneticField: 0.15 },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: { exit: { side: 'front' } },
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation', 'blackHoleFactory'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  ionSource: {
    id: 'ionSource',
    physicsType: 'source', // proton source — gameplay.py initializes the beam with PROTON_MASS via params.particleType
    name: 'Duoplasmatron Ion Source',
    desc: 'Classic duoplasmatron proton source — a hot filament generates a primary plasma, then a magnetic constriction squeezes it through an intermediate electrode into a dense secondary plasma at the anode aperture. Reliable, moderate current, and your workhorse first proton source. Requires cooling for the magnet and arc chamber.',
    category: 'source',
    subsection: 'proton',
    cost: { funding: 400000 },
    stats: { beamCurrent: 50 },
    energyCost: 25,
    apertureRadius: 32,
    sourceBeamRadiusMm: 6,
    sourceSpaceChargeCompensation: 0.95,
    subL: 4,
    subW: 4,
    subH: 4, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 5,
    unlocked: true,
    isSource: true,
    spriteKey: 'ionSource',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    params: { particleType: 'proton', extractionVoltage: 40, arcCurrent: 5 },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    // The species declaration for every hadron type. blackHoleFactory is on
    // the list for the same reason the others are — it is a p+p- machine and
    // this is where the protons come from. The antiproton arm is the same
    // abstraction the collider makes for its positrons: a production target
    // and a damping ring the game does not ask you to build.
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation', 'blackHoleFactory'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  ecrIonSource: {
    id: 'ecrIonSource',
    physicsType: 'source', // proton source — gameplay.py initializes the beam with PROTON_MASS via params.particleType
    name: 'ECR Ion Source',
    desc: 'Electron Cyclotron Resonance ion source — microwave power at 2.45 GHz heats a plasma confined by mirror solenoid magnets, producing a high-current proton beam for high-power facilities. It readily supplies hundreds of milliamps and can exceed 1 A when pushed, but demands RF waveguide injection and substantial cooling.',
    category: 'source',
    subsection: 'proton',
    cost: { funding: 1200000 },
    stats: { beamCurrent: 400 },
    energyCost: 60,
    apertureRadius: 40,
    sourceBeamRadiusMm: 10,
    sourceSpaceChargeCompensation: 0.98,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'box',
    interiorVolume: 8,
    // GATED: its much higher current is a capability step up, and the
    // ecrIonSource node exists for exactly this. Sits one node past
    // protonAcceleration, so it can never be reachable before ionSource.
    requires: 'ecrIonSource',
    isSource: true,
    spriteKey: 'ecrIonSource',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    params: { particleType: 'proton', extractionVoltage: 40, microwavePower: 2500, magnetCurrent: 250 },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation', 'blackHoleFactory'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 2450,
    rfBand: 'sband',
    // Sized for the 6 kW top end of the microwave-power control.
    rfPowerRequired: 6,
  },

  dcInjector: {
    id: 'dcInjector',
    physicsType: 'dcAccelerator',
    name: 'High-Voltage DC Injector',
    desc: 'A high-voltage electrostatic acceleration column followed by an einzel-lens, gas-compensated low-energy beam transport section. It pushes an unbunched source beam rapidly out of the worst space-charge regime and matches it toward an RFQ or first cavity without pretending that RF capture has already happened.',
    category: 'source',
    subsection: 'transport',
    cost: { funding: 1500000 },
    stats: { energyGain: 0.00075, focusStrength: 0.9, spaceChargeCompensation: 99 },
    energyCost: 400,
    apertureRadius: 50,
    subL: 4,
    subW: 4,
    subH: 5, gridW: 4, gridH: 4, geometryType: 'cylinder',
    interiorVolume: 8,
    unlocked: true,
    spriteKey: 'dcInjector',
    spriteColor: 0xd7a843,
    accentColor: 0x55a8d8,
    params: { terminalVoltage: 750, lensVoltage: 30 },
    placement: 'attachment',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },
    requiredConnections: ['powerCable', 'coolingWater'],
  },

  // ── Compound machines ───────────────────────────────────────────────────
  //
  // The flat-ride tier. Everything above is a PART of a front end — a gun
  // that hands you 50 keV and leaves the acceleration to you. A compound
  // machine is source + acceleration + extraction in one crate: you plop it,
  // it has an exit port, and everything downstream is an ordinary
  // player-designed beamline. It is not a substitute for designing a
  // beamline, it is a front end for one.
  //
  // Mechanically they are pure data — no engine change was needed. A source
  // with a high `extractionEnergy` is exactly what beam_physics/gameplay.py
  // `extract_source_params()` already forwards as the initial beam energy,
  // with `stats.emittance` becoming the source phase space and
  // `params.particleType` picking the rest mass.
  //
  // READ THIS BEFORE TUNING `stats.emittance`. In physics_to_game,
  // beamQuality = initial_emittance / final_emittance — it scores emittance
  // PRESERVATION, not emittance. Sweeping a source from 0.5 to 200 mm·mrad
  // leaves beamQuality pinned at 1.000 while finalNormEmittanceX tracks the
  // source faithfully. So a big number here is NOT a quality penalty and must
  // never be written as if it were; it is an honest statement of the phase
  // space the machine delivers, and it only costs the player once a figure of
  // merit reads absolute emittance (xfel's felBrilliance does).
  // See docs/superpowers/specs/2026-08-11-compound-machines-design.md.
  vanDeGraaff: {
    id: 'vanDeGraaff',
    physicsType: 'source',
    name: 'Van de Graaff Generator',
    desc: 'A rubber belt carries charge to a terminal inside an SF6 pressure tank until it sits at three million volts, and a thermionic gun at the terminal rides that potential straight down an evacuated column. No RF, no cooling loop, no timing system — one power feed and a vacuum pump and it makes beam. 3 MeV at a couple of milliamps: an honest few kilowatts, delivered continuously, forever. Every part of it was state of the art in 1935, which is exactly why it is the cheapest working accelerator you can own.',
    category: 'source',
    subsection: 'electron',
    cost: { funding: 350000 },
    // 3 MeV x 2 mA = 6 kW of beam. Deliberately an order of magnitude under
    // the Rhodotron this tier's e-beam type is calibrated against: this is a
    // trickle of low-tech revenue, not a competitive processing line.
    stats: { beamCurrent: 2, emittance: 5 },
    energyCost: 30,
    apertureRadius: 40,
    subL: 6,
    subW: 4,
    subH: 6, gridW: 4, gridH: 6, geometryType: 'box',
    interiorVolume: 12,
    unlocked: true,
    isSource: true,
    spriteKey: 'vanDeGraaff',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    // 3 MV terminal, so 3 MeV of electrons.
    extractionEnergy: 0.003,

    // 3 MeV sits inside ebeamProcessing's 3-12 MeV regulatory window and at
    // the bottom edge of testStand's 5-50 MeV band. Nothing else in the
    // roster runs that low, which is the whole point of a tier-1 plop.
    beamlineTypes: ['testStand', 'ebeamProcessing'],
    // The only accelerator in the catalogue that asks for nothing but power.
    // That is its identity: plop, draw pipe to a beam stop, hang one power
    // panel and one roughing pump, and you have income on tick 1.
    requiredConnections: ['powerCable'],
  },
  cockcroftWalton: {
    id: 'cockcroftWalton',
    physicsType: 'source',
    name: 'Cockcroft-Walton Set',
    desc: 'A cascade of rectifiers and capacitors stacked into a dome, multiplying line voltage up to 750 kV, with a duoplasmatron sitting in the terminal. Protons arrive at the far end already at 750 keV — past the space-charge-dominated stretch where an RFQ would otherwise be mandatory, and fast enough to inject straight into a drift-tube structure. The machine that split the atom in 1932 and then spent forty years as the front end of every proton linac worth the name.',
    category: 'source',
    subsection: 'proton',
    cost: { funding: 900000 },
    // Fermilab's preinjector ran ~50 mA of H-; 30 mA is a conservative read.
    // Electrostatic column, no bunching: a fat, hot, DC beam.
    stats: { beamCurrent: 30, emittance: 12 },
    energyCost: 40,
    apertureRadius: 32,
    sourceBeamRadiusMm: 12,
    sourceSpaceChargeCompensation: 0.98,
    subL: 6,
    subW: 6,
    subH: 8, gridW: 6, gridH: 6, geometryType: 'box',
    interiorVolume: 14,
    unlocked: true,
    isSource: true,
    spriteKey: 'cockcroftWalton',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    params: { particleType: 'proton' },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    // The Fermilab / BNL / CERN Linac2 preinjector number, exactly.
    extractionEnergy: 0.00075,

    // Ungated as a component, but every proton type is itself gated behind
    // protonAcceleration, so it can only ever appear in a palette the player
    // has already earned. Its competition is ionSource + rfq (400k + 1.5M for
    // 3.04 MeV, and an rfWaveguide network to feed the RFQ); this is 900k for
    // 750 keV and no RF plant at all.
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  cyclotron30: {
    id: 'cyclotron30',
    physicsType: 'source',
    name: 'Compact Cyclotron (30 MeV)',
    desc: 'A four-metre iron yoke, an internal ion source, two dees, and 350 microamps of 30 MeV protons out of a stripping foil. The workhorse of the medical isotope industry — this is the machine that makes the fluorine-18 in a PET scan and the thallium-201 in a cardiac study. Self-contained: plop it, pipe the beam to a target, and it earns. Drinks power and dumps essentially all of it into the cooling loop.',
    category: 'source',
    subsection: 'proton',
    cost: { funding: 6000000 },
    // IBA Cyclone 30: 30 MeV H-, 2 x 350 uA dual extraction. One port's worth.
    stats: { beamCurrent: 0.35, emittance: 6 },
    energyCost: 140,
    apertureRadius: 40,
    subL: 8,
    subW: 8,
    subH: 6, gridW: 8, gridH: 8, geometryType: 'box',
    interiorVolume: 20,
    // GATED: cyclotronTech is the machineTypes root and exists for exactly
    // this. It is also ungated itself, so a determined player can reach the
    // first plop-and-earn machine early — which is the intended shape.
    requires: 'cyclotronTech',
    isSource: true,
    spriteKey: 'cyclotron30',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    params: { particleType: 'proton' },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    extractionEnergy: 0.030,

    // 30 MeV x 350 uA sits inside isotopeIrradiation's 15-70 MeV / 0.1-1 mA
    // bands on its own, which makes this the one compound machine that is a
    // complete revenue beamline rather than a front end. It still needs a
    // target, a pipe and a defocusing lattice to hit the spot-size band, so
    // it is a small beamline, not a free one.
    beamlineTypes: ['isotopeIrradiation'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  cyclotron70: {
    id: 'cyclotron70',
    physicsType: 'source',
    name: 'Multi-particle Cyclotron (70 MeV)',
    desc: 'A sector-focused isochronous cyclotron with a shaped, radially increasing field, so the revolution frequency holds constant as the protons go relativistic. 70 MeV, 750 microamps across two simultaneous extraction ports, and a source configurable for deuterons and alphas as well as protons. This is the machine that makes the isotopes a 30 MeV set cannot reach, and at 70 MeV it doubles as an ocular proton therapy beam.',
    category: 'source',
    subsection: 'proton',
    cost: { funding: 22000000 },
    // ARRONAX: 70 MeV, 2 x 375 uA. Taken as one 750 uA beam here because the
    // flattener walks a single path and cannot express dual extraction.
    stats: { beamCurrent: 0.75, emittance: 8 },
    energyCost: 380,
    apertureRadius: 40,
    subL: 10,
    subW: 10,
    subH: 8, gridW: 10, gridH: 10, geometryType: 'box',
    interiorVolume: 40,
    // GATED: the isochronous / AVF field shaping IS the node.
    requires: 'isochronousCyclotron',
    isSource: true,
    spriteKey: 'cyclotron70',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    params: { particleType: 'proton' },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    extractionEnergy: 0.070,

    // therapy is in the list on the strength of Clatterbridge (62 MeV) and
    // CATANA (62 MeV): 70 MeV protons treat ocular melanoma and nothing else,
    // and 0.070 GeV is the exact bottom of therapy's band. Note the 750 uA is
    // 15x over therapy's 1-50 uA window — plopping this and calling it a
    // clinic scores badly on purpose. A therapy line is a designed line.
    // blackHoleFactory is here for one measured reason: without it that type
    // has no injector at all. Its palette holds two DC sources at 10-100 kV,
    // and a 40 keV proton is beta 0.0092 with a 33 mm sigma against
    // crystalChannelStage's 4 mm bore — every lattice buildable from the
    // sources alone measures loss 1.000. A 70 MeV cyclotron hands the crystal
    // string a beam it can actually channel. The collider's SRF ladder cannot
    // do this job: those cavities are all DESIGN_BETA 0.999, so against a
    // 40 keV proton the transit-time factor floors at 0.01 and a 3.5 GeV
    // sector delivers 35 MeV over sixteen metres.
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'blackHoleFactory'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  protonLinacFrontEnd: {
    id: 'protonLinacFrontEnd',
    physicsType: 'source',
    name: 'Proton Linac Front End (180 MeV)',
    desc: 'A packaged high-current proton injector: ion source, LEBT, RFQ, MEBT, half-wave resonators and spoke cavities, commissioned as one front-end section. It hands 50 mA at 180 MeV to the medium-beta 650 MHz linac, past the low-energy acceptance bottleneck that makes a bare source plus RFQ so unforgiving. This is the PIP-II/ESS-style bridge from a laboratory ion source to a megawatt-class machine.',
    category: 'source',
    subsection: 'proton',
    cost: { funding: 35000000 },
    // Pulsed linac current, before the first high-beta cryomodule's capture.
    // 0.25 mm.mrad normalized is representative of a matched H- front end.
    stats: { beamCurrent: 50, emittance: 0.25 },
    energyCost: 600,
    apertureRadius: 50,
    // One placement represents roughly 20 m of commissioned front-end tunnel.
    subL: 36,
    subW: 8,
    subH: 6, gridW: 8, gridH: 36, geometryType: 'box',
    interiorVolume: 180,
    requires: 'cwLinacDesign',
    isSource: true,
    spriteKey: 'rfCavity',
    spriteColor: 0x46c25a,
    accentColor: 0xe89b2c,
    params: { particleType: 'proton' },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },
    extractionEnergy: 0.180,
    beamlineTypes: ['spallation'],
    requiredConnections: [
      'powerCable', 'coolingWater', 'cryoTransfer', 'rfWaveguide',
    ],
    rfFrequency: 650,
    rfBand: 'uhf',
    rfPowerRequired: 80,
  },
  cyclotron230: {
    id: 'cyclotron230',
    physicsType: 'source',
    name: 'Clinical Cyclotron (230 MeV)',
    desc: 'A 220-tonne iron yoke, four spiral sectors, two dees driven at 106 MHz, and a fixed 230 MeV out of an electrostatic deflector. Fixed is the operative word: the pole profile is machined for one energy and one only, so a clinic varies treatment depth with a degrader downstream rather than by retuning the machine. Nameplate extraction is one microamp — a quarter of a watt of protons out of four hundred kilowatts at the wall — because a treatment room wants a pencil it can steer, not power. This is the box IBA, Varian and Sumitomo actually sell hospitals, and most operating proton centres in the world are built around one.',
    category: 'source',
    subsection: 'proton',
    // IBA quotes roughly $25M for a complete single-room ProteusONE and a
    // multi-room ProteusPLUS project runs past $100M once the building and the
    // gantries are in. $45M is the accelerator, its vault and its power and
    // cooling plant — the gantry is beamline the player draws themselves.
    cost: { funding: 45000000 },
    // 1 uA is the TOP of the machine class's extraction spec (Sumitomo quote
    // 1 uA, Varian's ProBeam 800 nA, PSI's COMET 800 nA design), and it is
    // deliberately the number here rather than the 1-10 nA a patient actually
    // receives. Everything between this port and the nozzle — degrader, energy
    // slits, collimators — only ever takes current AWAY, so a source parked in
    // the middle of therapy's 1-50 uA window would leave the player nothing to
    // spend. It sits exactly on the floor because the machine really does.
    //
    // Emittance goes DOWN from the 70 MeV machine above, which looks wrong
    // until you notice what the two are for. ARRONAX extracts 750 uA through a
    // stripper foil and does not care what the phase space looks like; this
    // extracts a microamp through a deflector tuned for a millimetre-class
    // pencil, because a scanned spot IS the product. Intensity and quality are
    // the two ends of the same lever and these two machines pull opposite ends.
    stats: { beamCurrent: 0.001, emittance: 5 },
    // ~200 kW in the room-temperature main coil, ~120 kW into the RF at 106
    // MHz, the rest in the ion source, vacuum plant and controls.
    energyCost: 420,
    apertureRadius: 40,
    subL: 12,
    subW: 12,
    subH: 8, gridW: 12, gridH: 12, geometryType: 'box',
    interiorVolume: 60,
    // GATED on the same node as the 70 MeV machine, and for the reason the
    // node's own text gives: sector focusing is what lets a cyclotron past the
    // relativistic limit "to hundreds of MeV". There is no separate
    // superconducting node to hang this on, and inventing one would be a lie
    // anyway — the Cyclone 230 is room-temperature copper. The $23M price step
    // over cyclotron70 is what makes it a later purchase, not a second gate.
    requires: 'isochronousCyclotron',
    isSource: true,
    spriteKey: 'cyclotron70',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    params: { particleType: 'proton' },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    extractionEnergy: 0.230,

    // therapy ONLY, and the omission of isotopeIrradiation is the deliberate
    // half. 230 MeV is 3x over that type's 15-70 MeV ceiling and 1 uA is 100x
    // under its 0.1-1 mA floor, so it fails on both axes at once and no
    // downstream hardware fixes either: a degrader can bring the energy back
    // into band but nothing in the catalogue makes current. Listing it there
    // would be a $45M trap.
    //
    // Within therapy it is the only source that reaches past 70 MeV without a
    // hundred metres of SRF linac, which is the whole reason it exists — 0.230
    // is 92% of the way up therapy's 0.07-0.25 GeV band, and the degrader
    // below is what walks it back down.
    // blackHoleFactory is the second home, and it is the OPPOSITE trade to
    // cyclotron70's: 1 uA against 750, but a clean beam that reaches the
    // crystal string at capture-only loss. Measured across 42 stages, the
    // 230 MeV front end holds 0.5 uA the whole way while the 70 MeV one
    // decays 279 -> 97 uA. Which injector you pick IS that type's tier
    // ladder — see the note in stock-designs/black-hole.js. Energy cannot be
    // the ladder there: with six extra dimensions the Schwarzschild radius
    // goes as the seventh root of sqrt(s), so 4.7x the energy buys 1.55x the
    // yield while swapping the front end buys five orders of magnitude.
    beamlineTypes: ['therapy', 'blackHoleFactory'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  lwfaStation: {
    id: 'lwfaStation',
    physicsType: 'source',
    name: 'LWFA Station',
    desc: 'A petawatt laser pulse is focused into a centimetres-long plasma capillary, blows the electrons clean out of its own path, and leaves behind a charge-separation wake with a field above 100 GV/m. Electrons trapped in that wake surf it to a GeV in three centimetres — a job that takes a hundred metres of superconducting linac. What comes out the other end is a GeV in a crate. What also comes out is percent-level energy spread, milliradian divergence and shot-to-shot jitter, and no downstream optic gets that back.',
    category: 'source',
    subsection: 'electron',
    cost: { funding: 48000000 },
    // CHROMATIC-EQUIVALENT EMITTANCE, not the plasma-exit value. LWFA beams
    // leave the capillary with a genuinely small normalised emittance (~1
    // mm.mrad); what wrecks them is 1-3% energy spread folded through the
    // first capture quadrupole, and the engine's source model has no energy
    // spread to give. 10 mm.mrad is that chromatic blow-up expressed in the
    // one number the engine reads — 7x a thermionic gun's 1.35.
    //
    // Average current is 100 pC at ~10 kHz. That is the kHz-class LWFA the
    // field is actually building toward (kBELLA, ATHENA, LUX), not a 1 Hz
    // demonstrator, and it is what keeps this inside xfel's 0.5-10 uA window
    // so the penalty lands on emittance alone rather than being doubled.
    stats: { beamCurrent: 0.001, emittance: 10 },
    energyCost: 450,
    apertureRadius: 16,
    subL: 12,
    subW: 8,
    subH: 5, gridW: 8, gridH: 12, geometryType: 'box',
    interiorVolume: 30,
    requires: 'plasmaAcceleration',
    isSource: true,
    spriteKey: 'lwfaStation',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    // 1 GeV. LBNL BELLA reached exactly this in a 3.3 cm capillary in 2006
    // (Leemans et al.) and 8 GeV in a 30 cm one in 2019, so a GeV station is
    // the conservative reading of the record, not the optimistic one.
    extractionEnergy: 1.0,

    // Every electron type except ebeamProcessing, where a GeV plasma stage in
    // front of a 10 MeV sterilisation line is absurd. On its own it lands in
    // euvFel's 0.8-1.2 GeV band and fails its 5-15 mA / CW requirement by
    // four orders of magnitude; its real use is as a front end that hands an
    // xfel or a collider a GeV for the price of five cryomodules, and then
    // makes them live with the phase space.
    beamlineTypes: ['testStand', 'lightSource', 'xfel', 'euvFel', 'collider'],
    // NO rfWaveguide and NO cryoTransfer — that absence is the point. What it
    // wants instead is a substation's worth of electricity, a chiller loop to
    // take it back, and a fibre timing link to the drive laser: the
    // laser-to-plasma synchronisation is femtosecond-class and is distributed
    // over stabilised fibre, which is what dataFiber models. The petawatt
    // laser itself is a separate infrastructure placeable (petawattLaser).
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  positronSource: {
    id: 'positronSource',
    physicsType: 'source',
    name: 'Positron Source',
    desc: 'A drive beam slams into six radiation lengths of tungsten-rhenium and the electromagnetic shower inside turns beam energy back into matter, half of it the wrong sign. A pulsed flux concentrator at 5.8 T grabs the positrons spraying off the back face, an S-band capture linac immersed in a 0.5 T solenoid takes what it caught to 200 MeV, and a chicane sweeps the surviving electrons and photons into a dump. The SLC ran exactly this and got about one usable positron per incident electron; everything else in the shower is heat in a target that has to survive it. What comes out is enormous in phase space and would go straight into a damping ring at any real facility.',
    category: 'source',
    // No 'positron' subsection exists and one would hold a single component.
    // Same rest mass, same optics, same sign-blind engine — it belongs with
    // the electrons.
    subsection: 'electron',
    // The most expensive single component in the catalogue, ahead of the $50M
    // detector. The ILC TDR costs its positron source system at roughly $150M;
    // the SLC's was cheaper because it stole its drive beam from a linac that
    // already existed. $85M is that: target, flux concentrator, capture linac,
    // remote handling and a drive line, bought as one crate.
    cost: { funding: 85000000 },
    // ILC baseline: 2e10 e+/bunch x 1312 bunches x 5 Hz = 1.3e14 positrons a
    // second, which is 21 uA. That is the design number for the machine class
    // this type models, and it is still four orders of magnitude under the
    // thermionic gun's 100 mA — making positrons is the single hardest thing
    // an e+e- collider does and this is what it costs.
    //
    // 40 mm.mrad is the largest value the roster's sanity range allows and it
    // is a deliberate UNDERSTATEMENT. A real captured positron beam leaves the
    // capture linac at something like 1e4 mm.mrad normalised; it is unusable
    // until a damping ring has cooled it by three orders of magnitude, and the
    // catalogue has no damping ring. Read this number as "the worst phase
    // space in the game" rather than as a physical figure.
    stats: { beamCurrent: 0.021, emittance: 40 },
    // The drive beam is the cost. A few hundred kW of klystron plant feeding
    // the drive linac and the capture section, essentially all of which ends
    // up as heat in a tungsten target and its shielding.
    energyCost: 800,
    // The capture channel is the tightest bore on the machine — the flux
    // concentrator's inner conductor is a couple of centimetres across, and
    // everything that misses it is lost by construction.
    apertureRadius: 20,
    subL: 16,
    subW: 8,
    subH: 6, gridW: 8, gridH: 16, geometryType: 'box',
    interiorVolume: 45,
    // GATED on the node that already describes this exact machine in prose and
    // has never handed anything over: RESEARCH.antimatter is "positron
    // production via electron-positron pair creation in high-Z targets... the
    // positrons are captured, cooled, and re-accelerated". It is also a
    // prerequisite of colliderTech, so no player can unlock the collider type
    // and then find its species missing from the palette.
    requires: 'antimatter',
    isSource: true,
    spriteKey: 'lwfaStation',
    spriteColor: 0x46c25a,
    accentColor: 0x46c25a,
    // Positrons have the electron rest mass exactly, and extract_source_params
    // defaults to ELECTRON_MASS, so this string costs the engine nothing and
    // gets the kinematics right for free. It is NOT doing more than that:
    // charge sign is modelled nowhere in beam_physics, so nothing downstream
    // bends this beam the other way and nothing checks that the two arms of a
    // collider are opposite species. The declaration is honest bookkeeping and
    // a hook for when either of those lands.
    params: { particleType: 'positron' },
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      exit: { side: 'front' },
    },

    // 200 MeV — the SLC capture section's output energy, before the return
    // line took the beam back up the linac to the damping ring.
    extractionEnergy: 0.2,

    // The one type whose declared species is e+e-, and until now the one type
    // with no hardware that makes half of it. 200 MeV is far below the
    // 45-120 GeV/beam band, so this is a front end and never a machine you get
    // paid for on its own — every collider arm built on it still needs the
    // full SRF chain behind it.
    beamlineTypes: ['collider'],
    // The capture linac is a real S-band structure and wants a real klystron
    // behind it, which is what separates this from the cyclotrons: they fold
    // their RF into the crate, this one asks for the waveguide.
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 2856,
    rfBand: 'sband',
    rfPowerRequired: 60,
  },
  drift: {
    id: 'drift',
    physicsType: 'drift',
    name: 'Beam Pipe',
    desc: 'A straight section of beam pipe with no active elements. Use beam pipes to extend your beamline cheaply — they add length but no energy cost. Essential for spacing out components and giving the beam room to travel between focusing elements.',
    category: 'source',
    subsection: 'transport',
    cost: { funding: 10000 },
    stats: {},
    energyCost: 0,
    apertureRadius: 80,
    subL: 4,
    subW: 2,
    subH: 2, gridW: 2, gridH: 4, geometryType: 'cylinder',
    interiorVolume: 5,
    unlocked: true,
    spriteKey: 'drift',
    spriteColor: 0x9aa7b5,
    accentColor: 0x9aa7b5,
    isDrawnConnection: true,
    placement: 'module',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    requiredConnections: [],
  },
  bellows: {
    id: 'bellows',
    physicsType: 'drift',
    name: 'Bellows Section',
    desc: 'Flexible vacuum bellows section that absorbs thermal expansion and vibration between rigid components. Cheap and zero energy cost. Place between components that may shift during operation, or use as a short spacer when you need minimal drift length.',
    category: 'source',
    subsection: 'transport',
    cost: { funding: 15000 },
    stats: {},
    energyCost: 0,
    apertureRadius: 64,
    subL: 1,
    subW: 2,
    subH: 2, gridW: 2, gridH: 1, geometryType: 'cylinder',
    interiorVolume: 0.8,
    spriteKey: 'bellows',
    spriteColor: 0x9aa7b5,
    accentColor: 0x9aa7b5,
    placement: 'attachment',
    attachmentKind: 'inline',
    role: 'placement',

    requiredConnections: [],
  },

  // ── Optics — Focusing ─────────────────────────────────────────────
  dipole: {
    id: 'dipole',
    physicsType: 'dipole',
    name: 'Dipole',
    desc: 'C-clamp bending magnet that deflects the beam 90 degrees toward the open side of the yoke. Use dipoles to route your beamline around corners and build compact layouts. Essential for creating rings or redirecting beam paths.',
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 300000 },
    stats: { bendAngle: 90 },
    energyCost: 8,
    apertureRadius: 48,
    subL: 2,
    subW: 2,
    subH: 2, gridW: 2, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 2,
    unlocked: true,
    isDipole: true,
    spriteKey: 'dipole',
    spriteColor: 0x6457d6,
    accentColor: 0x6457d6,
    placement: 'module',
    role: 'junction',
    routing: [{ from: 'entry', to: 'exit' }],
    ports: {
      entry: { side: 'back' },
      // Exit is on the left side of the yoke — the open side of the
      // C-clamp — so the connected pipe bends 90° toward the C opening.
      exit: { side: 'left' },
    },

    textures: { iron: 'metal_painted_white' },
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  injectionSeptum: {
    id: 'injectionSeptum',
    physicsType: 'drift', // septa are drift-like passthroughs in the engine
    name: 'Injection Septum',
    desc: 'Pulsed septum magnet that merges an incoming linac beam onto a circulating ring orbit. Thin current-carrying septum blade separates the injection channel from the ring aperture; fires only during the injection window. Three ports: linac entry and ring entry both route to the shared ring exit.',
    // 'magnet' was not a palette tab — the item was invisible in every
    // build menu. Optics/focusing matches the dipole family it belongs to.
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 800000 },
    stats: { bendAngle: 15 },
    energyCost: 10,
    apertureRadius: 32,
    subL: 2,
    subW: 2,
    subH: 2, gridW: 2, gridH: 2, geometryType: 'box',
    interiorVolume: 2,
    unlocked: false,
    spriteKey: 'dipole',
    spriteColor: 0x6457d6,
    accentColor: 0x6457d6,
    placement: 'module',
    role: 'junction',
    routing: [
      { from: 'linacEntry', to: 'ringExit' },
      { from: 'ringEntry', to: 'ringExit' },
    ],
    ports: {
      linacEntry: { side: 'back' },
      ringEntry: { side: 'left' },
      ringExit: { side: 'right' },
    },

    // Only two types have a ring to inject into.
    beamlineTypes: ['lightSource', 'collider'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  fastKicker: {
    id: 'fastKicker',
    physicsType: 'dipole',
    name: 'Fast Kicker',
    desc: 'Ferrite window-frame magnet with a 50 ns rise time, fired by a pulse-forming network the size of a wardrobe. Ring injection is a septum AND a kicker: the septum brings the new bunch in alongside the stored beam, and the kicker bumps the stored orbit out of its way for exactly one turn and puts it back before the next. Miss the timing and you scrape the beam you already have.',
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 2500000 },
    // A kicker is a milliradian device, not a bend. bendAngle 2 lands at
    // ~0.33 degrees after BEND_ANGLE_SCALE, which is the right order.
    stats: { bendAngle: 2 },
    energyCost: 12,
    apertureRadius: 40,
    subL: 4,
    subW: 2,
    subH: 2, gridW: 2, gridH: 4, geometryType: 'box',
    interiorVolume: 2,
    requires: 'storageRingTech',
    // NO isDipole: the beam goes straight through. The flag marks components
    // the designer treats as corners, and a kicker deflects by a fraction of
    // a degree — it never turns a beamline.
    spriteKey: 'dipole',
    spriteColor: 0x6457d6,
    accentColor: 0x6457d6,
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    textures: { iron: 'metal_brushed' },
    // The two ring types, matching injectionSeptum — the pair only works as a
    // pair. scanningMagnet, the catalogue's other fast magnet, is allowlisted
    // to the three proton types, so lightSource had a septum and nothing to
    // fire alongside it.
    beamlineTypes: ['lightSource', 'collider'],
    // dataFiber, like scanningMagnet: a PFN with no timing link is a magnet
    // firing at a moment nobody chose. The trigger comes down the fibre.
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  finalFocusDoublet: {
    id: 'finalFocusDoublet',
    physicsType: 'quadrupole',
    name: 'Final Focus Doublet',
    desc: 'Two superconducting quadrupoles back to back in one cryostat — the last magnets before the interaction point, and the ones that decide whether you have a collider or a very expensive light bulb. Squeezing beta-star to a millimetre needs gradients past 200 T/m through an aperture wide enough to pass the disrupted outgoing beam as well as focus the incoming one. Nothing else in the catalogue sits this close to a detector or is this unforgiving about alignment.',
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 35000000 },
    stats: { focusStrength: 4 },
    energyCost: 8,
    apertureRadius: 20,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'cylinder',
    interiorVolume: 8,
    requires: 'highLuminosity',
    spriteKey: 'quadrupole',
    spriteColor: 0x3d8ee6,
    accentColor: 0x3d8ee6,
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // One type has an interaction point to focus onto.
    beamlineTypes: ['collider'],
    // cryoTransfer and NOT coolingWater: 200 T/m through a usable aperture is
    // a superconducting magnet, and a superconducting magnet wants helium
    // rather than a water loop.
    requiredConnections: ['powerCable', 'cryoTransfer'],
  },
  quadrupole: {
    id: 'quadrupole',
    physicsType: 'quadrupole',
    name: 'Quad',
    desc: 'Quadrupole focusing magnet that squeezes the beam in one plane while defocusing in the other. Place them in alternating pairs (FODO lattice) along your beamline to keep the beam tightly focused. Without quads, the beam will diverge and lose quality over distance.',
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 200000 },
    stats: { focusStrength: 1 },
    energyCost: 6,
    apertureRadius: 48,
    subL: 2,
    subW: 2,
    subH: 2, gridW: 2, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 2,
    unlocked: true,
    spriteKey: 'quadrupole',
    spriteColor: 0x3d8ee6,
    accentColor: 0x3d8ee6,
    placement: 'attachment',
    role: 'placement',
    textures: { iron: 'metal_brushed' },
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  // Solenoid, collimator, chicane, combinedFunctionMagnet and undulator below
  // exist to give the physics engine's orphaned element types a component to
  // attach to. beam_physics/gameplay.py has mapped all five for a long time and
  // KNOWN_PHYSICS_TYPES lists them, but NO component declared them — so
  // CollimationModule (which runs in every machine tier), BunchCompressionModule
  // and FELGainModule had never executed once, and the solenoid/combined-function
  // transfer matrices in elements.py were unreachable. Adding the components is
  // the whole fix; no engine change was needed.
  solenoid: {
    id: 'solenoid',
    physicsType: 'solenoid',
    name: 'Solenoid',
    desc: 'Axial-field focusing magnet that focuses in BOTH planes at once, unlike a quadrupole. Its strength falls off sharply with energy, so it earns its place right after the source where the beam is slow and space charge is trying to blow it apart. Standard practice on every photoinjector and ion front end.',
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 150000 },
    // 5 mT, not the 200 mT this used to ship. A quarter-wave match over this
    // component's own 1 m length wants 6 mT at 250 keV, and anything above
    // ~20 mT overfocuses hard enough to put a front-end beam on the wall
    // inside the magnet — see the measurement table on PARAM_DEFS.solenoid in
    // src/beamline/component-physics.js. The catalogue default has to be a
    // setting that works, because it is the one every placed solenoid starts at.
    stats: { fieldStrength: 0.005 },
    energyCost: 1,
    apertureRadius: 40,
    subL: 2,
    subW: 2,
    subH: 2, gridW: 2, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 1.5,
    unlocked: true,
    spriteKey: 'quadrupole',
    spriteColor: 0x4f9de0,
    accentColor: 0x4f9de0,
    params: { fieldStrength: 0.005 },
    placement: 'attachment',
    role: 'placement',
    textures: { iron: 'metal_brushed' },
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  collimator: {
    id: 'collimator',
    physicsType: 'collimator',
    name: 'Collimator',
    desc: 'Adjustable jaws that scrape the outer halo off the beam. Costs you current but improves what survives, and protects everything downstream from the stray particles that would otherwise activate your tunnel. Essential on any high-power machine where uncontrolled loss is the thing that stops the beam.',
    category: 'optics',
    subsection: 'manipulation',
    cost: { funding: 400000 },
    stats: { beamQuality: 0.2 },
    energyCost: 2,
    apertureRadius: 32,
    subL: 2,
    subW: 2,
    subH: 2, gridW: 2, gridH: 2, geometryType: 'box',
    interiorVolume: 1.5,
    requires: 'beamOptics',
    spriteKey: 'aperture',
    spriteColor: 0x8a8f96,
    accentColor: 0x8a8f96,
    placement: 'attachment',
    role: 'placement',
    requiredConnections: ['coolingWater'],
  },
  combinedFunctionMagnet: {
    id: 'combinedFunctionMagnet',
    physicsType: 'combined_function',
    name: 'Combined Function Magnet',
    desc: 'Bends and focuses in a single magnet by shaping the pole faces so the field varies across the aperture. Two jobs, one power supply, one cooling circuit and one slot of beamline — the reason compact rings and cost-conscious lattices use them instead of separate dipoles and quads.',
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 2000000 },
    stats: { bendAngle: 45, focusStrength: 0.8 },
    energyCost: 2,
    apertureRadius: 48,
    subL: 4,
    subW: 2,
    subH: 2, gridW: 2, gridH: 4, geometryType: 'box',
    interiorVolume: 3,
    requires: 'latticeDesign',
    isDipole: true,
    spriteKey: 'dipole',
    spriteColor: 0x6f7fd0,
    accentColor: 0x6f7fd0,
    placement: 'module',
    role: 'junction',
    routing: [{ from: 'entry', to: 'exit' }],
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },
    textures: { iron: 'metal_brushed' },
    // Multi-bend-achromat lattices are a storage-ring economy: two jobs per
    // magnet is how you fit 40 bends into a ring you can afford to power.
    beamlineTypes: ['lightSource'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  chicane: {
    id: 'chicane',
    physicsType: 'chicane',
    name: 'Bunch Compressor (Chicane)',
    desc: 'Four dipoles in a Z that send higher-energy particles the long way round, so a bunch that has been energy-chirped by an off-crest cavity arrives compressed. Peak current is what drives FEL gain, and this is how you get it — an FEL without a compressor never reaches saturation.',
    category: 'optics',
    subsection: 'manipulation',
    cost: { funding: 2500000 },
    stats: { r56: -50 },
    energyCost: 3,
    apertureRadius: 64,
    subL: 8,
    subW: 4,
    subH: 2, gridW: 4, gridH: 8, geometryType: 'box',
    interiorVolume: 8,
    requires: 'bunchCompression',
    spriteKey: 'dipole',
    spriteColor: 0x9d6fd0,
    accentColor: 0x9d6fd0,
    // r56 in mm; gameplay.py converts to metres. Negative is the usual sign
    // convention for a compressing chicane.
    params: { r56: -50 },
    placement: 'attachment',
    role: 'placement',
    textures: { iron: 'metal_brushed' },
    // The single-pass machines that live or die on peak current. Deliberately
    // NOT the light source: a storage ring lengthens its bunches to fight
    // Touschek scattering, it never compresses them — the exact inverse of
    // what this does.
    beamlineTypes: ['xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  recirculationArc: {
    id: 'recirculationArc',
    physicsType: 'chicane',
    name: 'Recirculation Arc',
    desc: 'A lateral bypass that lifts the beam off-axis, walks it around a bend and merges it back onto the same line — the return leg of an energy-recovery linac, so a spent beam re-enters the cavities 180 degrees out of phase and hands its energy back to the RF instead of to a dump. Near-isochronous by design: the arc is tuned to preserve bunch length rather than compress it, which is exactly what separates a return leg from a bunch compressor that happens to bend.',
    category: 'optics',
    subsection: 'manipulation',
    cost: { funding: 18000000 },
    // A few mm of residual R56 for longitudinal matching, not the -50 of a
    // compressor. An ERL arc that compressed would defeat its own purpose.
    stats: { r56: -5 },
    energyCost: 20,
    apertureRadius: 48,
    subL: 12,
    subW: 4,
    subH: 2, gridW: 4, gridH: 12, geometryType: 'box',
    interiorVolume: 12,
    requires: 'energyRecovery',
    spriteKey: 'dipole',
    spriteColor: 0x9d6fd0,
    accentColor: 0x9d6fd0,
    params: { r56: -5 },
    placement: 'module',
    // Junction, following injectionSeptum exactly: two inbound ports merging
    // onto ONE outbound port. That single-target shape is load-bearing —
    // detectMultiBranch (src/beamline/designer-plan.js) blocks any component
    // whose routing has more than one distinct `to`, so a genuine splitter
    // would make every design containing it unplannable. No new routing
    // primitive is needed or wanted here.
    role: 'junction',
    routing: [
      { from: 'entry', to: 'exit' },
      { from: 'arcEntry', to: 'exit' },
    ],
    ports: {
      entry: { side: 'back' },
      arcEntry: { side: 'left' },
      exit: { side: 'front' },
    },

    textures: { iron: 'metal_brushed' },
    // euvFel first: an ERL is the only way to drive 13.5 nm at CW power
    // without a dump that eats the facility's whole electricity bill.
    // lightSource second, where a recirculating injector is a real topology.
    beamlineTypes: ['euvFel', 'lightSource'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  undulator: {
    id: 'undulator',
    physicsType: 'undulator',
    name: 'Undulator',
    desc: 'A long array of alternating magnet poles that whips the beam side to side, and at every wiggle it radiates. Get the beam bright enough and the emitted light starts bunching the electrons that made it, which makes more light still — that runaway is FEL gain, and it is what separates a light source from a laser.',
    category: 'optics',
    subsection: 'insertionDevices',
    cost: { funding: 3000000 },
    // period in mm (gameplay.py converts to metres); kParameter dimensionless.
    stats: { photonRate: 1, period: 30, kParameter: 1.5 },
    energyCost: 12,
    apertureRadius: 8,
    subL: 10,
    subW: 2,
    subH: 2, gridW: 2, gridH: 10, geometryType: 'box',
    interiorVolume: 6,
    requires: 'synchrotronLight',
    spriteKey: 'quadrupole',
    spriteColor: 0xd06f9d,
    accentColor: 0xd06f9d,
    params: { period: 30, kParameter: 1.5 },
    placement: 'attachment',
    role: 'placement',
    textures: { iron: 'metal_brushed' },
    // The three types whose product is photons. Barred from the hadron types
    // because a 70 MeV proton has gamma = 1.07 and does not radiate, and from
    // the collider because there a photon leaving the beam takes luminosity
    // with it — it is a loss mechanism, not a product.
    beamlineTypes: ['lightSource', 'xfel', 'euvFel'],
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  sextupole: {
    id: 'sextupole',
    physicsType: 'sextupole',
    name: 'Sextupole',
    desc: 'Six-pole magnet that corrects chromatic aberrations — the tendency of particles with different energies to focus at different points. Place near quadrupoles to sharpen the beam and improve quality. Adds both focus strength and beam quality.',
    category: 'optics',
    subsection: 'focusing',
    cost: { funding: 350000 },
    stats: { focusStrength: 0.5, beamQuality: 0.3 },
    energyCost: 8,
    apertureRadius: 48,
    subL: 2,
    subW: 2,
    subH: 3, gridW: 2, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 2,
    // GATED: chromaticity correction is a second-order fix you only need once
    // the lattice is real. advancedOptics is deep in the beamOptics tree, which
    // is where the "sharpen an existing machine" decisions belong.
    requires: 'advancedOptics',
    spriteKey: 'sextupole',
    spriteColor: 0x3d8ee6,
    accentColor: 0x3d8ee6,
    placement: 'attachment',
    role: 'placement',

    requiredConnections: ['powerCable', 'coolingWater'],
  },

  // ── Optics — Manipulation ─────────────────────────────────────────
  aperture: {
    id: 'aperture',
    physicsType: 'drift', // not modeled as a physics collimator (old fallthrough)
    name: 'Aperture',
    desc: 'Simple adjustable slit that limits the beam size by blocking particles outside a defined window. The cheapest way to clean up a messy beam — scrapes the halo and improves quality at the cost of some current. Place before sensitive components or detectors.',
    category: 'optics',
    subsection: 'manipulation',
    cost: { funding: 30000 },
    stats: { beamQuality: 0.1 },
    energyCost: 0,
    apertureRadius: 24,
    subL: 1,
    subW: 2,
    subH: 3, gridW: 2, gridH: 1, geometryType: 'box',
    interiorVolume: 1,
    unlocked: true,
    spriteKey: 'collimator',
    spriteColor: 0x5f93c4,
    accentColor: 0x5f93c4,
    placement: 'attachment',
    role: 'placement',

    requiredConnections: [],
  },
  velocitySelector: {
    id: 'velocitySelector',
    physicsType: 'drift', // beamQuality stat is not physics-modeled (old fallthrough)
    name: 'Velocity Selector',
    desc: 'Crossed electric and magnetic fields that only transmit particles within a narrow velocity band — slower or faster particles are deflected into the walls. Essential for selecting a clean mono-energetic beam from a mixed source. Improves beam quality significantly.',
    category: 'optics',
    subsection: 'manipulation',
    cost: { funding: 250000 },
    stats: { beamQuality: 0.3 },
    energyCost: 3,
    apertureRadius: 32,
    subL: 2,
    subW: 2,
    subH: 2, gridW: 2, gridH: 2, geometryType: 'box',
    interiorVolume: 4,
    unlocked: true,
    spriteKey: 'collimator',
    spriteColor: 0x5f93c4,
    accentColor: 0x5f93c4,
    params: { eField: 50, bField: 0.1 },
    placement: 'attachment',
    role: 'placement',

    requiredConnections: ['powerCable'],
  },
  emittanceFilter: {
    id: 'emittanceFilter',
    physicsType: 'drift', // beamQuality stat is not physics-modeled (old fallthrough)
    name: 'Pepper-pot Emittance Filter',
    desc: 'Array of small holes in a metal plate that selects only the most collimated particles, dramatically improving beam emittance at the cost of current. The transmitted beamlets reveal the beam phase space. Cheap and passive — useful for cleaning up a rough source.',
    category: 'optics',
    subsection: 'manipulation',
    cost: { funding: 100000 },
    stats: { beamQuality: 0.15 },
    energyCost: 0,
    apertureRadius: 16,
    subL: 1,
    subW: 2,
    subH: 3, gridW: 2, gridH: 1, geometryType: 'box',
    interiorVolume: 1,
    unlocked: true,
    spriteKey: 'collimator',
    spriteColor: 0x5f93c4,
    accentColor: 0x5f93c4,
    placement: 'attachment',
    role: 'placement',

    requiredConnections: [],
  },
  energyDegrader: {
    id: 'energyDegrader',
    // ── PHYSICS TYPE: A KNOWN COMPROMISE, DOCUMENTED RATHER THAN HIDDEN ──
    //
    // What this device does is take kinetic energy out of the beam. Exactly
    // two element types in beam_physics can change the beam energy at all —
    // 'rfCavity' and 'cryomodule' — and both do it through the same
    // `energyGain` field, which is signed and which lattice.py sub-steps
    // correctly for negative values. So a degrader is an RF cavity run
    // backwards, and that is the closest honest type available. It is NOT
    // another inert 'drift' like aperture / velocitySelector /
    // emittanceFilter: it moves the beam energy in both the Pyodide path and
    // the headless fallback, and it is the only component in the catalogue
    // that moves it DOWN.
    //
    // Three things the engine gets right by accident and one it cannot do:
    //
    //   * Energy. RFAccelerationModule does `beam.energy += dE`, clamped at
    //     the rest mass, so a negative dE decelerates. _fallbackStatsForBeamline
    //     sums stats.energyGain, so the headless model agrees.
    //   * Emittance. The adiabatic-damping block runs on the ratio
    //     E_before/E_after, which is > 1 here, so x' and y' grow and the
    //     GEOMETRIC emittance grows with them. That is real physics and it is
    //     what makes beamQuality fall and downstream aperture loss rise.
    //   * Transmission. Nothing declares it, but the blown-up beam gets
    //     scraped by every aperture after this point, which is precisely why
    //     real degraded therapy lines transmit 1%.
    //   * GAP: multiple Coulomb scattering and energy straggling in the wedge.
    //     The engine has no material-interaction model, so the emittance
    //     growth it produces (~16% for a 230 -> 70 MeV degrade, from adiabatic
    //     anti-damping alone) is one to two orders of magnitude smaller than
    //     the real thing, and the energy SPREAD growth is absent entirely. The
    //     derived `beamQuality` penalty below stands in for it on the headless
    //     path; the Pyodide path currently under-charges for this component.
    //
    // Two gameplay tables in beam_physics key on the game id and both needed
    // an entry — DESIGN_BETA (or the transit-time factor for a beta=0.9 RF
    // structure would eat 40-80% of the requested energy loss and the tunable
    // output energy would be a lie) and CAPTURE_EFFICIENCY. See
    // beam_physics/modules/rf_acceleration.py.
    physicsType: 'rfCavity',
    name: 'Energy Degrader & Selection',
    desc: 'Graphite wedges driven into the beam to strip range off it, followed by a four-dipole momentum-analysis section and a pair of slits that throw away everything outside the momentum window you asked for. This is how a fixed-energy cyclotron treats a tumour at any depth. At full energy essentially the whole beam gets through; at 70 MeV about one part in a hundred does and the rest is stopped in the collimators. Every millimetre of wedge buys range at the price of scattering — what comes out is wider, more divergent and less monochromatic than what went in, and no optic downstream gives any of it back. PSI Gantry 1 and every IBA ProteusPLUS line has one.',
    category: 'optics',
    subsection: 'manipulation',
    // Four analysing dipoles, two slit assemblies, a wedge drive and a lot of
    // shielding: this is a beamline section, not a component, and it is priced
    // between a chicane ($2.5M) and a combined-function magnet ($2M).
    cost: { funding: 2800000 },
    // NEGATIVE energyGain is the whole component. -0.080 GeV is the default
    // 230 -> 150 MeV setting; computeStats overwrites it from the
    // outputEnergy slider. rfFrequency is the IBA Cyclone 230's own 106 MHz —
    // if this is the first RF-typed element on the line (and on a cyclotron
    // therapy line it usually is) RFAccelerationModule stamps the bunch
    // structure from it, and the cyclotron's RF really is what bunches this
    // beam. beamQuality is negative on purpose: see the physicsType note.
    stats: { energyGain: -0.080, beamQuality: -0.12, rfFrequency: 106 },
    // Four dipoles' worth of coil current plus the wedge and slit drives.
    energyCost: 30,
    // The energy-selection slits are the tightest aperture on a therapy line
    // by design — they are what makes the momentum window a window.
    apertureRadius: 20,
    subL: 12,
    subW: 4,
    subH: 3, gridW: 4, gridH: 12, geometryType: 'box',
    interiorVolume: 10,
    // GATED with the fixed-energy cyclotrons, because that is the only reason
    // this exists: a machine whose pole profile is cut for one energy needs
    // something else to vary depth. Same node, one shopping list.
    requires: 'isochronousCyclotron',
    spriteKey: 'collimator',
    spriteColor: 0x8a8f96,
    accentColor: 0x8a8f96,
    params: { outputEnergy: 150 },
    placement: 'attachment',
    role: 'placement',

    // therapy ONLY, and the restriction is about the slider rather than the
    // hardware. ARRONAX really does degrade its 70 MeV beam to 30-40 MeV to
    // sit on specific (p,xn) thresholds, so an isotope line has a genuine use
    // for one — but this component's control is an OUTPUT energy referenced to
    // a 230 MeV input, because that is what a clinician dials and what a
    // treatment plan is written in. `energyGain` is a difference and the
    // engine applies it to whatever beam actually arrives, so on a 70 MeV line
    // the default 150 MeV setting would try to remove 80 MeV from a 70 MeV
    // beam and kill it outright. A knob that lies on half its palette is worse
    // than a missing entry; if the isotope case is wanted later, the honest
    // shape is a second component whose knob is energy REMOVED.
    //
    // Deliberately absent from spallation for a physical reason instead:
    // degrading a megawatt beam means absorbing most of a megawatt in a
    // graphite block, which is a target station, not a beamline element.
    beamlineTypes: ['therapy'],
    // The water is for the four analysing dipoles, not for the wedge — a
    // therapy beam is a quarter of a watt and the wedge barely notices it.
    requiredConnections: ['powerCable', 'coolingWater'],
  },
  scanningMagnet: {
    id: 'scanningMagnet',
    // A scanning magnet pair IS two dipoles, so 'dipole' is the honest
    // hardware identity and the engine gives it a real transfer matrix rather
    // than a drift. What the engine cannot express is the SWEEP: it has no
    // pulse structure, so it sees a static deflection where the machine is
    // painting a field at metres per second. What survives is the chromatic
    // part — dipole_matrix carries R[0,5] = rho(1-cos t), so a bigger scan
    // field means more dispersion and a bigger spot for the same energy
    // spread, which is exactly the real limit on how far you can scan a
    // degraded beam. The time-averaged field size itself is a gap.
    //
    // No isDipole flag and both beam ports on the same axis, like
    // combinedFunctionMagnet: the beamline stays straight on the grid while
    // physics sees the bend.
    physicsType: 'dipole',
    name: 'Scanning Magnets',
    desc: 'Two orthogonal dipoles two and a half metres upstream of the target that paint it by sweeping the pencil beam across it, one spot at a time, at metres per second. GSI raster-scanned its first patient in 1997 and it is now how proton therapy is delivered: no patient-specific collimator, no compensator, dose shaped in three dimensions by changing range between layers. The same magnets run at kilohertz are how ESS spreads five megawatts over a target that would otherwise get a hole punched in it. Scan field is yours to set — wide paints a sample uniformly, narrow puts everything in one spot.',
    category: 'optics',
    subsection: 'manipulation',
    cost: { funding: 1800000 },
    // bendAngle in GAME units. gameplay.py multiplies by DIPOLE_ANGLE_SCALE
    // (15/90), so the engine sees game/6 physical degrees. 12 -> 2.0 deg,
    // which is the half-deflection for a 175 mm field at a 2.5 m throw.
    // computeStats recomputes this from scanFieldMm — keep the two consistent
    // or the tooltip and the physics describe different magnets.
    stats: { bendAngle: 12 },
    // Fast-slewing supplies with real dI/dt, so the draw is dipole-class
    // despite the small integrated field.
    energyCost: 20,
    // A scanning magnet's gap is generous by design: the beam is swept inside
    // it, so the aperture has to hold the whole angular range, not one ray.
    apertureRadius: 64,
    subL: 4,
    subW: 4,
    subH: 3, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 4,
    // GATED on fastKickers, which is about pulsed magnet systems with fast
    // rise times and which unlocked nothing at all before this. A raster
    // scanning magnet is that technology: a laminated or ferrite yoke and a
    // supply built to slew, run closed-loop against a dose monitor. It is not
    // the nanosecond stripline the node's text describes, but it is the same
    // engineering problem one decade slower, and it is the closest real home
    // in the tree.
    requires: 'fastKickers',
    spriteKey: 'dipole',
    spriteColor: 0x6f7fd0,
    accentColor: 0x6f7fd0,
    params: { scanFieldMm: 175 },
    placement: 'attachment',
    role: 'placement',
    textures: { iron: 'metal_brushed' },
    // The three types that deliver beam onto something with an area. therapy
    // and isotopeIrradiation want a uniform field over a tumour or a sample —
    // and isotopeIrradiation's spec carries a spotSizeMm BAND, not a floor, so
    // "add quadrupoles until sigma -> 0" is the wrong answer there and this is
    // the right one. spallation is in on the strength of ESS's raster system,
    // which exists for exactly the same reason at a thousand times the power.
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation'],
    // The first optic in the catalogue that requires dataFiber, and the
    // requirement is the identity: a scanning magnet without closed-loop dose
    // feedback from the control room is not a delivery system, it is an
    // accident. The scan pattern comes down the fibre.
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },

  // ── RF / Accel — Normal Conducting ────────────────────────────────
  buncher: {
    id: 'buncher',
    physicsType: 'rfCavity',
    name: 'Buncher',
    desc: 'Low-voltage RF cavity that imprints bunch structure onto a DC beam without significant acceleration. Operates at a sub-harmonic of the main linac frequency to give a wide capture window. Place between source and first accelerating cavity to pre-bunch the beam — dramatically improves capture efficiency downstream. Normal-conducting, low power.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 150000 },
    stats: { energyGain: 0.0001, bunchCompression: 0.15 },
    betaAcceptance: { min: 0.20, design: 0.30, max: 0.75 },
    energyCost: 1,
    apertureRadius: 32,
    subL: 2,
    subW: 2,
    subH: 4, gridW: 2, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 3,
    unlocked: true,
    spriteKey: 'pillboxCavity',
    spriteColor: 0xe0733a,
    accentColor: 0xe0733a,
    params: { voltage: 0.1, rfPhase: -90 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    requiredConnections: ['powerCable', 'rfWaveguide'],
    // 162.5 MHz — the low-band consolidation. One network carries one frequency
    // (src/utility/types/rfWaveguide.js), so the old spread of 200 / 161 / 325 /
    // 400 MHz across the front end forced a tier-2 proton line onto four
    // separate RF networks at exactly the tier where the player first meets the
    // utility system. PIP-II runs its RFQ, buncher and half-wave resonators all
    // at 162.5 MHz and its spoke resonators at 325, so the real values are also
    // the kinder ones: a proton line drops to three networks, a test stand to
    // one. Anything sharing this number shares a network.
    rfFrequency: 162.5,
    rfBand: 'vhf',
    rfPowerRequired: 2,
  },
  pillboxCavity: {
    id: 'pillboxCavity',
    physicsType: 'rfCavity',
    name: 'Pillbox Cavity',
    desc: 'Simple single-cell copper cavity for initial low-energy acceleration. ~0.5 MV/m effective gradient over a 1 m footprint delivers 0.5 MeV energy gain. Cheap and compact — a good first accelerating structure right after the source. Normal-conducting, no cryo required.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 200000 },
    stats: { energyGain: 0.0005, gradient: 0.5 },
    betaAcceptance: { min: 0.13, design: 0.20, max: 0.50 },
    energyCost: 3,
    apertureRadius: 32,
    subL: 2,
    subW: 2,
    subH: 4, gridW: 2, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 5,
    unlocked: true,
    spriteKey: 'pillboxCavity',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    params: { voltage: 0.5, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    requiredConnections: ['powerCable', 'rfWaveguide'],
    // 162.5 MHz — shares the buncher's network. See the note there.
    rfFrequency: 162.5,
    rfBand: 'vhf',
    rfPowerRequired: 5,
  },
  rfCavity: {
    id: 'rfCavity',
    physicsType: 'rfCavity',
    name: 'NC RF Cavity',
    desc: 'Normal-conducting S-band copper standing-wave cavity. 15 MV/m accelerating gradient × 3 m physical length = 45 MeV per module. Place many in series for high energy. Thermally limited to short pulses; guzzles RF power and needs aggressive water cooling.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 500000 },
    stats: { energyGain: 0.045, gradient: 15 },
    betaAcceptance: { min: 0.85, design: 0.999, max: 1.0 },
    energyCost: 20,
    apertureRadius: 19,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'cylinder',
    interiorVolume: 40,
    unlocked: true,
    spriteKey: 'rfCavity',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // beta = 1 normal conducting. euvFel is absent on purpose: at 1 GeV x
    // 10 mA CW there is no duty cycle to hide in and copper would melt.
    beamlineTypes: ['testStand', 'ebeamProcessing', 'lightSource', 'xfel', 'collider'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 2856,
    rfBand: 'sband',
    rfPowerRequired: 40,
  },
  sbandStructure: {
    id: 'sbandStructure',
    physicsType: 'rfCavity',
    name: 'S-band Structure',
    desc: 'SLAC-style constant-gradient traveling-wave normal-conducting structure. 17 MV/m × 3 m = 51 MeV per module — the same spec that powered the original SLAC linac. Cleaner beam dynamics than a standing-wave pillbox chain, but needs a dedicated high-power klystron per section.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 600000 },
    stats: { energyGain: 0.051, gradient: 17 },
    betaAcceptance: { min: 0.80, design: 0.98, max: 1.0 },
    energyCost: 15,
    apertureRadius: 19,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'cylinder',
    interiorVolume: 20,
    unlocked: true,
    spriteKey: 'rfCavity',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    params: { rfFrequency: 2856, gradient: 17 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['testStand', 'ebeamProcessing', 'lightSource', 'xfel', 'collider'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 2856,
    rfBand: 'sband',
    rfPowerRequired: 45,
  },
  // The NC frequency ladder continues here. Copper's shunt impedance goes as
  // sqrt(f), so every doubling of frequency buys gradient — and costs bore.
  // Both of these are physically honest: subL x 0.5 m is the real structure
  // length, so the gradient the balance readout derives (energyGain*1000 /
  // length) is the gradient the hardware actually holds.
  cbandStructure: {
    id: 'cbandStructure',
    physicsType: 'rfCavity',
    name: 'C-band Structure',
    desc: 'Travelling-wave copper at 5712 MHz — the frequency SACLA chose when it wanted an X-ray FEL that fit on a Japanese site. Halving the S-band wavelength roughly doubles the shunt impedance, which buys 40 MV/m over a 3 m structure: 120 MeV a module, better than twice what the same footprint of S-band returns. The bore shrinks with the wavelength, so wakefields bite harder and alignment stops being forgiving.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 6000000 },
    // 40 MV/m x 3.0 m = 120 MeV. subL 6 -> length 3 m, so gradientDemanded
    // lands on 40 exactly. Do not change one without the other.
    stats: { energyGain: 0.12, gradient: 40 },
    betaAcceptance: { min: 0.92, design: 0.999, max: 1.0 },
    energyCost: 45,
    apertureRadius: 13,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'box',
    interiorVolume: 18,
    requires: 'highGradientRf',
    spriteKey: 'rfCavity',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    params: { rfFrequency: 5712, gradient: 40 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // beta = 1 NC, same divide as rfCavity/sbandStructure. euvFel is out for
    // the same reason it is out of those two: 40 MV/m of copper at CW duty is
    // not a structure, it is a heater.
    beamlineTypes: ['lightSource', 'xfel', 'collider'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 5712,
    rfBand: 'cband',
    rfPowerRequired: 110,
  },
  xbandStructure: {
    id: 'xbandStructure',
    physicsType: 'rfCavity',
    name: 'X-band Structure',
    desc: 'Disc-loaded copper at 11.424 GHz — the NLC/JLC structure SLAC and KEK spent two decades learning to run without breaking down. 100 MV/m over 3 m puts 300 MeV in a module, the highest gradient any metal structure will hold. The price is an 8 mm bore, RF pulses measured in hundreds of nanoseconds, and a breakdown-rate spec that turns surface finish into a physics problem.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 14000000 },
    // 100 MV/m x 3.0 m = 300 MeV, and 100 MV/m is where X-band copper really
    // sits — CLIC's 12 GHz test structures run exactly this.
    stats: { energyGain: 0.30, gradient: 100 },
    betaAcceptance: { min: 0.96, design: 0.999, max: 1.0 },
    energyCost: 90,
    apertureRadius: 8,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'box',
    interiorVolume: 14,
    requires: 'highGradientRf',
    spriteKey: 'rfCavity',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    params: { rfFrequency: 11424, gradient: 100 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['lightSource', 'xfel', 'collider'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 11424,
    rfBand: 'xband',
    rfPowerRequired: 240,
  },
  industrialLinac: {
    id: 'industrialLinac',
    physicsType: 'rfCavity',
    name: 'Industrial E-beam Linac',
    desc: 'Short, rugged S-band structure built for one job: putting 10 MeV of electrons through a product stream all day. 10 MV/m over a 1 m structure in a single self-contained skid, pulsed off a magnetron or a klystron. Poor value per GeV and it will never take you past the regulatory 10 MeV ceiling — but nothing else in the catalogue lands a sterilisation line squarely in band without twenty pillbox cavities in a row.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 400000 },
    // 10 MV/m x 1.0 m active = 10 MeV, the number the whole industry quotes:
    // above ~10 MeV an electron beam starts activating what it irradiates, so
    // the regulator caps the product there and every vendor builds to it.
    // gradientDemanded is derived as energyGain*1000/length in gameplay.py,
    // with length = subL x 0.5 m — so subL 2 must match l_active 1.0 in
    // CAVITY_SPECS or the catalogue gain and the physics gain disagree.
    stats: { energyGain: 0.010, gradient: 10 },
    betaAcceptance: { min: 0.60, design: 0.95, max: 1.0 },
    energyCost: 8,
    apertureRadius: 19,
    subL: 2,
    subW: 2,
    subH: 4, gridW: 2, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 6,
    // UNGATED, like the type it exists for. E-beam processing is the roster's
    // tier-1 money line and its whole point is that a player can build it on
    // tick 0; a research gate here would put $7.6M of tree in front of the
    // first commercial beamline and turn the opening into a grind.
    unlocked: true,
    spriteKey: 'rfCavity',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    params: { rfFrequency: 2856, gradient: 10 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['ebeamProcessing'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 2856,
    rfBand: 'sband',
    rfPowerRequired: 20,
  },
  rfq: {
    id: 'rfq',
    physicsType: 'rfCavity',
    name: 'RFQ',
    desc: 'Radio-Frequency Quadrupole that simultaneously bunches and accelerates beam from keV to 3 MeV. The classic first accelerating structure after a source — it captures the DC beam and forms it into bunches while gently accelerating. Normal-conducting copper vanes at ~1 MV/m averaged over 3 m.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 1500000 },
    // An RFQ is also a strong alternating-gradient channel.  The previous
    // drift-only model threw away nearly every captured high-current ion in
    // its real 6 mm bore; this smooth-focusing strength represents the
    // distributed vane field while keeping the physical aperture honest.
    stats: { energyGain: 0.003, bunchCompression: 0.5, gradient: 1.0, focusStrength: 60 },
    // RFQ vane modulation is the deliberate hand-off from a source at a few
    // thousandths of c to a bunched beam near beta=0.08. It is the first rung,
    // not a magic jump to beta=1; the DTL and spoke sections continue the climb.
    betaAcceptance: { min: 0.005, design: 0.04, max: 0.10, tracksBeam: true },
    energyCost: 6,
    apertureRadius: 6,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'cylinder',
    interiorVolume: 15,
    // GATED with ionSource: an RFQ only captures a DC ion beam, so it is dead
    // hardware until protonAcceleration lands. Electron openings use the free
    // buncher/pillboxCavity/rfCavity chain instead.
    requires: 'protonAcceleration',
    spriteKey: 'rfq',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    params: { intervaneVoltage: 80, rfPhase: -30 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // The only device that captures a DC ion beam, so it is dead hardware on
    // any electron line.
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    // 162.5 MHz, the PIP-II RFQ frequency — shares the buncher's network so the
    // ion front end is one waveguide run, not three. See the note on buncher.
    rfFrequency: 162.5,
    rfBand: 'vhf',
    rfPowerRequired: 25,
  },
  dtl: {
    id: 'dtl',
    physicsType: 'rfCavity',
    name: 'Drift-Tube Linac',
    desc: 'Alvarez drift-tube linac for the first post-RFQ acceleration stage. The RFQ hands it a captured beam near beta 0.08; progressively longer drift tubes keep that rising-speed beam shielded during the decelerating half-cycle and carry it through the low-to-medium-beta gap toward spoke or elliptical structures. Three metres at 3 MV/m delivers about 7.3 MeV at the default synchronous phase.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 2200000 },
    stats: { energyGain: 0.0073, gradient: 3 },
    betaAcceptance: { min: 0.06, design: 0.16, max: 0.38, tracksBeam: true },
    energyCost: 22,
    apertureRadius: 18,
    subL: 6,
    subW: 4,
    subH: 4, gridW: 4, gridH: 6, geometryType: 'cylinder',
    interiorVolume: 28,
    requires: 'protonAcceleration',
    spriteKey: 'rfCavity',
    spriteColor: 0xc95a34,
    accentColor: 0xf09a4a,
    params: { gradient: 3, rfPhase: -25 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    rfFrequency: 325,
    rfBand: 'vhf',
    rfPowerRequired: 45,
  },
  // The two top rungs of the whole ladder. Both are filed under
  // normalConducting because neither has a cryostat, but neither is an
  // ordinary copper structure either: one gets its power from a second beam,
  // the other from a plasma.
  twoBeamModule: {
    id: 'twoBeamModule',
    physicsType: 'rfCavity',
    name: 'Two-Beam Module',
    desc: "CLIC's answer to \"where do you get 100 MV/m of X-band from\": you don't build klystrons, you build a second beam. A high-current 12 GHz drive beam runs alongside the main line and hands its energy across through PETS decelerators. One placement is FIVE two-beam modules end to end — a CLIC module is about 2 m long and nobody places sixty of them by hand — so what you are buying is 6 GeV of main linac in 12 m of map, not a single device holding 500 MV/m.",
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 126000000 },
    // ABSTRACTION. 6.0 GeV over subL 24 (12 m) derives 500 MV/m, which no
    // copper holds; the real structures run 100 MV/m and this placement stands
    // for five of them. stats.gradient states the derived sector figure so the
    // balance readout and the catalogue agree — the desc is where the honesty
    // about what it represents lives.
    stats: { energyGain: 6.0, gradient: 500 },
    betaAcceptance: { min: 0.995, design: 0.9999, max: 1.0 },
    energyCost: 120,
    apertureRadius: 6,
    subL: 24,
    subW: 4,
    subH: 4, gridW: 4, gridH: 24, geometryType: 'box',
    interiorVolume: 90,
    requires: 'highLuminosity',
    spriteKey: 'rfCavity',
    spriteColor: 0xd8463a,
    accentColor: 0xd8463a,
    params: { rfFrequency: 11994, gradient: 100 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['collider'],
    requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'],
    // 11994 MHz, CLIC's number rather than the 11424 of the NLC line — same
    // band, different network. The waveguide feed is modest for the energy
    // because the DRIVE BEAM carries the power; what comes down the guide is
    // the drive-beam injector's share, not 6 GeV of RF.
    rfFrequency: 11994,
    rfBand: 'xband',
    rfPowerRequired: 400,
  },
  plasmaAfterburner: {
    id: 'plasmaAfterburner',
    physicsType: 'rfCavity',
    name: 'Plasma Afterburner',
    desc: 'A sapphire capillary, a metre of hydrogen plasma and a wakefield of 1.5 GV/m — a thousand times what copper holds before it arcs. Fifteen GeV in ten metres, driven by a laser hall that costs more than the accelerator and turns under a percent of its wall power into light. Emittance growth, energy spread and shot-to-shot jitter are all worse than anything else on this ladder, which is precisely the trade a TeV machine makes when the alternative is thirty more kilometres of tunnel.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 255000000 },
    // HONEST. 15 GeV over subL 20 (10 m) derives 1500 MV/m = 1.5 GV/m, which
    // is what a laser-driven wake actually sustains. This is the one rung
    // where the absurd number in the balance readout is the real number.
    stats: { energyGain: 15, gradient: 1500 },
    betaAcceptance: { min: 0.995, design: 0.9999, max: 1.0 },
    // The drive laser, not the beam. A titanium-sapphire chain at a few
    // tenths of a percent wall-plug efficiency is the single largest
    // electrical load any beamline component in this catalogue presents.
    energyCost: 500,
    apertureRadius: 12,
    subL: 20,
    subW: 4,
    subH: 4, gridW: 4, gridH: 20, geometryType: 'cylinder',
    interiorVolume: 40,
    requires: 'plasmaAcceleration',
    spriteKey: 'lwfaStation',
    spriteColor: 0x9d6fd0,
    accentColor: 0x9d6fd0,
    params: { rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['collider'],
    // NOT RF HARDWARE, and the absence of rfWaveguide is the identity — there
    // is no cavity to drive and no frequency to match, so it carries no
    // rfFrequency and no rfBand either. What it wants instead is a
    // substation's worth of electricity for the laser, a chiller loop to take
    // that same power back as heat, and a femtosecond timing fibre: the
    // laser-to-plasma synchronisation is what sets the energy jitter of every
    // bunch it makes. Same shape as lwfaStation, for the same reasons.
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  crystalChannelStage: {
    id: 'crystalChannelStage',
    physicsType: 'rfCavity',
    name: 'Crystal Channeling Stage',
    desc: "A bent silicon wafer in a goniometer, and a beam threaded down the corridor between two lattice planes. Inside that corridor the atomic rows themselves are the field: Tajima and Cavenago put the coherent accelerating gradient at 1-10 TeV/m in 1987, a thousand times a plasma wakefield and a million times copper, because the field is set by the spacing of atoms rather than by what a surface can hold before it arcs. CERN's UA9 and the LHC crystal-collimation programme have been steering 6.5 TeV protons through bent silicon for years, so the channeling is not the speculative part — driving the lattice hard enough to accelerate is. What you buy is 12 TeV in ten metres, an acceptance measured in microradians, and a crystal that has to be re-aligned continuously while a TeV beam deposits into it.",
    category: 'rf',
    subsection: 'normalConducting',
    // PROVISIONAL, and deliberately off the ladder's $/GeV curve. Every rung
    // below this one is priced on how much accelerating structure you are
    // buying — $17M/GeV at plasmaAfterburner, $21M at twoBeamModule — and
    // extrapolating that here gives $200B a placement. It is the wrong curve:
    // the accelerating medium is a wafer of silicon and costs nothing. What
    // costs is the goniometer, the interferometric alignment and the crystal's
    // replacement schedule, none of which scale with energy. $900M a stage is
    // $0.075M/GeV, and 42 of them — the full 500 TeV arm — is $37.8B against a
    // land ladder that tops out at $18.5B. Calibrate in balance-sim.mjs.
    cost: { funding: 900000000 },
    // 12000 GeV over subL 20 (10 m) derives 1,200,000 MV/m = 1.2 TeV/m, the
    // honest LOW end of the 1-10 TeV/m the channeling literature discusses.
    // The unit is MV/m throughout the ladder and stays MV/m here so the number
    // reads on the same axis as plasmaAfterburner's 1500 — which is the point:
    // this rung is three orders of magnitude above it, and the readout should
    // say so rather than quietly changing units.
    stats: { energyGain: 12000, gradient: 1200000 },
    betaAcceptance: { min: 0.999, design: 0.99999, max: 1.0 },
    // The crystal is passive; the bill is the mount. A cryogenic goniometer
    // holding microradian alignment against the thermal shock of a TeV-scale
    // beam is the largest electrical load in the catalogue, and essentially
    // all of it comes back as heat into the water loop.
    energyCost: 2000,
    // The tightest bore in the catalogue, and it flatters the real device: a
    // channeled beam has to arrive inside the Lindhard critical angle, which
    // is tens of microradians. The game models the physical aperture only, so
    // the acceptance penalty this hardware really carries is not charged here.
    apertureRadius: 4,
    subL: 20,
    subW: 4,
    subH: 4, gridW: 4, gridH: 20, geometryType: 'box',
    interiorVolume: 40,
    // targetPhysicsAdv is the tree's node for a beam inside dense matter under
    // extreme conditions — high-Z, cryogenic, remote-handled because of the
    // activation — which is exactly what a channeling stage is. It is also a
    // prerequisite of antimatter and therefore of colliderTech, so the node can
    // never be missing when blackHoleFactory unlocks. The node advertised
    // nothing at all before this.
    requires: 'targetPhysicsAdv',
    spriteKey: 'rfCavity',
    spriteColor: 0x7fd4e8,
    accentColor: 0x7fd4e8,
    // No PARAM_DEFS entry and no gradient slider, unlike every rung below it.
    // The accelerating field is set by the lattice constant of silicon; there
    // is no knob, only alignment. rfPhase is carried so gameplay.py's rfCavity
    // branch reads a defined value rather than falling through to a default.
    params: { rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['blackHoleFactory'],
    // NOT RF-fed, and for a different reason than plasmaAfterburner: there is
    // no cavity, no resonance and no drive field of any kind, so no
    // rfFrequency and no rfBand. Power and water run the goniometer and take
    // the deposited beam back out as heat; the fibre is the alignment
    // interferometer, which is the one system that decides whether this thing
    // accelerates at all or just scatters a very expensive beam.
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },

  // ── RF / Accel — Superconducting ──────────────────────────────────
  halfWaveResonator: {
    id: 'halfWaveResonator',
    physicsType: 'rfCavity',
    name: 'Half-Wave Resonator',
    desc: 'Superconducting coaxial cavity operating at half the RF wavelength. Peak ~5 MV/m in the gap but the active length is tiny compared to the cryostat, giving ~1 MV/m effective over the 1 m footprint → 1 MeV per module. Low per-module gain but near-zero wall losses means CW operation at any duty cycle. Ideal for low-β ion and proton acceleration. Requires cryo.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 400000 },
    stats: { energyGain: 0.001, gradient: 1 },
    betaAcceptance: { min: 0.065, design: 0.10, max: 0.22 },
    energyCost: 4,
    apertureRadius: 24,
    subL: 2,
    subW: 3,
    subH: 4, gridW: 3, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 6,
    unlocked: true,
    spriteKey: 'pillboxCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 162.5, voltage: 1.0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // Low-beta SRF: cut for a particle still well short of light speed, which
    // is exactly the ion front end and nowhere else.
    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    // 162.5, not 161 — the real PIP-II HWR number, and the same one the RFQ and
    // buncher use, so the whole low-β front end rides one network.
    rfFrequency: 162.5,
    rfBand: 'vhf',
    rfPowerRequired: 3,
  },
  spokeCavity: {
    id: 'spokeCavity',
    physicsType: 'rfCavity',
    name: 'Spoke Cavity',
    desc: 'Superconducting double-spoke resonator that bridges low-β and high-β acceleration. Peak ~8 MV/m at the spoke irises averages to 5 MV/m effective × 2 m footprint = 10 MeV per module. Compact, mechanically stiff, excellent frequency stability. Requires cryo.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 600000 },
    stats: { energyGain: 0.01, gradient: 5 },
    betaAcceptance: { min: 0.22, design: 0.35, max: 0.58 },
    energyCost: 5,
    apertureRadius: 32,
    subL: 4,
    subW: 3,
    subH: 4, gridW: 3, gridH: 4, geometryType: 'cylinder',
    interiorVolume: 10,
    unlocked: true,
    spriteKey: 'rfCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 325, gradient: 8 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['isotopeIrradiation', 'therapy', 'spallation'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 325,
    rfBand: 'vhf',
    rfPowerRequired: 8,
  },
  ellipticalSrfCavity: {
    id: 'ellipticalSrfCavity',
    physicsType: 'rfCavity',
    name: '9-cell Elliptical SRF',
    desc: 'TESLA/XFEL-style nine-cell niobium elliptical cavity in its own helium vessel. 25 MV/m × 1.5 m footprint = 37.5 MeV per cavity — the workhorse high-β SRF structure used by European XFEL, LCLS-II, and the ILC design. CW-capable with vanishing wall losses, but lives in liquid helium at 2 K. Requires cryo.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 1800000 },
    stats: { energyGain: 0.0375, gradient: 25 },
    betaAcceptance: { min: 0.85, design: 0.999, max: 1.0 },
    energyCost: 3,
    apertureRadius: 56,
    subL: 3,
    subW: 3,
    subH: 4, gridW: 3, gridH: 3, geometryType: 'cylinder',
    interiorVolume: 8,
    unlocked: true,
    spriteKey: 'rfCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 1300, gradient: 25, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // beta = 1 SRF. Absent from the two tier-1 types on purpose: a 2 K
    // cryoplant costs more than the building a test stand lives in, which is
    // what makes cryogenics a tier-2 unlock story rather than something the
    // tutorial trips over.
    beamlineTypes: ['lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 1300,
    rfBand: 'lband',
    rfPowerRequired: 5,
  },
  // The proton beta-ladder. 650 MHz medium-beta then 805 MHz high-beta is
  // literally how SNS and PIP-II are sectioned, so the optimal spallation
  // build reproduces the real machine's layout. These are the structures the
  // header note's beta divide was always pointing at: at 800 MeV a proton is
  // beta = 0.84 and an elliptical cavity is exactly the right hardware, which
  // is why the ban on elliptical cavities for protons stops at the front end.
  srf650Cryomodule: {
    id: 'srf650Cryomodule',
    physicsType: 'cryomodule',
    name: '650 MHz Cryomodule',
    desc: 'Five beta = 0.61 elliptical niobium cavities at 650 MHz in one 10 m cryostat — the medium-beta section of PIP-II, and the exact hardware that carries a proton linac from 180 MeV to about half a GeV. 15 MV/m across the module gives 150 MeV. The cells are cut for a particle at 61% of light speed, which is precisely why a 1.3 GHz electron cryomodule would arrive out of phase and decelerate the same beam.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 9000000 },
    // HONEST. 0.15 GeV over subL 20 (10 m) derives 15 MV/m, which is what a
    // 650 MHz medium-beta string really runs.
    stats: { energyGain: 0.15, gradient: 15 },
    betaAcceptance: { min: 0.45, design: 0.61, max: 0.76 },
    energyCost: 8,
    apertureRadius: 72,
    subL: 20,
    subW: 4,
    subH: 4, gridW: 4, gridH: 20, geometryType: 'cylinder',
    interiorVolume: 100,
    requires: 'cwLinacDesign',
    spriteKey: 'rfCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 650, gradient: 15, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // The only type in the roster that needs 0.8-3 GeV of protons. therapy
    // tops out at 250 MeV and isotopeIrradiation at 70, so neither would ever
    // reach the energy where a medium-beta elliptical is the right answer.
    beamlineTypes: ['spallation'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 650,
    rfBand: 'uhf',
    rfPowerRequired: 60,
  },
  srf805Cryomodule: {
    id: 'srf805Cryomodule',
    physicsType: 'cryomodule',
    name: '805 MHz Cryomodule',
    desc: 'Beta = 0.86 elliptical niobium at 805 MHz — the high-beta half of the SNS layout, what you put after the 650s to take protons from half a GeV to a megawatt-class target. One placement is TWO cryomodules plus the warm intermodule section between them, plumbed and commissioned as a single cryogenic sector: 400 MeV over 12 m of tunnel. Buying the sector rather than the module is the only reason a spallation linac fits on a map you can afford.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 20000000 },
    // ABSTRACTION. 0.4 GeV over subL 24 (12 m) derives 33 MV/m; a real 805 MHz
    // high-beta cavity runs about half that, and this placement stands for two
    // modules. stats.gradient states the derived sector figure so the balance
    // readout agrees with the catalogue.
    stats: { energyGain: 0.40, gradient: 33 },
    betaAcceptance: { min: 0.68, design: 0.86, max: 0.96 },
    energyCost: 14,
    apertureRadius: 60,
    subL: 24,
    subW: 4,
    subH: 4, gridW: 4, gridH: 24, geometryType: 'cylinder',
    interiorVolume: 120,
    // NOT `superconducting`: that node is hidden: true (merged into
    // srfTechnology, kept for save compat) and validate.js refuses any gate
    // behind a hidden node — canStartResearch can never open it, so the
    // hardware would be unbuildable in every playthrough. cryomoduleDesign is
    // the live node whose whole subject is integrated cryomodule engineering.
    requires: 'cryomoduleDesign',
    spriteKey: 'rfCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 805, gradient: 18, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['spallation'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 805,
    rfBand: 'uhf',
    rfPowerRequired: 120,
  },
  cryomodule: {
    id: 'cryomodule',
    physicsType: 'cryomodule',
    name: 'TESLA Cryomodule',
    desc: 'Eight 9-cell niobium elliptical cavities packed into a single 2 K cryostat. 25 MV/m effective × 8 m footprint delivers 200 MeV per module. The standard SRF building block for modern CW linacs (European XFEL, LCLS-II, SHINE). Expensive, thirsty for liquid helium, and worth every penny.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 12000000 },
    stats: { energyGain: 0.2, gradient: 25 },
    betaAcceptance: { min: 0.85, design: 0.999, max: 1.0 },
    energyCost: 12,
    apertureRadius: 56,
    subL: 16,
    subW: 4,
    subH: 4, gridW: 4, gridH: 16, geometryType: 'cylinder',
    interiorVolume: 80,
    // GATED: the headline SRF purchase. $12M of hardware that needs a cryo
    // plant behind it — srfTechnology unlocks the plant (heCompressor,
    // coldBox4K, ln2Precooler, cryomoduleHousing) and this in one step, so the
    // module can never be buildable before the cooling it depends on.
    requires: 'srfTechnology',
    spriteKey: 'rfCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 1300, gradient: 25, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 1300,
    rfBand: 'lband',
    rfPowerRequired: 40,
  },
  // Above the TESLA cryomodule the unit of purchase stops being a module and
  // starts being a cryogenic SECTOR. That is the governing principle of this
  // whole ladder: cost tracks energy, footprint does not, so research buys
  // COMPACTNESS rather than making energy free. Each desc below states how
  // many modules the placement stands for, because the gradient the balance
  // readout derives (energyGain*1000 / length) is a sector average and not a
  // number any single cavity holds.
  cwCryomodule: {
    id: 'cwCryomodule',
    physicsType: 'cryomodule',
    name: 'CW Cryomodule Sector',
    desc: 'LCLS-II-style 1.3 GHz niobium run at continuous duty — nitrogen-doped cavities at 2 K with no pulse structure to hide the heat load in. One placement is THREE cryomodules on one cryogenic string, 500 MeV over 12 m. The cryoplant behind it is the real purchase: CW means every watt of wall loss is a watt you pay Carnot for forever, at roughly 300 W of room-temperature power per watt of cooling. The right answer for an ERL, or any machine that wants MHz repetition rates.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 22000000 },
    // ABSTRACTION — three modules. 0.5 GeV over 12 m derives 42 MV/m; real CW
    // 1.3 GHz cavities run about 16.
    stats: { energyGain: 0.50, gradient: 42 },
    betaAcceptance: { min: 0.85, design: 0.999, max: 1.0 },
    energyCost: 16,
    apertureRadius: 56,
    subL: 24,
    subW: 4,
    subH: 4, gridW: 4, gridH: 24, geometryType: 'cylinder',
    interiorVolume: 120,
    requires: 'cryomoduleDesign',
    spriteKey: 'rfCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 1300, gradient: 16, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 1300,
    rfBand: 'lband',
    rfPowerRequired: 100,
  },
  nbSnCryomodule: {
    id: 'nbSnCryomodule',
    physicsType: 'cryomodule',
    name: 'Nb3Sn Cryomodule Sector',
    desc: 'Nb3Sn films grown on the niobium, so the cavities superconduct at 4.5 K instead of 2 K and the refrigerator behind them costs a fraction as much to run — no cold compressors, no sub-atmospheric helium, no superfluid. One placement is SIX cryomodules on a single cryogenic string: 1.2 GeV over 12 m of tunnel. Cornell and Fermilab have had Nb3Sn cavities past 15 MV/m for years; buying a whole sector of them is what turns an XFEL from a two-kilometre machine into something you can site.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 42000000 },
    // ABSTRACTION — six modules. 1.2 GeV over 12 m derives 100 MV/m; Nb3Sn
    // cavities run about 17.
    stats: { energyGain: 1.2, gradient: 100 },
    betaAcceptance: { min: 0.85, design: 0.999, max: 1.0 },
    energyCost: 20,
    apertureRadius: 56,
    subL: 24,
    subW: 4,
    subH: 4, gridW: 4, gridH: 24, geometryType: 'cylinder',
    interiorVolume: 120,
    requires: 'nDopedSrf',
    spriteKey: 'rfCavity',
    spriteColor: 0xf0b455,
    accentColor: 0xf0b455,
    params: { rfFrequency: 1300, gradient: 17, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    beamlineTypes: ['lightSource', 'xfel', 'euvFel', 'collider'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 1300,
    rfBand: 'lband',
    rfPowerRequired: 200,
  },
  srfLinacSector: {
    id: 'srfLinacSector',
    physicsType: 'cryomodule',
    name: 'SRF Linac Sector',
    desc: 'Not a module — a SECTOR. Seventeen 1.3 GHz cryomodules on one cryogenic string with its own feed cap, end cap and distribution box, delivered and commissioned as a unit: 3.5 GeV in 16 m of map. This is how European XFEL and the ILC design are actually costed and built, in sectors rather than modules, and it is the only thing that stops a linear collider arm from being a thousand separate placements.',
    category: 'rf',
    subsection: 'superconducting',
    cost: { funding: 91000000 },
    // ABSTRACTION — seventeen modules. 3.5 GeV over subL 32 (16 m) derives
    // 219 MV/m; the cavities in it run about 25, same as a TESLA cryomodule.
    stats: { energyGain: 3.5, gradient: 219 },
    betaAcceptance: { min: 0.85, design: 0.999, max: 1.0 },
    energyCost: 45,
    apertureRadius: 56,
    subL: 32,
    subW: 4,
    subH: 4, gridW: 4, gridH: 32, geometryType: 'cylinder',
    interiorVolume: 160,
    requires: 'colliderTech',
    spriteKey: 'rfCavity',
    spriteColor: 0xe89b2c,
    accentColor: 0xe89b2c,
    params: { rfFrequency: 1300, gradient: 25, rfPhase: 0 },
    placement: 'module',
    role: 'placement',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    // The two single-pass machines with kilometres to fill. Deliberately not
    // lightSource or euvFel: 3.5 GeV in one placement overshoots both bands
    // on its own, so it would be a trap rather than an upgrade.
    beamlineTypes: ['xfel', 'collider'],
    requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'],
    rfFrequency: 1300,
    rfBand: 'lband',
    rfPowerRequired: 600,
  },

  // ── Diagnostics ───────────────────────────────────────────────────
  bpm: {
    id: 'bpm',
    physicsType: 'drift', // diagnostics are thin drift-like elements
    name: 'BPM',
    desc: 'Non-destructive sensor that measures the beam position on every pulse without disturbing the beam. Place regularly along your beamline to monitor orbit stability. Cheap and essential — BPMs are the eyes of your machine. Tiny quality boost from better orbit awareness.',
    category: 'diagnostic',
    subsection: 'monitors',
    cost: { funding: 30000 },
    stats: { beamQuality: 0.02 },
    energyCost: 0.1,
    apertureRadius: 40,
    subL: 1,
    subW: 1,
    subH: 2, gridW: 1, gridH: 1, geometryType: 'cylinder',
    interiorVolume: 0.5,
    unlocked: true,
    spriteKey: 'bpm',
    spriteColor: 0xe0e0e0,
    accentColor: 0xe0e0e0,
    placement: 'attachment',
    attachmentKind: 'inline',
    role: 'placement',

    requiredConnections: ['powerCable', 'dataFiber'],
  },
  screen: {
    id: 'screen',
    physicsType: 'drift', // diagnostics are thin drift-like elements
    name: 'Screen/YAG',
    desc: 'Insertable fluorescent screen (YAG crystal) that images the beam cross-section when lowered into the beam path. Destructive when inserted — blocks the beam during measurement. Use during commissioning or tuning to verify beam size and shape.',
    category: 'diagnostic',
    subsection: 'monitors',
    cost: { funding: 50000 },
    stats: { beamQuality: 0.03 },
    energyCost: 0.2,
    apertureRadius: 40,
    subL: 1,
    subW: 2,
    subH: 2, gridW: 2, gridH: 1, geometryType: 'cylinder',
    interiorVolume: 2,
    unlocked: true,
    spriteKey: 'screen',
    spriteColor: 0xe0e0e0,
    accentColor: 0xe0e0e0,
    placement: 'attachment',
    attachmentKind: 'inline',
    role: 'placement',

    requiredConnections: ['powerCable', 'dataFiber'],
  },
  ict: {
    id: 'ict',
    physicsType: 'drift', // diagnostics are thin drift-like elements
    name: 'Current Monitor (ICT)',
    desc: 'Integrating Current Transformer that measures the total charge in each beam pulse without touching the beam. Essential for monitoring beam transmission — compare readings at different points to detect losses along the beamline.',
    category: 'diagnostic',
    subsection: 'monitors',
    cost: { funding: 40000 },
    stats: {},
    energyCost: 0.1,
    apertureRadius: 40,
    subL: 1,
    subW: 1,
    subH: 2, gridW: 1, gridH: 1, geometryType: 'cylinder',
    interiorVolume: 0.5,
    unlocked: true,
    spriteKey: 'ict',
    spriteColor: 0xe0e0e0,
    accentColor: 0xe0e0e0,
    placement: 'attachment',
    attachmentKind: 'inline',
    role: 'placement',

    requiredConnections: ['powerCable', 'dataFiber'],
  },
  wireScanner: {
    id: 'wireScanner',
    physicsType: 'drift', // diagnostics are thin drift-like elements
    name: 'Wire Scanner',
    desc: 'Moves a thin wire through the beam to measure the transverse profile with high precision. Provides emittance measurements — the key figure of merit for beam quality. Slightly destructive but much less than a screen.',
    category: 'diagnostic',
    subsection: 'monitors',
    cost: { funding: 200000 },
    stats: { beamQuality: 0.05 },
    energyCost: 0.5,
    apertureRadius: 40,
    subL: 1,
    subW: 2,
    subH: 2, gridW: 2, gridH: 1, geometryType: 'cylinder',
    interiorVolume: 1.5,
    // GATED: emittance measurement is the first diagnostics upgrade, not a
    // starting instrument — bpm/screen/ict stay free so the opening beamline is
    // still observable. beamDiagnostics is a root node, so this is reachable in
    // the first research pass.
    requires: 'beamDiagnostics',
    spriteKey: 'wireScanner',
    spriteColor: 0xe0e0e0,
    accentColor: 0xe0e0e0,
    placement: 'attachment',
    attachmentKind: 'inline',
    role: 'placement',

    requiredConnections: ['powerCable', 'dataFiber'],
  },

  // ── Endpoints ─────────────────────────────────────────────────────
  faradayCup: {
    id: 'faradayCup',
    physicsType: 'drift', // endpoint; dataRate is gameplay economy, not physics (old fallthrough)
    name: 'Faraday Cup',
    desc: 'Simple metal cup that stops the beam and measures the total current by collecting all charge. The cheapest possible endpoint — use it to terminate your beamline while you build up to a real detector. Generates a trickle of data from current measurements. Must be wired to the control room via data fiber to collect data. No beam passes beyond this point.',
    category: 'endpoint',
    subsection: 'detectors',
    cost: { funding: 30000 },
    stats: { dataRate: 0.1 },
    energyCost: 0,
    apertureRadius: 48,
    subL: 4,
    subW: 2,
    subH: 2, gridW: 2, gridH: 4, geometryType: 'cylinder',
    interiorVolume: 1,
    unlocked: true,
    isEndpoint: true,
    spriteKey: 'detector',
    spriteColor: 0x8a8f96,
    accentColor: 0x8a8f96,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      entry: { side: 'back' },
    },

    requiredConnections: ['powerCable', 'dataFiber'],
  },
  beamStop: {
    id: 'beamStop',
    physicsType: 'beamStop', // thin absorber — lattice.THIN_EFFECT_TYPES
    name: 'Beam Stop',
    desc: 'Water-cooled copper block that safely absorbs the full beam. Every accelerator needs a beam stop as a termination point — it is the simplest way to end your beamline safely. No data output but handles any beam power. Essential safety equipment.',
    category: 'endpoint',
    subsection: 'targets',
    cost: { funding: 200000 },
    stats: {},
    energyCost: 0,
    apertureRadius: 48,
    subL: 4,
    subW: 4,
    subH: 3, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 5,
    unlocked: true,
    isEndpoint: true,
    spriteKey: 'target',
    spriteColor: 0x8a8f96,
    accentColor: 0x8a8f96,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      entry: { side: 'back' },
    },

    requiredConnections: ['coolingWater'],
  },
  detector: {
    id: 'detector',
    physicsType: 'detector',
    name: 'Detector',
    desc: 'General-purpose particle detector that records beam interactions and generates research data points per second. Place at the end of your beamline to start earning data. Higher beam energy and quality increase data output. Must be wired to the control room via data fiber. Data is used to unlock research upgrades.',
    category: 'endpoint',
    subsection: 'detectors',
    cost: { funding: 50000000 },
    stats: { dataRate: 1 },
    energyCost: 15,
    apertureRadius: 80,
    subL: 12,
    subW: 6,
    subH: 3, gridW: 6, gridH: 12, geometryType: 'box',
    interiorVolume: 200,
    unlocked: true,
    spriteKey: 'detector',
    spriteColor: 0x8a8f96,
    accentColor: 0x8a8f96,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      entry: { side: 'back' },
    },

    // A $50M 4-pi spectrometer is what a collider experiment IS, and it is not
    // what any other kind of facility buys.
    beamlineTypes: ['collider'],
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  collisionPoint: {
    id: 'collisionPoint',
    physicsType: 'drift', // beam_beam only fires on physicsType 'detector' in collider machines (old fallthrough)
    name: 'Collision Point',
    desc: 'Interaction region where two opposing beams meet head-on and annihilate. Both beams terminate here; secondary products spray into surrounding detector volumes. The heart of a collider experiment.',
    category: 'endpoint',
    subsection: 'detectors',
    cost: { funding: 500000 },
    stats: { collisionRate: 5 },
    energyCost: 2,
    apertureRadius: 40,
    subL: 2,
    subW: 2,
    subH: 2, gridW: 2, gridH: 2, geometryType: 'box',
    interiorVolume: 2,
    unlocked: false,
    isEndpoint: true,
    spriteKey: 'detector',
    spriteColor: 0xcf5bb0,
    accentColor: 0xcf5bb0,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      entryA: { side: 'back' },
      entryB: { side: 'front' },
    },

    beamlineTypes: ['collider'],
    requiredConnections: ['powerCable', 'dataFiber'],
  },
  blackHoleChamber: {
    id: 'blackHoleChamber',
    physicsType: 'detector', // beam_beam fires on physicsType 'detector' — this IS the interaction region
    name: 'Black Hole Chamber',
    desc: 'The interaction region of a 200 TeV to 1 PeV hadron collider: a twelve-metre spherical vessel, a final-focus doublet on each side squeezing beta-star to millimetres, and forty metres of tungsten and concrete around it because the debris from a collision at this energy is a shower nothing else in the facility is rated for. If the fundamental Planck scale really sits near a TeV, a parton pair passing inside its own Schwarzschild radius here makes a black hole with a lifetime of 10^-26 seconds; if it does not, this is the most expensive way ever built to measure a cross-section that is zero.',
    category: 'endpoint',
    subsection: 'detectors',
    cost: { funding: 4000000000 },
    stats: { collisionRate: 12 },
    energyCost: 400,
    apertureRadius: 60,
    subL: 12,
    subW: 8,
    subH: 8, gridW: 8, gridH: 12, geometryType: 'box',
    interiorVolume: 400,
    // particleDiscovery is the tree's node about claiming a result at five
    // sigma, and it unlocked nothing whatsoever until this. It sits one step
    // past highLuminosity, the same parent colliderTech descends from, so a
    // player who can build a linear collider is one node away from this.
    requires: 'particleDiscovery',
    isEndpoint: true,
    spriteKey: 'detector',
    spriteColor: 0xff7a18,
    accentColor: 0xff7a18,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      // Two counter-propagating arms terminate here, exactly as collisionPoint
      // does. It is the one beam-port shape the router already knows how to
      // lay out for a collider, and a black hole factory is a collider.
      entryA: { side: 'back' },
      entryB: { side: 'front' },
    },

    beamlineTypes: ['blackHoleFactory'],
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  hawkingDetector: {
    id: 'hawkingDetector',
    physicsType: 'detector',
    name: 'Hawking Radiation Detector',
    desc: 'A hermetic calorimeter built around one question: does the thing that just decayed radiate democratically? A black hole evaporating by Hawking radiation emits into every degree of freedom in roughly equal measure — quarks, leptons, photons, gluons, all of them — which is a signature no Standard Model process produces, and it is why this is a detector for a spectrum rather than a detector for a particle. It sells nothing. There is no customer for a high-multiplicity event with a thermal spectrum, and there never will be; what it produces is reputation and the possibility of being right.',
    category: 'endpoint',
    subsection: 'detectors',
    cost: { funding: 1800000000 },
    // The highest data rate of any endpoint, and it earns no collisionRate at
    // all — the collider's `detector` sells neither, but it still counts
    // events. This one is paid entirely in what it learns.
    stats: { dataRate: 40 },
    energyCost: 250,
    apertureRadius: 90,
    subL: 14,
    subW: 8,
    subH: 6, gridW: 8, gridH: 14, geometryType: 'box',
    interiorVolume: 500,
    requires: 'particleDiscovery',
    spriteKey: 'detector',
    spriteColor: 0xff7a18,
    accentColor: 0xff7a18,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      entry: { side: 'back' },
    },

    beamlineTypes: ['blackHoleFactory'],
    requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  target: {
    id: 'target',
    physicsType: 'target',
    name: 'Target',
    desc: 'Fixed target station where the beam impacts a material to produce secondary particles. Acts as an endpoint — the beamline terminates here. Generates collision events at twice the rate of a detector. Best for high-energy beams. Must be wired to the control room via data fiber.',
    category: 'endpoint',
    subsection: 'targets',
    cost: { funding: 1000000 },
    stats: { collisionRate: 2 },
    energyCost: 0,
    apertureRadius: 48,
    subL: 4,
    subW: 4,
    subH: 3, gridW: 4, gridH: 4, geometryType: 'box',
    interiorVolume: 15,
    // GATED: 2× the collision rate of a detector is an income step up, so it
    // must be bought. faradayCup and beamStop stay free, so a first beamline
    // can still terminate legally; targetPhysics is a root node ($1M) and is
    // meant to be one of the opening research choices.
    requires: 'targetPhysics',
    isEndpoint: true,
    spriteKey: 'target',
    spriteColor: 0x8a8f96,
    accentColor: 0x8a8f96,
    placement: 'module',
    role: 'junction',
    routing: [],
    ports: {
      entry: { side: 'back' },
    },

    // A flexible, general-purpose target remains useful as the low-cost
    // fallback. The purpose-built isotope and neutron targets below are what
    // give their beamline types an endpoint that names the work being done.
    beamlineTypes: ['isotopeIrradiation', 'spallation'],
    requiredConnections: ['coolingWater', 'dataFiber'],
  },
  materialsTestStation: {
    id: 'materialsTestStation',
    physicsType: 'drift',
    name: 'Materials Test Station',
    desc: 'A shielded sample chamber with a motorised stage, current monitor, and high-speed cameras. It terminates a low-energy test beam on coupons, cathodes, or prototype devices and turns booked beam time into useful measurements.',
    category: 'endpoint', subsection: 'detectors',
    cost: { funding: 120000 }, stats: { dataRate: 0.5 }, energyCost: 4,
    apertureRadius: 45, subL: 5, subW: 4, subH: 3, gridW: 4, gridH: 5,
    geometryType: 'box', interiorVolume: 12, isEndpoint: true,
    spriteKey: 'detector', spriteColor: 0x9aa7b5, accentColor: 0x9aa7b5,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['testStand'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  xRayConverterStation: {
    id: 'xRayConverterStation',
    physicsType: 'beamStop',
    name: 'X-ray Converter Station',
    desc: 'A compact shielded cabinet where the electron beam is stopped in a water-cooled tungsten or tantalum plate. The resulting bremsstrahlung passes through a collimator, an inspection fixture, and a digital detector. It trades the throughput of direct electron irradiation for X-rays that penetrate denser products.',
    category: 'endpoint', subsection: 'targets',
    cost: { funding: 650000 }, stats: { dataRate: 2 }, energyCost: 18,
    apertureRadius: 50, subL: 6, subW: 6, subH: 4, gridW: 6, gridH: 6,
    geometryType: 'box', interiorVolume: 50, isEndpoint: true,
    spriteKey: 'target', spriteColor: 0xe4b83f, accentColor: 0xe4b83f,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['ebeamProcessing'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  eBeamIrradiationVault: {
    id: 'eBeamIrradiationVault',
    physicsType: 'beamStop',
    name: 'E-beam Irradiation Vault',
    desc: 'A conveyor-fed irradiation cell with a scanned beam window, dosimetry rack, and heavily shielded product maze. It is the business end of a continuous electron line: sterilise medical products, crosslink cable insulation, or process food by the pallet.',
    category: 'endpoint', subsection: 'targets',
    cost: { funding: 1800000 }, stats: { dataRate: 1 }, energyCost: 35,
    apertureRadius: 55, subL: 10, subW: 8, subH: 5, gridW: 8, gridH: 10,
    geometryType: 'box', interiorVolume: 150, isEndpoint: true,
    spriteKey: 'target', spriteColor: 0x46c25a, accentColor: 0x46c25a,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['ebeamProcessing'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  isotopeProductionTarget: {
    id: 'isotopeProductionTarget',
    physicsType: 'target',
    name: 'Isotope Production Target',
    desc: 'A remotely loaded target vault with a high-flow water target, transfer cask dock, and radiochemistry handoff. It absorbs a proton beam to make short-lived medical isotopes such as fluorine-18 and gallium-68.',
    category: 'endpoint', subsection: 'targets',
    cost: { funding: 3200000 }, stats: { collisionRate: 3, dataRate: 2 }, energyCost: 12,
    apertureRadius: 50, subL: 6, subW: 6, subH: 4, gridW: 6, gridH: 6,
    geometryType: 'cylinder', interiorVolume: 45, requires: 'targetPhysics', isEndpoint: true,
    spriteKey: 'target', spriteColor: 0xe0a33a, accentColor: 0xe0a33a,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['isotopeIrradiation'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  radiationEffectsStation: {
    id: 'radiationEffectsStation',
    physicsType: 'target',
    name: 'Electronics Irradiation Station',
    desc: 'A temperature-controlled, raster-scanned test cave for spacecraft electronics, detector components, and radiation-hardened chips. It spreads an early proton beam across a device fixture and sells qualified radiation-test campaigns by the shift, recording single-event effects while samples are swapped remotely behind shielding.',
    category: 'endpoint', subsection: 'targets',
    cost: { funding: 2400000 }, stats: { dataRate: 3 }, energyCost: 25,
    apertureRadius: 60, subL: 8, subW: 6, subH: 4, gridW: 6, gridH: 8,
    // This is the entry commercial endpoint for proton acceleration. Isotope
    // targets remain behind Target Physics; electronics customers only need a
    // controlled proton field and calibrated dosimetry.
    geometryType: 'box', interiorVolume: 80, requires: 'protonAcceleration', isEndpoint: true,
    spriteKey: 'target', spriteColor: 0xd88a3a, accentColor: 0xd88a3a,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['isotopeIrradiation'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  protonTherapyGantry: {
    id: 'protonTherapyGantry',
    physicsType: 'beamStop',
    name: 'Proton Therapy Gantry',
    desc: 'A rotating treatment gantry with pencil-beam scanning magnets, range verification, and a patient positioning couch. It terminates the clinical proton beam in a treatment field; availability and safe delivery matter more here than raw beam power.',
    category: 'endpoint', subsection: 'targets',
    cost: { funding: 28000000 }, stats: { dataRate: 5 }, energyCost: 180,
    apertureRadius: 70, subL: 14, subW: 14, subH: 10, gridW: 14, gridH: 14,
    geometryType: 'cylinder', interiorVolume: 900, requires: 'machineProtection', isEndpoint: true,
    spriteKey: 'target', spriteColor: 0x3fb9c4, accentColor: 0x3fb9c4,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['therapy'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  spallationNeutronTarget: {
    id: 'spallationNeutronTarget',
    physicsType: 'target',
    name: 'Spallation Neutron Target',
    desc: 'A mercury-or-tungsten target monolith with a moderator vessel, reflector, and remote-handling flange. It takes the full pulsed proton beam and converts it into the neutron flux that the instrument halls sell to users.',
    category: 'endpoint', subsection: 'targets',
    cost: { funding: 85000000 }, stats: { collisionRate: 8, dataRate: 12 }, energyCost: 450,
    apertureRadius: 75, subL: 12, subW: 10, subH: 8, gridW: 10, gridH: 12,
    geometryType: 'box', interiorVolume: 600, requires: 'targetPhysics', isEndpoint: true,
    spriteKey: 'target', spriteColor: 0xd8463a, accentColor: 0xd8463a,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['spallation'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  photonScienceHutch: {
    id: 'photonScienceHutch',
    physicsType: 'drift',
    name: 'Photon Science Endstation',
    desc: 'A shielded experimental hutch with monochromator controls, a sample goniometer, and detector readout. In the one-line beam model it is the user-facing end of a synchrotron branch, representing the photon front end and its experiment.',
    category: 'endpoint', subsection: 'photon',
    cost: { funding: 12000000 }, stats: { dataRate: 10 }, energyCost: 90,
    apertureRadius: 65, subL: 12, subW: 10, subH: 6, gridW: 10, gridH: 12,
    geometryType: 'box', interiorVolume: 400, requires: 'synchrotronLight', isEndpoint: true,
    spriteKey: 'detector', spriteColor: 0xe8c33a, accentColor: 0xe8c33a,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['lightSource'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  xfelEndstation: {
    id: 'xfelEndstation',
    physicsType: 'drift',
    name: 'XFEL Experimental Endstation',
    desc: 'A diffraction and imaging station with a femtosecond timing tool, liquid-jet injector, and large-area detector. It represents the hard X-ray experiment at the end of the FEL beamline, where ultrashort pulses become high-value data.',
    category: 'endpoint', subsection: 'photon',
    cost: { funding: 65000000 }, stats: { dataRate: 25 }, energyCost: 220,
    apertureRadius: 70, subL: 12, subW: 10, subH: 7, gridW: 10, gridH: 12,
    geometryType: 'box', interiorVolume: 500, requires: 'felTech', isEndpoint: true,
    spriteKey: 'detector', spriteColor: 0xcf5bb0, accentColor: 0xcf5bb0,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['xfel'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
  euvCollector: {
    id: 'euvCollector',
    physicsType: 'beamStop',
    name: 'EUV Collector Interface',
    desc: 'A high-power collector and metrology chamber at the handoff to a lithography scanner. It absorbs the spent drive beam, monitors in-band 13.5 nm output, and represents the tightly integrated customer interface that makes an EUV FEL commercially useful.',
    category: 'endpoint', subsection: 'photon',
    cost: { funding: 110000000 }, stats: { dataRate: 8 }, energyCost: 600,
    apertureRadius: 70, subL: 10, subW: 10, subH: 7, gridW: 10, gridH: 10,
    geometryType: 'box', interiorVolume: 450, requires: 'energyRecovery', isEndpoint: true,
    spriteKey: 'target', spriteColor: 0x6457d6, accentColor: 0x6457d6,
    placement: 'module', role: 'junction', routing: [], ports: { entry: { side: 'back' } },
    beamlineTypes: ['euvFel'], requiredConnections: ['powerCable', 'coolingWater', 'dataFiber'],
  },
};
