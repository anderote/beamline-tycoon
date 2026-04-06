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

## Engineering / Infrastructure

### RF Power
```
P_cavity = V_acc^2 / (R/Q * Q_L)
P_beam = I_beam * V_acc * cos(phi)
P_wall = P_forward / eta_klystron
```

### Cryogenics
```
P_dynamic = V_acc^2 / (R/Q * Q0)
COP = T_cold / (T_hot - T_cold) * eta_Carnot
P_wall_cryo = Q_cold / COP
```

### Cooling
```
Q = m_dot * c_p * dT
```

### Vacuum
```
P = Q_gas / S_eff
S_eff = S_pump * C / (S_pump + C)
C_tube = 12.1 * d^3 / L  (molecular flow, d and L in cm)
```
