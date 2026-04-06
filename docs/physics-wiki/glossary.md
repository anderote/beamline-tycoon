# Glossary of Accelerator Physics Terms

## A

**Adiabatic damping:** The shrinking of geometric emittance when a beam is accelerated. The beam gets "stiffer" — particles maintain their absolute transverse momentum, but the ratio (divergence) decreases as longitudinal momentum increases. Normalized emittance is conserved.

**Alfven current:** The maximum current a beam can carry in free space before its self-fields defocus it completely. I_A = 17045 A for electrons. Appears in space charge and FEL formulas.

**Alpha (Twiss):** The Twiss parameter alpha = -<x*x'>/eps. Describes the correlation between position and angle. Alpha = 0 at a beam waist (beam is neither converging nor diverging).

**Aperture:** The clear opening of the beam pipe or a component through which the beam must pass. Typically 25-50 mm radius.

## B

**Beam-beam effect:** The electromagnetic interaction between two colliding beams. Acts as a lens, causing tune shift and potentially instabilities.

**Beam dump:** A massive block of material designed to safely absorb the full beam power.

**Beamstrahlung:** Synchrotron-like radiation emitted when a particle passes through the strong electromagnetic field of the opposing bunch in a collision.

**Beta function (Twiss):** The Twiss parameter beta describes the beam envelope. Beam size = sqrt(eps * beta). Large beta = large beam. The beta function oscillates through a FODO cell.

**BPM (Beam Position Monitor):** A non-intercepting diagnostic that measures the transverse position of the beam centroid.

**Brightness:** Current per unit emittance squared: B = I / (eps_x * eps_y). The figure of merit for sources. Higher brightness enables tighter focusing and better FEL performance.

**Bunch:** A packet of particles traveling together. Beams are structured as a train of bunches separated by the RF wavelength.

**Bunch compression:** The process of shortening the bunch length by creating an energy chirp (off-crest RF) and then passing through a dispersive section (chicane).

## C

**Cathode:** The surface from which electrons are emitted. Thermionic cathodes use heat; photocathodes use laser light.

**Chicane:** A set of four dipole magnets that create a detour in the beam path. The path length depends on energy (R56), enabling bunch compression.

**Chromaticity:** The dependence of focusing strength on particle energy. In a quad, higher-energy particles are focused less. Chromaticity limits how tightly you can focus at the IP.

**Coherent Synchrotron Radiation (CSR):** Synchrotron radiation emitted coherently when the bunch length is comparable to or shorter than the radiation wavelength. Power scales as N^2 instead of N.

**Collimator:** A device that intercepts particles outside a defined aperture, cleaning the beam halo.

**Compton scattering:** Scattering of photons off electrons. Used for polarimetry, energy measurement, and potentially gamma-gamma collisions.

**Crossing angle:** The angle between two colliding beams at the IP. Prevents parasitic collisions but reduces luminosity.

**Cryomodule:** A thermally insulated vessel containing one or more superconducting RF cavities, cooled to 2-4 K.

## D

**Dipole magnet:** A magnet producing a uniform field, used to bend the beam's trajectory. Creates dispersion and synchrotron radiation.

**Dispersion:** The dependence of transverse position on energy: eta = dx/(dE/E). Created by dipoles, propagated through all elements.

**Disruption parameter:** Measures the strength of the beam-beam pinch effect. D > 1 means significant enhancement of luminosity from mutual focusing.

## E

**Emittance:** The area of the beam's phase space ellipse (divided by pi). Measures beam quality in a given plane. Lower = better.

**Emittance compensation:** A technique using a solenoid after the gun to realign phase space slices that were rotated by space charge, reducing projected emittance.

**Energy spread:** The RMS fractional energy deviation within the bunch: sigma_dE/E. Typical values: 10^-4 to 10^-2.

## F

**FEL (Free Electron Laser):** A device that produces coherent radiation by passing a high-brightness electron beam through a long undulator. The beam self-organizes (micro-bunches) at the radiation wavelength.

**FODO cell:** The basic focusing structure: Focusing quad — drift — Defocusing quad — drift. Provides net focusing in both transverse planes.

**Focal length:** The distance at which a focusing element brings a parallel beam to a point. For a thin quad: f = 1/(k*L).

## G

**Gain length:** The e-folding length for FEL power growth: P(z) = P_0 * exp(z/L_gain). Shorter is better.

**Gamma (relativistic):** The Lorentz factor: gamma = E/(mc^2). For a 1 GeV electron, gamma ≈ 2000.

**Geometric emittance:** Emittance not corrected for relativistic effects. Shrinks during acceleration (adiabatic damping).

## H

**Harmonic linearizer:** An RF cavity at a higher harmonic of the main linac, used to cancel the sinusoidal curvature of the energy chirp for more uniform bunch compression.

