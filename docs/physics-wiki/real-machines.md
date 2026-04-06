# Real-World Machines

How the game's machine types map to real facilities. Use these as reference points for whether your in-game beamline is performing realistically.

---

## Tier 1: Electron Linacs

### SLAC Linac (1966-2006)
- **Type:** 3 km S-band (2.856 GHz) copper linac
- **Energy:** Up to 50 GeV
- **Current:** ~10^10 electrons per bunch
- **Technology:** Normal-conducting disk-loaded waveguide
- **Historical note:** The longest linear accelerator ever built. Discovered the quark substructure of the proton (1968 Nobel Prize).

### CTF3 at CERN (2003-2016)
- **Type:** 150 MeV electron linac, CLIC test facility
- **Energy:** 150 MeV
- **Current:** 4 A peak
- **Technology:** S-band copper structures
- **Note:** A compact linac used to test drive-beam acceleration concepts for CLIC.

### Medical/Industrial Linacs
- **Type:** Compact electron linacs, 4-25 MeV
- **Energy:** 6-25 MeV
- **Current:** ~100 mA peak (pulsed)
- **Use:** Cancer radiation therapy, cargo inspection, sterilization
- **Note:** The most common type of particle accelerator in the world — thousands in hospitals.

**What makes a good Tier 1 beamline in the game:** Deliver >100 MeV at >0.1 mA to a target with reasonable transmission (>90%). This is well within what even a small university lab can achieve.

---

## Tier 2: Photoinjectors

### LCLS Injector (SLAC)
- **Gun:** 1.6-cell S-band copper RF gun, 120 MV/m peak field
- **Energy at gun exit:** 6 MeV
- **Emittance:** 0.4 um-rad normalized at 250 pC
- **Solenoid:** Peak field 0.28 T, positioned for emittance compensation
- **First accelerating section:** Two 3 m S-band sections, bringing beam to 135 MeV
- **Key insight:** The LCLS injector set the standard for high-brightness photo-injectors. The emittance compensation technique was proven here.

### European XFEL Injector (DESY)
- **Gun:** 1.5-cell L-band (1.3 GHz) copper gun
- **Energy at gun exit:** 6.6 MeV
- **Emittance:** 0.6 um-rad normalized at 1 nC
- **Solenoid:** Part of the gun assembly
- **First accelerating section:** Superconducting TESLA modules
- **Key insight:** Uses L-band RF for better bunch quality at higher charge.

### Jefferson Lab DC Photogun
- **Gun:** 350 kV DC gun with GaAs photocathode
- **Energy at gun exit:** 350 keV
- **Emittance:** ~1 um-rad normalized
- **Specialty:** Produces polarized electron beams (essential for nuclear physics)
- **Key insight:** DC guns have lower gradient but can run CW with high average current.

**What makes a good Tier 2 beamline in the game:** Achieve normalized emittance < 1 um-rad at > 1 mA. The LCLS injector achieves 0.4 um-rad — that's world-class. Anything below 1 um-rad with reasonable current is excellent.

---

## Tier 3: Free Electron Lasers

### LCLS (SLAC, 2009-present)
- **Energy:** 2-17 GeV (variable)
- **Bunch charge:** 20-250 pC
- **Peak current:** 3-4 kA after two-stage compression
- **Compression:** BC1 at 250 MeV (R56 = -45 mm), BC2 at 5 GeV (R56 = -25 mm)
- **Undulator:** 112 m, 30 mm period, K = 3.5
- **Wavelength:** 0.15-10 nm (hard to soft X-ray)
- **Gain length:** ~3.5 m
- **Saturation power:** ~10 GW
- **Note:** The world's first hard X-ray FEL. Transforms structural biology, chemistry, and materials science.

### European XFEL (DESY, 2017-present)
- **Energy:** 8.5-17.5 GeV
- **Bunch charge:** 0.02-1 nC
- **Peak current:** 5 kA
- **Undulator:** Up to 175 m, 40 mm period
- **Wavelength:** 0.05-5 nm
- **Special:** Can produce up to 27,000 pulses per second (superconducting linac)
- **Note:** Highest repetition rate X-ray FEL. Uses 100 superconducting TESLA modules.

