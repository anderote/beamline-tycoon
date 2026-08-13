// src/data/stock-designs/collider.js — Linear Collider.
//
// Split out from the photon machines because it is not one: here the
// synchrotron light your beam emits is a loss mechanism rather than a product,
// which is why beamline-types.js withholds every insertion device from this
// type. The blueprints therefore optimise for something no other roster does —
// luminosity at the interaction point, not flux out of a port.
//
// See ../stock-designs.js for the entry shape and the authoring rules.
//
// Every number in the comments below was MEASURED with
// `node scripts/eval-design.mjs collider`. Five things about this type drove
// the three designs, and four of them are findings rather than choices:
//
//   1. THE FRONT END SETS THE CURRENT AND NOTHING GETS IT BACK. `positronSource`
//      delivers 21 uA of DC positrons at 200 MeV, and the FIRST accelerating
//      element it meets keeps a fixed fraction of that forever
//      (CAPTURE_EFFICIENCY in beam_physics/modules/rf_acceleration.py). The
//      three rungs a collider can start on are not equivalent:
//
//          srfLinacSector      0.50  ->  10.50 uA
//          twoBeamModule       0.40  ->   8.40 uA
//          plasmaAfterburner   0.25  ->   5.25 uA
//
//      Luminosity goes as N^2, so that 0.50 against 0.25 is a FACTOR OF FOUR in
//      the only quantity this type is scored on. All three designs below
//      therefore open with an SRF sector even when the main linac is something
//      else entirely — the tier-3 machine spends $273M of superconducting
//      injector purely to avoid handing a DC beam to a plasma stage, which the
//      catalogue itself calls out as "the mistake it is".
//
//   2. THE FINAL FOCUS GROWS FASTER THAN THE LINAC. A quadrupole's strength is
//      k = 0.2998 g / p and `finalFocusDoublet` has a FIXED gradient (see 3), so
//      the number of doublets needed to pull a waist at the IP scales with the
//      beam momentum. Measured, holding everything else constant:
//
//          45.7 GeV    6 doublets   sigma_y  81 um
//         123.7 GeV   18 doublets   sigma_y  16 um
//         490.7 GeV   74 doublets   sigma_y  10 um   <- NOT SHIPPED
//
//      That last row is the honest reason the tier-3 machine has the worst spot
//      on the roster. Seventy-four doublets is $2.6B of superconducting magnet
//      and seventy-four tiles of map, twice the hardware of its entire main
//      linac, and it is not a blueprint anyone would place. The monument buys
//      REACH; it cannot afford to buy brightness as well, which is also why the
//      real ILC final focus is measured in kilometres.
//
//      The waists are sharp and they are tuned values, not minimums. At 123.7
//      GeV: 17 doublets gives sigma_y 80 um, 18 gives 16 um, 19 gives 37 um.
//
//   3. finalFocusDoublet's STRENGTH CANNOT BE SET, and this is the one place
//      the "always set magnet strengths explicitly" rule cannot be obeyed. It
//      has no PARAM_DEFS entry in component-physics.js, so computeStats never
//      runs on it and physics-payload.js passes the catalogue
//      `stats.focusStrength: 4` through untouched — equivalent to a fixed
//      13.3 T/m, which is a QUARTER of what an ordinary $200k `quadrupole` will
//      do at its 50 T/m end stop.
//
//      It is still the right magnet, and not because of its gradient: a
//      quadrupole's phase advance goes as sqrt(k) x L, so the doublet's 3 m
//      against the quad's 1 m beats the quad's 3.75x in k. The tier-2 lattice
//      measured both ways in the same eighteen slots — 18 doublets reach
//      sigma_y 16 um, 18 max-gradient quads reach 585 um, and it takes 28 quads
//      to get to 280. What IS settable is `polarity`, and every doublet below
//      states it.
//
//      Polarity 1 first, deliberately. That squeezes the VERTICAL plane and
//      leaves a flat beam — sigma_x ~ 1.8 mm, sigma_y tens of microns — which
//      is the orientation every real linear collider runs, for the same reason:
//      a flat beam collides hard without tearing itself apart. Starting with
//      polarity 0 gives the identical spot area with the planes swapped.
//
//   4. THE CHICANE IS NOT SHIPPED, and `bunchCompression` is one of this type's
//      own `requires`. It was tried and it measures worse in every column.
//      beam_physics/modules/bunch_compression.py compresses against
//      `context.chirp`, which only exists if an upstream cavity runs off crest,
//      and taking one 3.5 GeV sector to +30 deg costs 6% of its energy (45.70
//      -> 44.82 GeV, i.e. straight out the bottom of the band) while the
//      measured bunch LENGTHENED by six orders of magnitude and the energy
//      spread went from 1.0e-3 to 3.2e-3. Driving it harder is worse: 13
//      sectors at +20 deg lands 40.38 GeV with a 1.1e-1 energy spread. Every
//      cavity here therefore runs on crest, which is what a collider main linac
//      does anyway — the compression belongs upstream of the linac, and this
//      catalogue has nowhere to put it.
//
//   5. LUMINOSITY MEASURES ZERO ON EVERY LEGAL BLUEPRINT, and it is this type's
//      `fom`. beam_physics/modules/beam_beam.py fires only on an element whose
//      physicsType is `detector`; `collisionPoint`, which `requiredEndpoint`
//      forces every design to end on, is physicsType `drift` (the catalogue
//      calls this an "old fallthrough" in a comment on the component itself).
//      Putting a `detector` in front of the collision point does light the
//      module up in this harness — and it would be a LIE, because `detector`
//      has no `exit` port and no `routing`, so flattener.pickOutgoingPort dead
//      ends there and the collision point the player paid for would never be
//      reached by the real beam walk. Blueprints are not the place to fix an
//      engine gap by measuring a machine the player does not get. The IP spot
//      sizes recorded below are the honest proxy, and they are what
//      stock-designs.measured.json carries onto the picker card.
//
// One thing that is NOT a constraint here, and it surprised the authoring: at
// these energies nothing scrapes. `loss` reads exactly 1 - capture on all
// three designs, the peak envelope never passes 2 mm, and inside the tightest
// bore on the type (twoBeamModule, 6 mm) the beam is five sigma clear of the
// wall for the whole length of the linac. Adiabatic damping does that: the
// positron source's 40 mm.mrad is the worst phase space in the catalogue and a
// beam this stiff shrinks it to nothing. The design pressure on a collider is
// energy and the interaction point, not transport.

