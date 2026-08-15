# Equations Reference

All key equations used in the physics engine, organized by module.

---

## Relativity

```
gamma = E / (m * c^2)
beta = sqrt(1 - 1/gamma^2)
```

Electron mass: `m_e * c^2 = 0.511 MeV = 0.511e-3 GeV`
Proton mass: `m_p * c^2 = 938 MeV = 0.938 GeV`

---

## Linear Optics

### Drift
```
R = [[1, L],    (both x and y planes)
     [0, 1]]
```

### Quadrupole (focusing plane)
```
k = 0.2998 * G[T/m] / p[GeV/c]
phi = sqrt(k) * L

R_focus = [[cos(phi),           sin(phi)/sqrt(k)],
           [-sqrt(k)*sin(phi),  cos(phi)         ]]

R_defocus = [[cosh(phi),          sinh(phi)/sqrt(k)],
             [sqrt(k)*sinh(phi),  cosh(phi)         ]]
```

### Sector Dipole (horizontal plane)
```
theta = bend angle (radians)
rho = L / theta  (bending radius)

R_x = [[cos(theta),       rho*sin(theta)   ],
       [-sin(theta)/rho,  cos(theta)        ]]

Dispersion: R[0,5] = rho*(1 - cos(theta))
            R[1,5] = sin(theta)
```

### Dipole Edge Focusing (vertical, thin lens)
```
R_edge = [[1,           0       ],
          [tan(e)/rho,  1       ]]
```
where `e` = edge angle (= theta/2 for symmetric sector dipole).

### Solenoid
```
k = 0.2998 * B[T] / (2 * p[GeV/c])
phi = k * L
C = cos(phi), S = sin(phi)

4x4 coupled matrix:
R = [[C^2,    SC/k,   SC,    S^2/k ],
     [-kSC,   C^2,    -kS^2, SC    ],
     [-SC,    -S^2/k, C^2,   SC/k  ],
     [kS^2,   -SC,    -kSC,  C^2   ]]
```

### Sigma Matrix Propagation
```
sigma_out = R @ sigma_in @ R^T
```

### Dispersion Propagation
```
eta_x_out  = R[0,0]*eta_x + R[0,1]*eta_x' + R[0,5]
eta_x'_out = R[1,0]*eta_x + R[1,1]*eta_x' + R[1,5]
```

### Twiss Parameters
```
eps = sqrt(sigma[0,0]*sigma[1,1] - sigma[0,1]^2)
beta = sigma[0,0] / eps
alpha = -sigma[0,1] / eps
gamma_t = sigma[1,1] / eps = (1 + alpha^2) / beta
```

### Beam Size
```
sigma_x = sqrt(eps * beta)
sigma_x (with dispersion) = sqrt(eps*beta + (eta*sigma_dE)^2)
```

### FODO Cell Stability
```
cos(mu) = 1 - L^2 / (2*f^2)
Stable when |cos(mu)| < 1

beta_max = L * (1 + sin(mu/2)) / sin(mu)
beta_min = L * (1 - sin(mu/2)) / sin(mu)
```

---

## RF Acceleration

### Energy Gain
```
dE = V_acc * cos(phi_rf)
V_acc = gradient * L_active
```

### Chirp Rate
```
h = (2*pi*f_rf * V_acc * sin(phi_rf)) / (E_beam * c)
```

### Adiabatic Damping
```
eps_geometric_after = eps_geometric_before * (E_before / E_after)
eps_normalized = beta*gamma * eps_geometric  (conserved)
```

Applied to sigma matrix:
```
sigma[1,:] *= E_before / E_after
sigma[:,1] *= E_before / E_after
sigma[3,:] *= E_before / E_after
sigma[:,3] *= E_before / E_after
```

---

## Space Charge

### Generalized Perveance
```
K = (2 * I_peak) / (I_A * beta^3 * gamma^3)
I_A = 17045 A  (Alfven current)
```

### Envelope Equation (defocusing term)
```
sigma_x'' = K / (4 * sigma_x)  (plus focusing from external fields)
```

