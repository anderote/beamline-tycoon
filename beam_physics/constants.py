import numpy as np

# Particle masses (GeV/c^2)
ELECTRON_MASS = 0.511e-3
PROTON_MASS = 0.938

# Speed of light (m/s)
SPEED_OF_LIGHT = 2.998e8

# Synchrotron radiation constant (m/GeV^3)
C_GAMMA = 8.85e-5

# Default beam pipe aperture radius (m)
# 50mm is generous but rewards good optics with less loss
DEFAULT_APERTURE = 0.050

# Beam trip threshold — fraction of current lost before trip
TRIP_THRESHOLD = 0.5

# Default electron source parameters
# Elementary charge (Coulombs)
ELECTRON_CHARGE = 1.602176634e-19

# Alfven current (A)
ALFVEN_CURRENT = 17045.0

# Default bunch frequency (Hz) — 1.3 GHz is typical for L-band linacs
DEFAULT_BUNCH_FREQUENCY = 1.3e9

DEFAULT_SOURCE = {
    "energy": 0.01,                # GeV (10 MeV)
    "mass": ELECTRON_MASS,
    "current": 1.0,                # mA
    "eps_norm_x": 1.0e-6,          # normalized emittance, m-rad
    "eps_norm_y": 1.0e-6,
    "sigma_dE": 1.0e-3,            # fractional energy spread rms
    "sigma_dt": 3.3e-12,           # bunch length rms in seconds (~1mm/c)
    "beta_x": 10.0,                # initial Twiss beta_x (m)
    "beta_y": 10.0,                # initial Twiss beta_y (m)
    "alpha_x": 0.0,                # initial Twiss alpha_x
    "alpha_y": 0.0,                # initial Twiss alpha_y
}