export const COLLIDER_DESIGNS = [
  {
    id: 'collider-zpole',
    typeId: 'collider',
    tier: 1,
    name: 'Z-Pole Collider (SLC Class)',
    blurb: 'Forty-six GeV a side, parked on the Z resonance — the machine the SLC actually was, and the cheapest thing in physics worth colliding. It will never pay for itself. That was never the deal.',
    // MEASURED 45.70 GeV, 10.50 uA, q 1.00, loss 0.500 (capture only).
    // IP spot 1799 x 81 um. 20 placements, $1.48B.
    //
    // Thirteen sectors because that is what the Z pole costs. The SLC did this
    // with two miles of S-band copper, which in this catalogue is 900
    // placements of `sbandStructure` — `srfLinacSector` is the rung that makes
    // the band floor a machine you can lay down rather than a corridor, and it
    // arrives with the type because `colliderTech` gates both.
    //
    // Six doublets is the measured waist and it is not a round number chosen
    // for tidiness: five gives sigma_y 201 um, six gives 81, seven gives 116.
    // The spot AREA across that scan runs 404k / 146k / 252k um^2, against
    // 1.34M with no final focus at all — a factor of nine in luminosity for
    // $210M on a $1.48B machine, which is the whole argument for the component.
    components: [
      { type: 'positronSource', params: { particleType: 'positron' } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      // The one diagnostic that earns a tile at an IP. Intra-train feedback
      // steers one beam onto the other from exactly this reading; a collider
      // that cannot see its own orbit at the last metre is not in collision.
      { type: 'bpm', params: {} },
      { type: 'collisionPoint', params: {} },
    ],
  },
  {
    id: 'collider-higgs',
    typeId: 'collider',
    tier: 2,
    name: 'Higgs Factory (250 GeV)',
    blurb: 'A quarter of a TeV in the centre of mass, sat on the ZH peak, behind a final-focus system with more magnets in it than most machines here have linac. You build this one to count Higgs bosons, and you count them one at a time.',
    // MEASURED 123.70 GeV, 10.50 uA, q 1.00, loss 0.500 (capture only).
    // IP spot 1839 x 16 um — the tightest on the roster. 40 placements, $3.33B.
    //
    // 247 GeV in the centre of mass, which is where every Higgs-factory design
    // study parks: the e+e- -> ZH cross-section peaks just above 240.
    //
    // The main linac is CLIC's, not the ILC's — twenty two-beam modules, 6 GeV
    // each, drive beam instead of klystrons. But the FIRST element is still one
    // SRF sector, and that $91M is the highest-value component in the design:
    // twoBeamModule captures 0.40 against the sector's 0.50, so opening on
    // copper would cost 20% of the positrons and 36% of the luminosity for the
    // whole life of the machine. It buys 3.5 GeV as well, which is incidental.
    //
    // Eighteen doublets. That is three times tier 1's final focus for 2.7x the
    // momentum, and it is where the parts count of this design actually went —
    // $630M of magnet against $2.6B of linac. The waist is sharp: 16 doublets
    // gives sigma_y 137 um, 17 gives 80, 18 gives 16, 19 gives 37. Treat the
    // count as a tuned value, not a floor.
    components: [
      { type: 'positronSource', params: { particleType: 'positron' } },
      // Capture section. Not a spare sector — see the note above.
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'twoBeamModule', params: { gradient: 500, rfPhase: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'bpm', params: {} },
      { type: 'collisionPoint', params: {} },
    ],
  },
  {
    id: 'collider-tev',
    typeId: 'collider',
    tier: 3,
    name: 'TeV Linear Collider',
    blurb: 'Thirty-two plasma stages, a superconducting injector, half a TeV a side and a petawatt laser hall that draws more power than the accelerator. The top of the roster, the bottom of the balance sheet, and the only machine in the game that could win you a Nobel.',
    // MEASURED 490.70 GeV, 10.50 uA, q 1.00, loss 0.500 (capture only).
    // IP spot 1196 x 1035 um. 42 placements, $8.73B.
    //
    // 981 GeV in the centre of mass — CLIC stage 2, and 98% of this type's
    // ceiling. `plasmaAfterburner` is the only rung that gets here in a
    // buildable number of tiles: at 15 GeV a placement it takes 32, where the
    // 6 GeV two-beam module would take 82 and the 3.5 GeV sector 140.
    //
    // The three SRF sectors in front are the whole design. A plasma stage
    // cannot capture a DC beam — CAPTURE_EFFICIENCY gives it 0.25, deliberately
    // low so that placing one first reads as the error it is — so a naked
    // 32-stage line measures 5.25 uA and this one measures 10.50. Twice the
    // positrons is four times the luminosity for 3% of the build cost, and it
    // is the single best-value decision available anywhere in this type.
    //
    // THE SPOT IS THE WORST ON THE ROSTER AND THAT IS NOT A DEFECT TO FIX. Six
    // doublets at 490 GeV buy 0.7% of spot area (1.247M -> 1.238M um^2) where
    // the same six at 45 GeV buy a factor of nine, because focusing goes as
    // 1/p and this beam is ten times stiffer. Pulling a real waist here
    // measures out at 74 doublets — sigma_y 10 um, $2.6B, and 74 tiles against
    // the 35 the main linac occupies. That was measured, not assumed, and it is
    // not shipped: it would be a final-focus system with a collider bolted onto
    // the back of it. The six below are the interaction region, not a working
    // final focus, and the tier-2 machine stays the brighter of the two. Reach
    // is what this one sells.
    components: [
      { type: 'positronSource', params: { particleType: 'positron' } },
      // 10.5 GeV of superconducting injector, bought entirely for its 0.50
      // capture. Delete it and the machine loses half its beam.
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'srfLinacSector', params: { gradient: 218.75, rfPhase: 0 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'plasmaAfterburner', params: { gradient: 1500 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'finalFocusDoublet', params: { polarity: 1 } },
      { type: 'finalFocusDoublet', params: { polarity: 0 } },
      { type: 'bpm', params: {} },
      { type: 'collisionPoint', params: {} },
    ],
  },
];