### SwissFEL (PSI, 2016-present)
- **Energy:** 2.1-5.8 GeV
- **Undulator:** 60 m, 15 mm period (compact!)
- **Wavelength:** 0.1-7 nm
- **Note:** Compact design using short-period undulators. Demonstrates that you don't need the longest linac — clever design matters.

### FLASH (DESY, 2005-present)
- **Energy:** 0.4-1.25 GeV
- **Wavelength:** 4.2-52 nm (EUV/soft X-ray)
- **Note:** The world's first FEL user facility. Paved the way for LCLS and European XFEL.

**What makes a good Tier 3 beamline in the game:** Achieve FEL saturation at < 10 nm wavelength. This requires:
- Normalized emittance < 1 um-rad (from Tier 2)
- Peak current > 1 kA (from bunch compression)
- Energy spread < Pierce parameter rho
- Undulator long enough for ~20 gain lengths
- Proper matching at undulator entrance

---

## Tier 4: Electron-Positron Colliders

### SLC (SLAC, 1989-1998)
- **Type:** Single-pass linear collider
- **Energy:** 45.6 GeV per beam (91 GeV center-of-mass = Z pole)
- **Luminosity:** 3 x 10^30 /cm^2/s
- **Bunches:** Single bunch, 120 Hz
- **IP beam size:** sigma_x = 1.5 um, sigma_y = 0.5 um
- **Note:** The world's only linear collider to operate. Proved the concept works. Measured Z boson properties with high precision.

### ILC (International Linear Collider, proposed)
- **Type:** Two 11 km superconducting linacs
- **Energy:** 125 GeV per beam (250 GeV center-of-mass, upgradable to 500)
- **Luminosity:** 1.8 x 10^34 /cm^2/s
- **IP beam size:** sigma_x = 516 nm, sigma_y = 7.7 nm (flat beam!)
- **Bunches:** 1312 bunches per pulse, 5 Hz
- **Positron source:** Undulator-based (produces polarized positrons)
- **Note:** The most mature linear collider design. Would be a Higgs factory.

### CLIC (Compact Linear Collider, proposed, CERN)
- **Type:** Two-beam acceleration, normal-conducting
- **Energy:** 190 GeV per beam (380 GeV, upgradable to 3 TeV)
- **Luminosity:** 1.5 x 10^34 /cm^2/s (380 GeV stage)
- **IP beam size:** sigma_x = 149 nm, sigma_y = 2.9 nm
- **Technology:** Uses a high-current, low-energy drive beam to power high-gradient (100 MV/m) accelerating structures
- **Note:** Pushes gradient to the extreme. Novel two-beam scheme.

### LEP (CERN, 1989-2000)
- **Type:** Circular e+e- collider (not a linac, but the comparison is instructive)
- **Energy:** Up to 104.5 GeV per beam
- **Circumference:** 26.7 km
- **Luminosity:** 10^32 /cm^2/s
- **Note:** Highest energy e+e- collider ever operated. Limited by synchrotron radiation (~3 GeV lost per revolution at top energy). Demonstrated why future e+e- colliders at higher energy must be linear.

**What makes a good Tier 4 beamline in the game:** Achieve luminosity > 10^30 /cm^2/s at the Z-pole (91 GeV center-of-mass). This requires:
- Two full beamlines (electron + positron) from source to IP
- Final focus achieving sigma_y* < 100 nm
- Positron source with adequate yield
- Beam-beam tune shift managed below ~0.05
- Good overall transmission and stability

---

## Parameter Comparison Table

| Parameter | Medical Linac | LCLS Injector | LCLS FEL | ILC Collider |
|-----------|--------------|---------------|----------|-------------|
| Energy | 10 MeV | 135 MeV | 13.6 GeV | 250 GeV |
| Current (peak) | 100 mA | 50 A | 3 kA | 6 mA (avg) |
| Emittance (norm) | ~10 um | 0.4 um | 0.4 um | 10 nm (y) |
| Bunch length | ~1 us | 10 ps | 20 fs | 300 um |
| Total length | 1 m | 10 m | 3 km | 31 km |
| Components | ~5 | ~20 | ~200 | ~10,000 |
| Game tier | 1 | 2 | 3 | 4 |

This shows the exponential growth in complexity from tier to tier — each level is roughly an order of magnitude more challenging than the last.
