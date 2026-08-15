// src/data/beamline-types.js
//
// What a beamline is FOR. Every beamline used to be the same machine: the
// palette was identical regardless, `machineType` was stamped 'linac' and never
// read, and income was `quality x (base + perNode x nodeCount)` — an expression
// containing neither energy nor current, so "bigger strictly earns more" was
// hard-coded rather than balanced. A type fixes that at three points at once:
// it filters the build palette, it selects the physics module stack
// (beam_physics/machines.py keys its configs on the ids below), and it names
// the one physics output the beamline is paid on.
//
// Two mechanisms carry the design:
//
//   1. Each type declares ONE figure of merit. A spallation source and an XFEL
//      can be built from overlapping hardware and still play nothing alike,
//      because one is scored on E x I and the other on emittance-limited
//      brilliance — and those are optimised by opposite decisions about the
//      same components.
//   2. Each figure of merit is BAND-GATED, not floored. A Test Stand at 8 GeV
//      is not a very good Test Stand; it is not a Test Stand at all. Bands are
//      what keep a tier-1 type economically live in the late game, and they
//      are why building an EUV drive line to 8 GeV is a mistake rather than an
//      upgrade.
//
// PALETTE FILTERING is two-directional on purpose. A component may carry a
// `beamlineTypes` allowlist (see beamline-components.raw.js) meaning "this is
// special-purpose hardware"; a type carries `excludes` meaning "this is general
// hardware that is wrong here". An allowlist alone would force all 18 trunk
// components to enumerate all ten types and rot the moment an eleventh landed; a
// denylist alone could not say "undulators exist only for photon machines"
// without repeating it five times. Keeping the denials on the TYPE is what
// makes each type's identity readable in one place — this file.
//
// UNITS. `spec.energyGeV` is GeV, `spec.currentMA` is milliamps, and the two
// multiply to megawatts (1 GeV x 1 mA = 1 MW), which is why several figures of
// merit need no constants at all. Bands are [lo, hi]; a null bound means the
// gate is one-sided.
//
// FOM REFERENCE VALUES ARE PROVISIONAL. Each `fomRef` below carries the
// analytic basis it was derived from, but the calibration rule is: build the
// reference recipe in scripts/balance-sim.mjs, MEASURE the raw FoM, and replace
// the number. `fomRef` must describe a reference machine of the type, not a
// starter machine, or the 2.5 score clamp binds after one energy upgrade.

/**
 * Ten types, arranged as a money / data / prestige triangle rather than a
 * power ladder: every tier holds at least one money type and at least one data
 * type, so climbing the tree buys research throughput while staying low buys
 * the cash that pays for it. Tier 6 is the exception that proves it — one
 * machine, no money at all, and the only tier gated on another tier's node.
 *
 * Entry shape:
 *   id               registry key, and the `machineType` string physics reads
 *   name             display name
 *   tier             1-6, an economic ordering — NOT a physics containment
 *   machineType      key into beam_physics/machines.py MACHINE_TYPES
 *   particle         species the type's mandated source emits
 *   spec             { energyGeV: [lo, hi], currentMA: [lo, hi], ... } bands
 *   fom              which figure of merit scores it (camelCase mirror of the
 *                    machines.py `success_metric` for the same id)
 *   fomRef           raw FoM value at which fomScore = 1
 *   bandWidth        Gaussian-in-decades falloff `w` outside the band
 *   dutyFactor       fraction of wall-clock time beam is actually delivered.
 *                    Applied ONLY inside the FoM: the simulator has no pulse
 *                    structure, so every beam it produces is effectively CW and
 *                    a pulsed type would otherwise be paid for duty it does not
 *                    have.
 *   requires         research node id, array of ids, or null for ungated
 *   excludes         component ids hidden from this type's palette
 *   requiredEndpoint component ids of which at least one must terminate the line
 *   blurb            one-line pitch for the New Beamline picker
 *   accentColor      tile accent
 */
