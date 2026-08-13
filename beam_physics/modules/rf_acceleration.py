import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT

# Matched against element["type"], which gameplay.py sets to the component's
# PHYSICS type, not its catalogue id. Every rung of the RF ladder declares
# physicsType 'rfCavity' or 'cryomodule', so all of them arrive here through
# these four names. Three speculative catalogue ids used to sit in this set
# alongside them; being catalogue ids rather than physics types, they could
# never match anything and were dead the day they were written.
RF_ELEMENT_TYPES = {"rfCavity", "cryomodule", "buncher", "harmonicLinearizer"}

DEFAULT_RF_FREQ = 1.3e9

# RMS phase extent of the charge an RF bucket captures out of a DC beam, in
# radians. 0.5 rad (~29 deg) is a typical capture window — wide enough that a
# real fraction of the DC current survives, narrow enough to be a bunch. It
# converts to a bunch length as sigma_t = PHASE / (2 pi f), so the same constant
# gives 61 ps at 1.3 GHz and 400 ps at 200 MHz.
BUNCH_PHASE_SIGMA_RAD = 0.5

# Keyed on game_type (the catalogue id), NOT on the physics type — this is
# where two components sharing physicsType 'cryomodule' stop being the same
# machine. beta is the particle velocity the structure's cell spacing is cut
# for, and the transit-time factor punishes a beam that arrives at any other
# speed.
#
# It is the entire content of the proton ladder: a 650 MHz beta=0.61 module
# runs a 200 MeV proton (beta 0.57) at TTF 0.99 and an 800 MeV one (beta 0.84)
# at 0.88, while the 805 MHz beta=0.86 module inverts that — 0.61 at 200 MeV,
# 1.00 at 800. Build them in the wrong order and the machine tells you.
# Electron structures are beta=1 hardware and sit at 0.999.
DESIGN_BETA = {
    "rfq":                0.04,
    "pillboxCavity":      0.1,
    "buncher":            0.3,
    "halfWaveResonator":  0.1,
    "spokeCavity":        0.35,
    "rfCavity":           0.999,
    "sbandStructure":     0.95,
    # Disc-loaded travelling wave, phase velocity c. C- and X-band linacs
    # (SACLA, SwissFEL, CLIC) exist to accelerate already-relativistic
    # electrons and are useless on anything slower — which 0.999 is what says.
    "cbandStructure":     0.999,
    "xbandStructure":     0.999,
    "twoBeamModule":      0.999,
    # Not an RF structure. A plasma wake only traps and holds a bunch that is
    # already moving at c; there is no low-beta regime for it at all.
    "plasmaAfterburner":  0.999,
    "ellipticalSrfCavity":0.65,
    # The proton beta ladder. These two numbers are the reason spallation is
    # built 650-then-805, exactly as SNS and PIP-II are laid out.
    "srf650Cryomodule":   0.61,
    "srf805Cryomodule":   0.86,
    "cryomodule":         0.65,
    # TESLA 9-cell cavities are beta=1 structures — the cell spacing is
    # lambda/2 with no beta derating — so the 1.3 GHz electron rungs take
    # 0.999. NOTE the `cryomodule` entry above says 0.65 for the same hardware,
    # which costs it ~19% of its catalogue energy gain against a relativistic
    # beam. That looks like an error, but it is existing calibration and
    # changing it moves every electron machine already built, so it is left
    # alone here and flagged rather than quietly rewritten.
    "cwCryomodule":       0.999,
    "nbSnCryomodule":     0.999,
    "srfLinacSector":     0.999,
    "harmonicLinearizer": 0.9,
    # NOT an RF structure. The energy degrader declares physicsType 'rfCavity'
    # because signed `energyGain` is the only way anything in this engine can
    # take energy OUT of a beam, and a graphite wedge has no design beta at all
    # — the transit-time factor is meaningless for it. Without an entry here it
    # would default to 0.9 (a beta=1 electron structure) and the TTF would eat
    # 40-80% of the requested degradation across the therapy range, so the
    # component's "degrade to 90 MeV" slider would silently deliver 150. 0.5
    # sits in the middle of the proton betas this device sees (0.37 at 70 MeV,
    # 0.60 at 230) and holds the TTF between 0.79 and 0.96 across the whole
    # clinical range, which is as close to "no correction" as this table can
    # express. See the physicsType note on energyDegrader in
    # src/data/beamline-components.raw.js.
    "energyDegrader": 0.5,
}

CAPTURE_EFFICIENCY = {
    "rfq":                0.80,
    "pillboxCavity":      0.50,
    "buncher":            0.65,
    "halfWaveResonator":  0.55,
    "spokeCavity":        0.60,
    "rfCavity":           0.45,
    "sbandStructure":     0.45,
    # Capture narrows with frequency: the RF bucket is a fixed slice of phase,
    # and a shorter period is a shorter bucket in time.
    "cbandStructure":     0.42,
    "xbandStructure":     0.40,
    "twoBeamModule":      0.40,
    # A plasma stage cannot capture a DC beam at all — it needs a bunch already
    # short compared to the plasma wavelength and already at c. This number only
    # ever fires in the pathological case where one is placed as the first RF
    # element in a line, and it is low to make that read as the mistake it is.
    "plasmaAfterburner":  0.25,
    "ellipticalSrfCavity":0.50,
    "srf650Cryomodule":   0.50,
    "srf805Cryomodule":   0.50,
    "cryomodule":         0.50,
    "cwCryomodule":       0.50,
    "nbSnCryomodule":     0.50,
    "srfLinacSector":     0.50,
    "harmonicLinearizer": 0.55,
    # On a cyclotron therapy line the degrader IS the first element this module
    # sees, so it is what stamps the bunch structure — and the beam really is
    # already bunched, at the cyclotron's own 106 MHz, which the component
    # declares in stats.rfFrequency. What it is NOT doing is capturing a DC
    # beam, so this number is not a capture efficiency: it is degrader
    # transmission, and 0.35 is deliberately gentle against the 1-40% a real
    # wedge-plus-slits system passes. The rest of the loss arrives honestly,
    # through the emittance blow-up hitting downstream apertures.
    "energyDegrader": 0.35,
}


