"""
Component Degradation & Failure.

Every beamline component has a health value from 0.0 (dead) to 1.0 (new).
Wear rate depends on operating conditions. Below 20% health, random failures
become increasingly likely. At 0%, the component goes offline.

Consumables (klystron tubes, cathodes, getter pumps) have finite lifetimes
and degrade according to their own models.
"""

import math

# Base wear rates per game tick (health fraction lost per tick at nominal)
BASE_WEAR_RATES = {
    "rfCavity":    0.0001,   # very reliable when operated conservatively
    "cryomodule":  0.00008,
    "quadrupole":  0.00005,  # robust magnets
    "dipole":      0.00005,
    "klystron":    0.0003,   # tubes wear faster
    "source":      0.0002,   # cathode degradation
    "vacuum_pump": 0.00002,  # ion pumps are very long-lived
    "collimator":  0.0002,   # radiation damage
    "undulator":   0.00006,
    "default":     0.0001,
}

# Consumable lifetimes in operating hours
CONSUMABLE_LIFETIMES = {
    "klystron_tube": 40000.0,    # ~4.5 years continuous
    "cathode":       10000.0,    # depends on QE degradation
    "getter_pump":   50000.0,    # NEG pumps saturate
    "filament":      20000.0,    # source filaments
}

# Repair costs (game currency) per 1.0 of damage
REPAIR_COSTS = {
    "rfCavity":    5000,
    "cryomodule":  8000,
    "quadrupole":  2000,
    "dipole":      2500,
    "klystron":    10000,
    "source":      3000,
    "vacuum_pump": 1000,
    "collimator":  1500,
    "undulator":   6000,
    "default":     2000,
}

# Base repair time in ticks per 1.0 of damage (with 1 technician)
REPAIR_TIMES = {
    "rfCavity":    100,
    "cryomodule":  150,
    "quadrupole":  40,
    "dipole":      50,
    "klystron":    80,
    "source":      60,
    "vacuum_pump": 30,
    "collimator":  35,
    "undulator":   120,
    "default":     50,
}


def wear_rate(component_type, params):
    """
    Compute health loss per game tick for a component.

    Wear accelerates with:
    - gradient: exponential above nominal (for RF cavities)
    - current: linear scaling
    - vacuum: threshold degradation above 1e-7 mbar
    - temperature: margin depletion

    Parameters
    ----------
    component_type : str
        Component type key (e.g. "rfCavity", "klystron").
    params : dict
        Operating parameters. Recognised keys:
            gradient_fraction : float (operating / nominal gradient, 1.0 = nominal)
            current_fraction  : float (operating / max current, 1.0 = full)
            pressure_mbar     : float (local vacuum pressure)
            temp_margin        : float (fraction of thermal margin remaining, 1.0 = full)

    Returns
    -------
    float
        Health loss per tick (0 to ~0.01).
    """
    base = BASE_WEAR_RATES.get(component_type,
                                BASE_WEAR_RATES["default"])

    # Gradient factor: exponential above nominal
    grad_frac = params.get("gradient_fraction", 1.0)
    if grad_frac > 1.0:
        grad_factor = math.exp(2.0 * (grad_frac - 1.0))
    else:
        grad_factor = grad_frac  # below nominal, less wear

    # Current factor: linear
    curr_frac = params.get("current_fraction", 1.0)
    curr_factor = max(curr_frac, 0.1)

    # Vacuum factor: bad vacuum accelerates wear
    pressure = params.get("pressure_mbar", 1.0e-9)
    if pressure > 1.0e-7:
        vac_factor = 1.0 + 10.0 * math.log10(pressure / 1.0e-7)
    else:
        vac_factor = 1.0

    # Temperature margin: low margin increases wear
    temp_margin = params.get("temp_margin", 1.0)
    if temp_margin < 0.2:
        temp_factor = 3.0
    elif temp_margin < 0.5:
        temp_factor = 1.5
    else:
        temp_factor = 1.0

    return base * grad_factor * curr_factor * vac_factor * temp_factor


def apply_wear(health, wear_rate_val, dt=1.0):
    """
    Apply wear to a component and return updated health.

    Parameters
    ----------
    health : float
        Current health (0.0 to 1.0).
    wear_rate_val : float
        Health loss per tick from wear_rate().
    dt : float
        Number of ticks elapsed.

    Returns
    -------
    float
        New health, clamped to [0.0, 1.0].
    """
    new_health = health - wear_rate_val * dt
    return max(0.0, min(1.0, new_health))


def failure_check(health, rng_value):
    """
    Check whether a component suffers a random failure.

    Failure probability increases sharply below 20% health.

    Parameters
    ----------
    health : float
        Current health (0.0 to 1.0).
    rng_value : float
        Random value in [0, 1) (caller provides this for reproducibility).

    Returns
    -------
    bool
        True if the component has failed.
    """
    if health <= 0.0:
        return True

    if health >= 0.2:
        # Very low spontaneous failure rate above 20%
        failure_prob = 0.0001
    else:
        # Linearly increasing failure probability from 0% at health=0.2
        # to 50% at health=0.0
        failure_prob = 0.5 * (1.0 - health / 0.2)

    return rng_value < failure_prob


def consumable_lifetime(component_type, operating_hours):
    """
    Compute remaining fraction of a consumable's lifetime.

    Parameters
    ----------
    component_type : str
        Consumable type key (e.g. "klystron_tube", "cathode").
    operating_hours : float
        Total hours the consumable has been operating.

    Returns
    -------
    float
        Fraction remaining (1.0 = new, 0.0 = end of life).
    """
    max_hours = CONSUMABLE_LIFETIMES.get(component_type, 20000.0)
    fraction = 1.0 - operating_hours / max_hours
    return max(0.0, min(1.0, fraction))


def repair_cost(component_type, damage):
    """
    Compute the cost to repair a component.

    Parameters
    ----------
    component_type : str
        Component type key.
    damage : float
        Amount of damage (0.0 = pristine, 1.0 = destroyed).

    Returns
    -------
    float
        Repair cost in game currency ($).
    """
    base_cost = REPAIR_COSTS.get(component_type, REPAIR_COSTS["default"])
    return base_cost * max(0.0, min(1.0, damage))


def repair_time(component_type, damage, n_technicians=1):
    """
    Compute the time required to repair a component.

    More technicians reduce repair time (diminishing returns).

    Parameters
    ----------
    component_type : str
        Component type key.
    damage : float
        Amount of damage (0.0 to 1.0).
    n_technicians : int
        Number of technicians assigned to the repair.

    Returns
    -------
    float
        Repair time in game ticks.
    """
    base_time = REPAIR_TIMES.get(component_type, REPAIR_TIMES["default"])
    raw_time = base_time * max(0.0, min(1.0, damage))

    # Diminishing returns: each extra tech gives sqrt scaling
    n = max(1, n_technicians)
    return raw_time / math.sqrt(n)