### Applied to Sigma Matrix (per element)
```
delta_sigma[1,1] += K * L / sigma_x
delta_sigma[3,3] += K * L / sigma_y
```

---

## Synchrotron Radiation

### Energy Loss per Dipole
```
U = C_gamma * E^4 * |theta| / rho
C_gamma = 8.85e-5 m/GeV^3
```

### Quantum Excitation
```
d(sigma_dE^2)/ds = C_q * gamma^5 / rho^3
C_q = (55 / (48*sqrt(3))) * r_e * lambda_c / (2*pi) ≈ 3.84e-13 m
```

Emittance growth (horizontal):
```
d(eps_x)/ds = C_q * gamma^5 * H / rho^3
H = (eta^2 + (beta*eta' - alpha*eta)^2) / beta  (dispersion invariant)
```

---

## Bunch Compression

### Compression Ratio
```
C = 1 / |1 + h * R56|
```

### Peak Current After Compression
```
I_peak_new = I_peak_old * C = I_peak_old / |1 + h * R56|
```

### Bunch Length After Compression
```
sigma_t_new = sigma_t_old / C = sigma_t_old * |1 + h * R56|
```

### CSR Energy Spread
```
sigma_delta_CSR = (N * r_e) / (R^(2/3) * sigma_z^(4/3))
r_e = 2.818e-15 m  (classical electron radius)
```

### CSR Emittance Growth
```
d_eps = (R56 * sigma_delta_CSR)^2 / beta_x
```

---

## FEL

### Resonant Wavelength
```
lambda_r = lambda_u / (2*gamma^2) * (1 + K^2/2)
K = 0.934 * B[T] * lambda_u[cm]
```

### Pierce Parameter
```
rho = (1/(2*gamma)) * (I_peak * K^2 * lambda_u / (4 * I_A * sigma_x^2))^(1/3)
```

### 1D Gain Length
```
L_gain_1D = lambda_u / (4*pi*sqrt(3)*rho)
```

### Saturation
```
L_sat ≈ 20 * L_gain
P_sat = rho * E_beam[J] * I_peak
```

### Power Growth
```
P(z) = P_noise * exp(z / L_gain)    for z < L_sat
P(z) = P_sat                         for z >= L_sat
```

### Ming Xie Parameters (simplified)
```
eta_d = L_gain_1D * lambda_r / (4*pi*sigma_x^2)
eta_e = 4*pi * L_gain_1D * sigma_delta / lambda_u
eta_gamma = L_gain_1D * 4*pi * eps_n / (gamma * lambda_r * sigma_x)

L_gain_3D = L_gain_1D * (1 + eta)
eta ≈ 0.45*eta_d^0.57 + 0.55*eta_e^1.6 + 2.0*eta_gamma^2.9 + ...
```

---

## Beam-Beam (Collider)

### Luminosity
```
L = (N1 * N2 * f_rep * H_D) / (4*pi * sigma_x* * sigma_y*)
```

### Beam-Beam Tune Shift
```
xi_y = (N * r_e * beta_y*) / (4*pi * gamma * sigma_y* * (sigma_x* + sigma_y*))
Limit: xi_y < ~0.05
```

### Disruption Parameter
```
D_y = (2 * N * r_e * sigma_z) / (gamma * sigma_y* * (sigma_x* + sigma_y*))
```

### Pinch Enhancement
```
H_D ≈ 1 + D_y^(1/4)    (for flat beams, D_y > 1)
```

### Piwinski Crossing Angle Reduction
```
S = 1 / sqrt(1 + (phi * sigma_z / (2*sigma_x*))^2)
L_effective = L_geometric * S
```

### Center-of-Mass Energy
```
sqrt(s) = 2 * E_beam    (equal energy head-on collision)
```

---

## Aperture Loss

### Gaussian Beam Clipping
```
survived = erf(a / (sqrt(2)*sigma_x)) * erf(a / (sqrt(2)*sigma_y))
loss_fraction = 1 - survived
```

---

## Beam-Gas Scattering

Residual gas grows emittance (multiple Coulomb scattering) and removes current
(large-angle and nuclear scattering). This is the only path by which vacuum
reaches beam quality.