export const BEAMLINE_TYPES = {
  // ── Tier 1 — ungated, available on tick 0 ─────────────────────────────
  testStand: {
    id: 'testStand',
    name: 'Test Stand',
    tier: 1,
    machineType: 'testStand',
    particle: 'e-',
    // BNL's ATF and DESY Zeuthen's PITZ class: a ten-metre bench in a shielded
    // bay. Wide current band because a test stand is allowed to be scruffy.
    spec: {
      energyGeV: [0.005, 0.05],
      currentMA: [1, 100],
      dutyMin: 0,
    },
    fom: 'beamPowerKw',
    // 20 MeV x 2.5 mA = 0.05 MW = 50 kW. Deliberately modest: this is a tool,
    // not a product, and its revenue multiplier is the smallest in the roster.
    fomRef: 50,
    // The loosest band in the roster. A test stand that drifts out of spec is
    // still a test stand — that tolerance IS its identity.
    bandWidth: 0.45,
    dutyFactor: 0.10,
    requires: null,
    // The only type with nothing denied to it beyond what the allowlists
    // already withhold. The sandbox where you may build things that do not
    // work is what keeps a type-filtered game from feeling like a cage.
    excludes: [],
    requiredEndpoint: ['materialsTestStation', 'faradayCup', 'beamStop'],
    blurb: 'A bench you are allowed to break. Qualify hardware and rent beam time to groups who do not mind the beam going away.',
    accentColor: 0x9aa7b5,
  },

  ebeamProcessing: {
    id: 'ebeamProcessing',
    name: 'E-beam Processing Line',
    tier: 1,
    machineType: 'ebeamProcessing',
    particle: 'e-',
    // IBA Rhodotron TT300 class (10 MeV, 100 kW CW) and the Mevex / Wasik
    // S-band industrial machines. The 12 MeV ceiling is the regulatory one:
    // above ~10 MeV electrons start activating the product being sterilised.
    spec: {
      energyGeV: [0.003, 0.012],
      currentMA: [20, 100],
      dutyMin: 0.8,
    },
    fom: 'beamPowerKw',
    // The Rhodotron nameplate: 10 MeV x 10 mA = 100 kW delivered.
    fomRef: 100,
    // Tight, because the upper edge is a regulator's line rather than a
    // physics preference. Going over does not earn less — it earns nothing.
    bandWidth: 0.15,
    dutyFactor: 1.0,
    requires: null,
    // Chromaticity correction on a 10 MeV sterilisation line is hardware
    // nobody in the industry has ever bought, and the two intercepting
    // devices are worse: this is a 100 kW CW beam, so a foil or a pepper-pot
    // plate in it is a consumable that lasts one shift. Every other type
    // above 10 MeV already denies them; this one was the gap. The rest of
    // this type's identity is withheld by allowlists: no cryo, no ion front
    // end, no detector.
    excludes: ['sextupole', 'velocitySelector', 'emittanceFilter'],
    requiredEndpoint: ['eBeamIrradiationVault', 'beamStop', 'faradayCup'],
    blurb: 'You sell dose, by the pallet. Medical-device sterilisation, cable crosslinking, food irradiation — paid on beam power, not beam quality.',
    accentColor: 0x46c25a,
  },

  // ── Tier 2 ────────────────────────────────────────────────────────────
  isotopeIrradiation: {
    id: 'isotopeIrradiation',
    name: 'Isotope & Irradiation Line',
    tier: 2,
    machineType: 'isotopeIrradiation',
    particle: 'p+',
    // ARRONAX (70 MeV, 2 x 375 uA) and the IBA Cyclone 70: medical isotopes,
    // radiobiology and electronics single-event-effect testing on one machine,
    // which is why this is one type and not two.
    spec: {
      energyGeV: [0.015, 0.07],
      currentMA: [0.1, 1.0],
      // A SPOT-SIZE BAND, not a floor. Real irradiation wants a defocused
      // *uniform* field over a 10 cm sample, so both a blown-up beam and a
      // pencil beam score badly. This is physically correct and it closes the
      // otherwise-inevitable "add quadrupoles until sigma -> 0" exploit.
      spotSizeMm: [5, 50],
      dutyMin: 0.5,
    },
    fom: 'fluence',
    // Cyclone 70 reference: 0.75 mA spread over a 10 cm x 10 cm field, i.e.
    // sigma_x = sigma_y = 25 mm, so 2*pi*sigma_x*sigma_y = 39.3 cm^2 and the
    // current density is ~0.019 mA/cm^2. Units: mA/cm^2, uniformity-weighted.
    fomRef: 0.02,
    bandWidth: 0.30,
    dutyFactor: 0.8,
    // The first commercial proton line is electronics irradiation, not isotope
    // production. Its test station unlocks with the proton accelerator itself,
    // so a newly researched 15-30 MeV line can earn before the player buys
    // Target Physics. That later node still opens the isotope-production and
    // general-purpose target paths.
    requires: 'protonAcceleration',
    // Nothing denied. A 70 MeV proton line is exactly where a Wien filter and
    // a pepper-pot still make sense, and it is the last type where they do.
    excludes: [],
    requiredEndpoint: ['radiationEffectsStation', 'isotopeProductionTarget', 'target', 'beamStop'],
    blurb: 'Two customers on one machine: PET isotopes sold by the curie, and aerospace electronics paid for by the shift. Highest revenue per square metre in the roster.',
    accentColor: 0xe0a33a,
  },

  therapy: {
    id: 'therapy',
    name: 'Therapy Line',
    tier: 2,
    machineType: 'therapy',
    particle: 'p+',
    // PSI's 250 MeV COMET feeding Gantry 1/2/3, IBA Cyclone 230, Varian
    // ProBeam. Note the current: therapy beams are NANOAMPS. A 250 MeV proton
    // beam at 1 nA is 0.25 W — these machines throw away 99.99% of what the
    // source makes, so beam power is irrelevant here and beam control is
    // everything.
    spec: {
      energyGeV: [0.07, 0.25],
      currentMA: [0.001, 0.05],
      dutyMin: 0.9,
    },
    fom: 'doseAvailability',
    // Dimensionless and capped near 1.15 by construction: there is no "more
    // luminosity" for a patient. You cannot min-max this type, only make it
    // reliable — which is what converts capital into a stable annuity, the
    // only such instrument in the game.
    fomRef: 1.0,
    // The tightest band in the roster, and it is clinical rather than
    // economic: a 300 MeV proton overshoots the patient.
    bandWidth: 0.12,
    dutyFactor: 1.0,
    // `isochronousCyclotron` names the machine and `machineProtection` names
    // the interlocks, but neither implies you can accelerate a proton at all —
    // both descend from `cyclotronTech`, which stops short of the front end.
    // Without `protonAcceleration` the type unlocks onto a palette with no
    // proton hardware in it.
    requires: ['isochronousCyclotron', 'machineProtection', 'protonAcceleration'],
    // You do not put an uncooled scattering foil in a clinical beam. Both of
    // these are trunk hardware everywhere below 250 MeV — this is the exact
    // case the type-side denylist exists for.
    excludes: ['velocitySelector', 'emittanceFilter'],
    requiredEndpoint: ['protonTherapyGantry', 'beamStop'],
    blurb: 'Hospitals buy treatment fractions, not physics. Revenue is capped and being brilliant earns nothing extra — what you can do is fail, and a cancelled fraction costs reputation.',
    accentColor: 0x3fb9c4,
  },

  // ── Tier 3 ────────────────────────────────────────────────────────────
  spallation: {
    id: 'spallation',
    name: 'Spallation Neutron Source',
    tier: 3,
    machineType: 'spallation',
    particle: 'p+',
    // SNS (1.0 GeV, 1.4 MW), ESS (2.0 GeV, 5 MW — a PURE LINAC with no ring
    // anywhere in the chain, which is why this type is buildable on a linear
    // flattener), LANSCE, ISIS, J-PARC.
    spec: {
      energyGeV: [0.8, 3.0],
      currentMA: [1, 60],
      dutyMin: 0.04,
    },
    fom: 'beamPowerMw',
    // Between SNS's 1.4 MW and ESS's 5 MW design point.
    fomRef: 2.0,
    bandWidth: 0.25,
    // SNS-class: 60 Hz x ~1 ms pulses.
    dutyFactor: 0.05,
    // `cwLinacDesign` descends from `srfTechnology`, so it buys the linac and
    // says nothing about what is in it. A spallation source is a PROTON linac
    // into a heavy-metal target; without `protonAcceleration` the type opens
    // with an electron front end and no way to make a neutron.
    requires: ['cwLinacDesign', 'targetPhysics', 'protonAcceleration'],
    // Destructive intercepting devices in a 1 MW beam are the single worst
    // idea available. wireScanner survives because real MW machines do use
    // them, at low duty cycle and briefly.
    excludes: ['screen', 'velocitySelector', 'emittanceFilter'],
    requiredEndpoint: ['spallationNeutronTarget', 'target', 'beamStop'],
    blurb: 'One accelerator, twenty instruments, and the cheapest data in the game — provided you can put a megawatt on target without activating the tunnel.',
    accentColor: 0xd8463a,
  },

  lightSource: {
    id: 'lightSource',
    name: 'Synchrotron Light Source',
    tier: 3,
    machineType: 'lightSource',
    particle: 'e-',
    // ESRF-EBS and APS-U at 6 GeV, Diamond / NSLS-II / MAX IV at 3 GeV. The
    // band is genuinely wide where others are narrow because both energies are
    // correct answers serving different photon-science communities.
    spec: {
      energyGeV: [2.5, 6.0],
      currentMA: [200, 500],
      dutyMin: 1.0,
    },
    fom: 'photonFlux',
    // A 4 GeV / 100 mA bending magnet emits ~8.5e19 photons/s; a mature ring
    // sells that across 30-45 front ends. Units: photons/s summed over ports.
    fomRef: 1e20,
    bandWidth: 0.30,
    dutyFactor: 1.0,
    // `storageRingTech` buys the ring and `synchrotronLight` buys the reason to
    // build one, but neither says anything about the injector that fills it.
    // Without `srfTechnology` the best accelerating structure on the palette is
    // `sbandStructure` at 51 MeV a placement, so reaching the 2.5 GeV band floor
    // takes fifty of them — the type unlocks onto a machine nobody would build.
    // It is also simply what these facilities are: ESRF-EBS, APS-U, MAX IV and
    // every other fourth-generation ring runs a superconducting RF system.
    requires: ['storageRingTech', 'synchrotronLight', 'srfTechnology'],
    // The electron beam has to survive for eight hours. Anything that
    // intercepts it kills a stored beam outright — which is a stronger
    // statement than "degrades it", and is why screen is denied here and not
    // merely discouraged.
    excludes: ['screen', 'velocitySelector', 'emittanceFilter'],
    requiredEndpoint: ['photonScienceHutch', 'beamStop', 'faradayCup'],
    blurb: 'An XFEL serves three experiments at a time; a ring serves forty. The workhorse public user facility, and the one machine here that is a ring.',
    accentColor: 0xe8c33a,
  },

  // ── Tier 4 — the money/science fork ───────────────────────────────────
  xfel: {
    id: 'xfel',
    name: 'XFEL (hard X-ray)',
    tier: 4,
    machineType: 'xfel',
    particle: 'e-',
    // European XFEL (17.5 GeV), LCLS-II-HE (8 GeV), SACLA (8.5), SwissFEL
    // (5.8), PAL-XFEL (10). Microamps average, kiloamps peak.
    spec: {
      energyGeV: [6.0, 17.5],
      currentMA: [0.0005, 0.01],
      dutyMin: 0,
    },
    fom: 'felBrilliance',
    // Peak brilliance in ph/s/mm^2/mrad^2/0.1%bw; European XFEL is ~5e33.
    // Multiplied by min(1, saturation)^2 — an FEL that does not lase is an
    // extremely expensive undulator.
    fomRef: 5e33,
    bandWidth: 0.25,
    // Burst mode: European XFEL's 27,000 pulses/s in 600 us trains.
    dutyFactor: 0.006,
    // `felTech` buys the undulator and the physics of lasing; it does not buy
    // the 6-17.5 GeV linac in front of it. On copper alone the band floor is 118
    // `sbandStructure` placements away, which is not a machine, it is a
    // corridor. Every operating hard X-ray FEL that is not LCLS-I is
    // superconducting — European XFEL, LCLS-II, SHINE — so this is the honest
    // gate as well as the playable one.
    requires: ['felTech', 'srfTechnology'],
    // An XFEL is an emittance-preservation machine; a pepper-pot plate in
    // front of a 17 GeV, 5 kA beam is a plasma experiment, not a filter.
    excludes: ['velocitySelector', 'emittanceFilter'],
    requiredEndpoint: ['xfelEndstation', 'beamStop', 'faradayCup'],
    blurb: 'Molecular movies and diffraction-before-destruction. The highest data rate in the roster by a wide margin, and the currency is Nature papers.',
    accentColor: 0xcf5bb0,
  },

  euvFel: {
    id: 'euvFel',
    name: 'EUV FEL Drive Line',
    tier: 4,
    machineType: 'euvFel',
    particle: 'e-',
    // The KEK / EUV-FEL Light Source Study Group proposal: an 800 MeV
    // superconducting ERL driving 13.5 nm at >= 10 kW average, pitched to
    // replace the tin-plasma sources in EUV lithography scanners.
    //
    // NOTE THE INVERSION against the XFEL above — this is the whole reason the
    // two are separate types. 13.5 nm is SOFT: it needs a tenth of the energy
    // and a thousand times the average current, delivered continuously,
    // forever. A machine built for one is actively wrong for the other.
    spec: {
      energyGeV: [0.8, 1.2],
      currentMA: [5, 15],
      dutyMin: 1.0,
    },
    fom: 'euvPhotonPowerW',
    // The contract number: 10 kW average in-band at 13.5 nm. Scanner
    // throughput is linear in source power, so this is what the fab buys.
    fomRef: 10000,
    // The sharpest band in the roster. The undulator resonance sets the
    // wavelength from the beam energy, and the customer wants exactly 13.5 nm
    // because that is what their multilayer mirrors reflect. Building this
    // line to 8 GeV is a $200M mistake, not an upgrade.
    bandWidth: 0.10,
    dutyFactor: 1.0,
    requires: ['felTech', 'energyRecovery'],
    // The one type whose palette forbids the CHEAP option. At 1 GeV x 10 mA
    // you are handling 10 MW of beam power continuously; normal-conducting
    // copper would melt and the wall-plug bill would eat the contract.
    excludes: ['velocitySelector', 'emittanceFilter', 'pillboxCavity'],
    requiredEndpoint: ['euvCollector', 'beamStop', 'faradayCup'],
    blurb: 'One customer: a semiconductor fab. The highest revenue in the game, an availability contract with punitive downtime clauses, and almost no science.',
    accentColor: 0x6457d6,
  },

  // ── Tier 5 — the monument ─────────────────────────────────────────────
  collider: {
    id: 'collider',
    name: 'Linear Collider',
    tier: 5,
    machineType: 'collider',
    particle: 'e+e-',
    // The SLC at SLAC (46.6 GeV/beam) is the honest anchor: the only e+e-
    // linear collider ever operated, and the only kind this engine can express
    // — `collisionPoint` already carries entryA/entryB on opposite sides.
    // Ring colliders (LEP, SuperKEKB, FCC-ee) are the machines you
    // conspicuously cannot build.
    //
    // The band runs the full length of the real e+e- linear-collider
    // programme. 45 GeV/beam is the Z pole — where the SLC and LEP actually
    // ran, and the cheapest thing worth colliding. 500 GeV/beam is 1 TeV in
    // the centre of mass, CLIC's stage 2, and the top of every serious design
    // study anyone has published. Nothing between those is a wrong answer: 80
    // is the WW threshold, 125 is the Higgs factory, 175 is ttbar.
    //
    // That makes this the widest band in the roster — 1.05 decades, against
    // 0.18 for euvFel — and the width is TRADED, not conceded. Every other
    // type's band is a customer's tolerance; the monument's band is the
    // programme's ambition, and the reward for spending twenty years and
    // several billion climbing it is that you never leave spec while doing so.
    // `plasmaAfterburner` is what makes the top half reachable at all; without
    // it the ceiling would have to come back down to the ~120 it sat at when
    // the roster shipped.
    spec: {
      energyGeV: [45, 500],
      // No current band: luminosity, not current, is the currency here.
      dutyMin: 0,
    },
    fom: 'integratedLuminosity',
    // SLC ran ~1e30 cm^-2 s^-1; a game-scale design target two orders up.
    // TODO(balance): 1e32 was measured against the old [45, 120] band. A
    // reference machine on the [45, 500] band is a different machine, so this
    // number is now describing hardware that no longer exists — re-measure the
    // raw FoM in scripts/balance-sim.mjs and replace it. Left stale rather
    // than guessed at, per the calibration rule in this file's header.
    fomRef: 1e32,
    bandWidth: 0.30,
    dutyFactor: 0.005,
    // Three nodes for the one type that has to be earned. `colliderTech`
    // names the collider; `bunchCompression` and `srfTechnology` are what
    // make it collide anything — luminosity is set by how short the bunch is,
    // and everything above the SLC's energy is superconducting. Neither is
    // implied by `colliderTech`'s own ancestry (highLuminosity, antimatter),
    // which is exactly why they are stated here.
    requires: ['colliderTech', 'bunchCompression', 'srfTechnology'],
    // Intercepting devices, plus: here your photons are a loss mechanism
    // rather than a product, so every insertion device is withheld by
    // allowlist. Real colliders do use damping wigglers; dropping that nuance
    // is the sharpest identity line available between the two top types.
    excludes: ['screen', 'velocitySelector', 'emittanceFilter'],
    requiredEndpoint: ['collisionPoint'],
    blurb: 'Nothing commercial. It loses money every tick, funded by grants and reputation exactly like the real thing, and it is the only way to a Nobel.',
    accentColor: 0x3d8ee6,
  },

  // ── Tier 6 — the machine you buy the map for ──────────────────────────
  blackHoleFactory: {
    id: 'blackHoleFactory',
    name: 'Black Hole Factory',
    tier: 6,
    machineType: 'blackHoleFactory',
    particle: 'p+p-',
    // WHY THIS TYPE EXISTS. Every other type in this file is a machine you fit
    // onto the map. This one is a machine the map has to be bought for, and
    // that is its entire mechanical identity: 500,000 GeV/beam is 42
    // crystalChannelStage placements, 210 tiles in a straight line, and a
    // linear machine may not bend — synchrotron loss goes as E^4/rho, so the
    // dipole that would fold it in half is the dipole that throws away
    // everything the 42 placements bought. There is exactly one map in the
    // game long enough (mapHalfExtent 120, the last land parcel), nothing else
    // in the game needs that land, and this machine cannot exist without it.
    // The decision it forces is therefore not "what do I build" but "do I
    // spend $18.5B on ground before I have spent a cent on hardware".
    //
    // HADRONS, and the reason is the same one that shapes the collider. e+e-
    // at 500 TeV/beam radiates in the final focus at a rate no lattice
    // survives; the useful collision is partonic anyway, so what you want is a
    // bag of quarks and gluons per bunch and no synchrotron problem. FCC-hh
    // and SPPC are the design studies this is standing on, both proton
    // machines, both at 50-75 TeV/beam — this is an order of magnitude past
    // either, which is the honest scale of the ask.
    //
    // 200 TeV to 1 PeV in the centre of mass. The floor is not arbitrary: if
    // the fundamental Planck scale sits at a few TeV, as large-extra-dimension
    // models allow, black hole production turns on when the parton pair passes
    // inside its own Schwarzschild radius, and nothing below a couple of
    // hundred TeV puts enough partons above that line to see anything.
    spec: {
      energyGeV: [100000, 500000],
      // No current band, as the collider has none: the currency is luminosity.
      dutyMin: 0,
    },
    fom: 'blackHoleYield',
    // Events per second, computed analytically in beam_physics/gameplay.py
    // from energy and luminosity — a geometric cross-section pi*r_s^2 times
    // the luminosity the beam-beam module already reports. No new physics
    // module, and no new free parameter beyond the fundamental scale itself.
    //
    // PROVISIONAL, like every fomRef in this file. The reference machine is
    // 250,000 GeV/beam at 1e34 cm^-2 s^-1, which the formula puts at 1.8
    // events/s. MEASURE it in scripts/balance-sim.mjs and replace the number;
    // do not tune it by feel.
    fomRef: 1.8,
    bandWidth: 0.30,
    // The lowest duty factor in the roster, and the one place where the number
    // is a mood as well as a fraction. This machine spends its life ramping,
    // cooling down and being re-aligned; it delivers collisions for about a
    // thousandth of the wall clock and every one of them is an event.
    dutyFactor: 0.001,
    // Three nodes, and unlike every other type one of them is another type's
    // gate. `colliderTech` is required outright: you do not get here without
    // having built the linear collider first, and the tier-6 machine being
    // strictly downstream of the tier-5 one is the only place in the roster
    // where the tiers are a real ordering rather than an economic one.
    // `particleDiscovery` is what makes the result claimable at five sigma and
    // is what gates the chamber and the detector. `bunchCompression` is the
    // luminosity: cross-sections at this energy are geometric and tiny, so the
    // only lever left is how tightly the bunch is squeezed.
    requires: ['colliderTech', 'particleDiscovery', 'bunchCompression'],
    // The collider's denials, plus one. Insertion devices are already withheld
    // by allowlist for the same reason as there — a photon here is a loss
    // term, not a product — and the three intercepting devices are the
    // collider's list verbatim. `wireScanner` is the addition, and the collider
    // is right to keep it while this type is not: a carbon filament survives a
    // brief pass through a 500 GeV beam and is standard practice on real
    // machines, but at 500 TeV the same filament is not a diagnostic, it is a
    // one-shot experiment in vaporising carbon.
    excludes: ['screen', 'velocitySelector', 'emittanceFilter', 'wireScanner'],
    requiredEndpoint: ['blackHoleChamber'],
    blurb: 'The collider loses money; this loses money and land. Two hundred tiles of crystal in a dead straight line, firing a thousandth of the time, to measure a cross-section that may well be zero.',
    accentColor: 0xff7a18,
  },
};

