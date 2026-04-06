# Infrastructure Glossary

## Quick Tip
Accelerator jargon decoded — from conductance to VSWR.

## Terms

**Bakeout** — Heating vacuum chambers to 150-250 C to drive adsorbed gas molecules off the walls. Required to achieve ultra-high vacuum. Must be done after any vacuum break (opening the system to air).

**Carnot penalty** — The thermodynamic cost of removing heat at cryogenic temperatures. Removing 1 watt at 4K costs ~250 watts of electrical power. At 2K, it costs ~750 watts. This is why cryo plants are power-hungry.

**Cold box** — A refrigeration unit that cools helium gas to cryogenic temperatures (4.5K or 2K). Contains heat exchangers, expansion turbines, and JT valves. The core of any helium cryogenic system.

**Conductance** — A measure of how easily gas flows through a tube or opening, measured in liters per second (L/s). Higher conductance means more gas flow for a given pressure difference. Short, wide tubes have high conductance; long, narrow tubes have low conductance.

**CW (Continuous Wave)** — RF operation where the source runs continuously, as opposed to pulsed operation. SRF cavities typically run CW. CW sources (CW klystron, IOT) provide constant power.

**Deionized water** — Water with dissolved ions removed, giving it high electrical resistivity (>1 MOhm-cm). Used in cooling circuits to prevent electrical leakage between components at different voltages and to reduce corrosion.

**EPICS** — Experimental Physics and Industrial Control System. The standard software framework for accelerator control systems worldwide. Runs on IOCs (Input/Output Controllers) in electronics racks.

**Forward power** — RF power flowing from the source toward the cavity. This is the useful power that accelerates the beam. Measured in watts, kilowatts, or megawatts.

**IOC** — Input/Output Controller. A computer in an electronics rack that runs EPICS control software and interfaces with beamline hardware via data/fiber connections.

**IOT (Inductive Output Tube)** — A type of RF source with high efficiency (~70%) for CW operation. Preferred for large SRF installations where electricity costs dominate.

**Klystron** — A high-power vacuum tube that amplifies RF signals. The workhorse RF source in particle accelerators since the 1950s. Pulsed klystrons need a modulator for high-voltage pulses.

**LCW (Low Conductivity Water)** — Deionized cooling water distributed to beamline components. The "LCW skid" is the pump and distribution manifold.

**LN2** — Liquid nitrogen, boiling point 77K (-196 C). The cheapest cryogen, used for pre-cooling, cold traps, and thermal shields.

**Modulator** — A high-voltage pulse generator that provides the multi-kilovolt pulses needed to operate pulsed klystrons. Each pulsed klystron needs one modulator.

**MPS (Machine Protection System)** — A hardwired interlock system that monitors beam loss monitors, magnet currents, vacuum pressure, and other critical parameters. Dumps the beam within microseconds if anything exceeds safe limits.

**NEG (Non-Evaporable Getter)** — A reactive metal coating inside beam pipes that traps gas molecules on contact. Provides distributed pumping with zero energy cost.

**Outgassing** — The release of gas molecules from chamber walls into the vacuum. The main source of residual gas in ultra-high vacuum systems. Reduced by bakeout and clean assembly practices.

**PPS (Personnel Protection System)** — Safety interlocks that prevent beam operation when personnel could be in radiation areas. Monitors access doors, search buttons, and key switches. Mandatory for any beam operation.

**Pulsed operation** — RF operation where the source fires in short bursts (microseconds) at a repetition rate. Normal-conducting cavities typically run pulsed because continuous operation would require too much cooling.

**Reflected power** — RF power bouncing back from the cavity toward the source due to impedance mismatch. Circulators divert reflected power into a water load to protect the source.

**Roughing pump** — A mechanical pump (rotary vane, scroll, or diaphragm) that brings vacuum systems from atmospheric pressure to rough vacuum (~1 mbar). Always the first pump in the chain.

**Shunt impedance** — A measure of how efficiently an RF cavity converts power into accelerating voltage. Higher shunt impedance means more acceleration per watt of RF power.

**SRF (Superconducting RF)** — RF cavities made from superconducting niobium. Must be cooled to 2-4.5K but have extremely low surface resistance, allowing CW operation with minimal power loss.

**SSA (Solid State Amplifier)** — RF source built from semiconductor transistors. Lower peak power than klystrons but very reliable (redundant modules). Broadband — can drive any frequency cavity.

**Superfluid helium** — Helium below 2.17K enters the superfluid state with zero viscosity and extraordinary thermal conductivity. Used for cooling SRF cavities to achieve the highest Q-factors.

**Turbo pump (turbomolecular pump)** — A high-speed pump with spinning blades (up to 80,000 RPM) that achieves high vacuum (10^-8 mbar). The workhorse pump for most accelerator vacuum systems.

**UHV (Ultra-High Vacuum)** — Pressure below 10^-9 mbar. Required for long beam lifetime in storage rings and for clean SRF cavity operation.

**VSWR (Voltage Standing Wave Ratio)** — A measure of impedance mismatch in the RF waveguide system. VSWR of 1.0 means perfect match (no reflection). Higher values mean more reflected power.

**Waveguide** — A hollow metal tube (usually rectangular) that carries RF power from the source to the cavity. The cross-section dimensions determine which frequencies can propagate.