def _transit_time_factor(beam_beta, design_beta):
    if beam_beta <= 0 or design_beta <= 0:
        return 0.01
    inv_diff = abs(1.0 / beam_beta - 1.0 / design_beta) * design_beta
    if inv_diff < 1e-6:
        return 1.0
    arg = np.pi * inv_diff
    ttf = abs(np.sin(arg) / arg)
    return max(0.01, min(1.0, ttf))


class RFAccelerationModule(PhysicsModule):
    """Energy gain, adiabatic damping, and chirping from RF cavities."""

    def __init__(self):
        super().__init__(name="rf_acceleration", order=20)

    def applies_to(self, element, machine_type):
        return element.get("type", "") in RF_ELEMENT_TYPES

    def apply(self, beam, element, context):
        dE_nominal = element.get("energyGain", 0.5)
        phase_deg = element.get("rfPhase", 0.0)
        phase_rad = np.radians(phase_deg)
        f_rf = element.get("rfFrequency", DEFAULT_RF_FREQ)

        # Phase-dependent energy gain
        dE = dE_nominal * np.cos(phase_rad)

        game_type = element.get("game_type", element.get("type", ""))
        design_beta = DESIGN_BETA.get(game_type, 0.9)
        ttf = _transit_time_factor(beam.beta, design_beta)
        dE *= ttf

        if ttf < 0.95:
            mismatch_factor = (1.0 - ttf) * 0.1
            beam.sigma[0, 0] *= (1.0 + mismatch_factor)
            beam.sigma[2, 2] *= (1.0 + mismatch_factor)
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        energy_before = beam.energy
        beam.energy += dE
        if beam.energy < beam.mass:
            beam.energy = beam.mass
        beam.update_relativistic()

        # First RF element establishes the bunch structure
        if not context.bunch_frequency_set:
            was_dc = beam.bunch_frequency <= 0
            beam.bunch_frequency = f_rf
            context.bunch_frequency_set = True
            capture = CAPTURE_EFFICIENCY.get(game_type, 0.5)
            beam.current *= capture
            beam.initial_current = beam.current
            # Capturing a DC beam sets its bunch LENGTH as well as its
            # frequency: the captured charge occupies a slice of RF phase, so
            # the bunch is a fraction of the RF period. Lower frequency means
            # longer bunches, and that is the whole reason a 200 MHz buncher
            # and a 1.3 GHz cavity are different machines.
            #
            # Without this the bunch length stayed at whatever the source
            # declared (1 ps) regardless of frequency, so a 200 MHz buncher
            # reported 40 A peak from a 20 mA beam — two thousand times the
            # average — and space charge annihilated it on the spot. Bunches
            # start long here and are shortened later by a chicane, which is
            # the real order of operations.
            if was_dc:
                sigma_t = BUNCH_PHASE_SIGMA_RAD / (2.0 * np.pi * f_rf)
                beam.sigma[4, 4] = sigma_t ** 2

        # Adiabatic damping
        if energy_before > 0 and beam.energy > 0 and beam.energy != energy_before:
            ratio = energy_before / beam.energy
            beam.sigma[1, :] *= ratio
            beam.sigma[:, 1] *= ratio
            beam.sigma[3, :] *= ratio
            beam.sigma[:, 3] *= ratio
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # RF-induced energy spread: bunch samples different RF phases
        # δ_rms = 2π f_rf × V_acc × |sin(φ)| × σ_t / E
        sigma_t = beam.bunch_length()
        if sigma_t > 0 and beam.energy > 0 and abs(phase_rad) > 1e-6:
            delta_rf = (2.0 * np.pi * f_rf * dE_nominal
                        * abs(np.sin(phase_rad)) * sigma_t / beam.energy)
            beam.sigma[5, 5] += delta_rf ** 2

        # Chirp
        V_acc = dE_nominal
        h = (2.0 * np.pi * f_rf * V_acc * np.sin(phase_rad)) / (beam.energy * SPEED_OF_LIGHT)
        context.chirp += h

        if abs(h) > 1e-15:
            beam.sigma[4, 5] += h * beam.sigma[4, 4]
            beam.sigma[5, 4] = beam.sigma[4, 5]

        beam._update_bunch_properties()

        return EffectReport(
            module=self.name,
            element_index=context.element_index,
            details={"energy_gain": dE, "phase_deg": phase_deg,
                     "chirp_added": h, "total_chirp": context.chirp,
                     "rf_frequency": f_rf},
        )