## I

**Interaction point (IP):** The location where two beams collide in a collider. Surrounded by the detector.

**Integrated luminosity:** Luminosity accumulated over time: integral of L*dt. Measured in inverse barns (fb^-1). Determines the total number of events observed.

## K

**K parameter (undulator):** Dimensionless measure of undulator field strength: K = 0.934 * B[T] * period[cm]. K > 1 means the electron oscillation amplitude exceeds the radiation opening angle.

## L

**Linac (linear accelerator):** An accelerator where the beam passes through once in a straight line (as opposed to a circular machine where the beam recirculates).

**Liouville's theorem:** Phase space density is conserved under Hamiltonian (linear, conservative) forces. This means emittance cannot be reduced by linear optics alone.

**Luminosity:** The collision rate per unit cross-section: L = N1*N2*f/(4*pi*sigma_x*sigma_y). The figure of merit for colliders.

## M

**Matching:** Adjusting quadrupole strengths at the boundary between beamline sections so that the Twiss parameters are continuous. Prevents beta beating.

**Mean Transverse Energy (MTE):** The average transverse kinetic energy of electrons emitted from a photocathode. Lower MTE = lower thermal emittance.

**Micro-bunching:** The self-organization of electrons at the radiation wavelength inside an FEL undulator. Creates coherent emission.

**Ming Xie parameters:** Dimensionless parameters that quantify how much emittance, energy spread, and diffraction degrade the FEL gain length from the ideal 1D value.

## N

**Normalized emittance:** Emittance corrected for relativistic effects: eps_n = beta*gamma*eps_geometric. Conserved during acceleration (unlike geometric emittance, which shrinks).

## P

**Perveance:** Dimensionless measure of space charge strength: K = 2I/(I_A * beta^3 * gamma^3). Important at low energy.

**Phase advance:** The number of betatron oscillation degrees per FODO cell. Optimal range: 60-90 degrees.

**Phase space:** The 6D space of particle coordinates: (x, x', y, y', t, dE/E). The beam distribution in phase space is described by the sigma matrix.

**Pierce parameter (rho):** The fundamental FEL parameter. Determines gain length (L_g ~ lambda_u/rho), saturation power (P_sat ~ rho*P_beam), and bandwidth (~rho).

**Pinch enhancement:** The luminosity increase from the mutual focusing of colliding beams (beam-beam pinch). Factor H_D, typically 1.2-2.0.

## Q

**Q0 (intrinsic quality factor):** Measures the RF losses in a cavity: Q0 = stored energy * omega / power dissipated. SRF cavities: Q0 ~ 10^10. Normal conducting: Q0 ~ 10^4.

**Quadrupole magnet:** A magnet with field increasing linearly from the axis. Focuses in one plane, defocuses in the other.

**Quantum excitation:** The emittance and energy spread growth from the random nature of photon emission in synchrotron radiation.

## R

**R56:** The momentum compaction of a beamline section: path length change per unit fractional energy deviation. Key parameter of bunch compressor chicanes.

**RF cavity:** A resonant structure that uses oscillating electromagnetic fields to accelerate charged particles.

## S

**Septum magnet:** A magnet with a thin dividing wall, creating a field region and a field-free region side by side. Used to inject or extract beams.

**Sigma matrix:** The 6x6 covariance matrix describing the beam distribution in phase space. Contains all second-order beam properties (sizes, divergences, correlations, emittances).

**Solenoid:** A magnet producing a longitudinal field. Focuses equally in both transverse planes but couples x and y. Essential for emittance compensation after the gun.

**Space charge:** The mutual electromagnetic repulsion between particles in the beam. Dominant at low energy (suppressed by 1/gamma^2 at high energy).

**Synchrotron radiation:** Electromagnetic radiation emitted by charged particles when they are deflected. Power scales as gamma^4 — dominant for electrons, negligible for protons at the same energy.

## T

**Transfer matrix:** A 6x6 matrix describing how an element transforms the beam's phase space coordinates. The beam sigma matrix transforms as sigma_out = R * sigma_in * R^T.

**Tune:** The number of betatron oscillations per revolution (in a ring) or per cell. Related to phase advance.

**Twiss parameters:** (alpha, beta, gamma_t) — describe the shape, size, and orientation of the phase space ellipse at a given point in the beamline.

## U

**Undulator:** A periodic magnetic structure that forces the beam into a sinusoidal path, producing radiation. In an FEL, the undulator enables the micro-bunching instability that produces coherent light.

## W

**Wakefield:** Electromagnetic fields left behind by a bunch as it passes through a structure (cavity, pipe discontinuity). These fields can affect trailing bunches or the tail of the same bunch.