/** One type by id, or null. */
export function getBeamlineType(id) {
  return BEAMLINE_TYPES[id] || null;
}

/**
 * The types a given research state has opened, in roster order.
 *
 * Accepts whatever the caller has to hand — the completed-research array from
 * game state, a Set of ids, or the state object itself — because the picker,
 * the scenario editor and the tests all reach this from different directions
 * and none of them should have to reshape their data first.
 */
export function beamlineTypesFor(researchState) {
  const done = normaliseResearch(researchState);
  return Object.values(BEAMLINE_TYPES).filter(t => typeIsUnlocked(t, done));
}

/** Whether `type` (or its id) is unlocked by the given research state. */
export function beamlineTypeUnlocked(type, researchState) {
  const t = typeof type === 'string' ? BEAMLINE_TYPES[type] : type;
  if (!t) return false;
  return typeIsUnlocked(t, normaliseResearch(researchState));
}

/**
 * Research node ids still missing before `type` unlocks. The picker greys a
 * locked tile and names what it wants, which is the whole job RCT2's ride list
 * does: here is everything the game contains, and here is what you cannot have
 * yet.
 */
export function missingResearchFor(type, researchState) {
  const t = typeof type === 'string' ? BEAMLINE_TYPES[type] : type;
  if (!t || !t.requires) return [];
  const done = normaliseResearch(researchState);
  return requiredNodes(t).filter(id => !done.has(id));
}

function requiredNodes(type) {
  if (!type.requires) return [];
  return Array.isArray(type.requires) ? type.requires : [type.requires];
}

function typeIsUnlocked(type, done) {
  return requiredNodes(type).every(id => done.has(id));
}

function normaliseResearch(researchState) {
  if (!researchState) return new Set();
  if (researchState instanceof Set) return researchState;
  if (Array.isArray(researchState)) return new Set(researchState);
  if (Array.isArray(researchState.completedResearch)) {
    return new Set(researchState.completedResearch);
  }
  return new Set();
}