```
d<theta^2> = K_transport * n * L / (beta*gamma)^2
sigma[1,1] += d<theta^2>
sigma[3,3] += d<theta^2>

I *= exp(-n * sigma_loss * L),   sigma_loss = 1e-22 m^2
n = P / (k_B T),  T = 300 K
```

The `1/(beta*gamma)^2` scaling is the point: a low-energy beam is enormously
more fragile than a high-energy one, so the injector is what needs protecting.

---

## Engineering / Infrastructure

These are the equations the utility layer actually solves — they are not
flavour text, they set what the beam does.

### Cavity Gradient (superconducting)
```
R_BCS(T) = (2e-4 * f_GHz^2 / T) * exp(-17.67 / T)      ohm
Q0(T)    = G / (R_BCS(T) + R_res)                      R_res = 10 nohm
E_acc    = sqrt(P_rf * (R/Q) * Q0) / L_active          MV/m, per cavity
P_diss   = (E_acc * L_active)^2 / ((R/Q) * Q0)         W, per cavity
```
Calibrated on the TESLA 9-cell (f = 1.3 GHz, R/Q = 1030, G = 270, L = 1.038 m):
Q0 = 7.8e9 and E_acc = 17.7 MV/m at 42 W at 2.0 K; Q0 = 2.2e8 and 3.0 MV/m at
4.2 K. Real TESLA cavities run Q0 ~ 1e10 at 2 K, dissipating 30-50 W at
20 MV/m — the model has no free parameters.

### Cavity Gradient (normal-conducting)
```
E_acc = sqrt(P_peak * r_shunt / L_active)              r_shunt in ohm/m
P_peak = P_average / duty_factor
```
S-band, r = 55 MOhm/m, L = 3 m, P = 30 MW gives 23.5 MV/m. SLAC ran ~20 MV/m
at 35 MW.

### Thermal Detuning (normal-conducting)
```
df       = 20 kHz/K * dT * (f_GHz / 2.856)
coupling = 1 / (1 + (2 * Q_L * df / f)^2)              Q_L = 1e4
P_eff    = P_forward * coupling
reflected = 1 - coupling
VSWR     = (1 + sqrt(reflected)) / (1 - sqrt(reflected))
```

### Cryogenic Bath
```
T_design = 2.0 K with a 2K cold box on the network, else 4.5 K
load(T)  = static_heat + sum over cavities of P_diss(E_acc, T) * n_cav
cap(T)   = min(rated_W * (T / T_design)^1.3, rated_W * 3)
T_next   = clamp(T + (load - cap) / 20000, T_design, 9.25)
```
Quench at T_c = 9.25 K. Wall power: 750 W/W at 2 K, 250 W/W at 4.5 K.

### Cooling
```
quality = min(1, capacity_kW / heatLoad_kW)
dT      = 40 K * (1 - quality)
Q       = m_dot * c_p * dT
```

### Vacuum
```
C_tube = 12.1*d_cm^3/L_cm                   molecular flow, L/s
S_eff = S_pump*C_tube/(S_pump + C_tube)
P_eq = Q_total/S_eff + P_ultimate
P_next = P_eq + (P_previous-P_eq)*exp(-S_eff*dt/V)
Q_pipe = q_specific * 2*pi*r*L,  r = 0.06 m
       = 3.77e-7 mbar.L/s per metre unbaked
q_specific = 1e-10 (unbaked) or 1e-12 (baked) mbar.L/(s.cm^2)
n = (100*P_mbar)/(k_B*300 K)                molecules/m^3
```

### Power
```
quality = min(1, capacity_kW / demand_kW)
focusStrength *= quality                    (linear: k ~ I ~ P)
```

---

## What Is Not Live

`fel_gain` and `beam_beam` are implemented and complete, but they only load for
machine types `fel` and `collider`. Nothing in the game ever sets a machine
type other than `linac`, so **the FEL and beam-beam equations above the
"Engineering" section have never executed in play**. Same for
`bunch_compression`, which is a tier-3 module. They are documented because the
physics is real and the code is there, not because you can currently reach it.
