// src/data/wiki/utility-model.js
//
// What each utility does to the hardware that draws it, and where every source
// sits on its capacity ladder.
//
// Everything numeric here is READ FROM THE LIVE REGISTRIES — the ladders come
// from getUtilityPortsV2, the display names and units from the utility
// descriptors, the thermal constants from cavity-specs. The only hand-written
// content is prose, and it describes the model as the code implements it
// today: RF enters gradient as sqrt(P), cryo holds a design temperature and
// warms under overload, vacuum reaches the beam through beam_gas, and cooling
// only detunes normal-conducting cavities.

import { COMPONENTS } from '../components.js';
import { getUtilityPortsV2 } from '../utility-ports-v2.js';
import { UTILITY_TYPES } from '../../utility/registry.js';
import {
  MAX_DELTA_T,
} from '../../utility/types/coolingWater.js';
import {
  T_SUPERFLUID, T_NORMAL, COLD_CAPACITY_EXPONENT,
} from '../../utility/types/cryoTransfer.js';
import { T_CRITICAL } from '../../beamline/cavity-specs.js';
import { RF_BANDS } from '../../utility/types/rfWaveguide.js';
import { normalizeWaterCircuit } from '../../utility/water-circuits.js';

/** 'lband' → 'L-band'. Reads the live band table so it can never drift. */
function bandLabel(id) {
  return RF_BANDS.find(b => b.id === id)?.label || id;
}

/**
 * Per-utility metadata the wiki needs and the descriptors don't carry:
 * which param names hold capacity and load, and whether an unserved sink is a
 * hard gate. The hard list mirrors UNCONNECTED_CODES in game/utility-gate.js —
 * power, vacuum, RF, cooling and cryo trip the beam; dataFiber never does.
 */
export const UTILITY_META = {
  powerCable: {
    capacityParam: 'capacity', loadParam: 'demand', loadUnit: 'kW',
    hardGate: true, article: 'infra-power',
  },
  vacuumPipe: {
    capacityParam: 'pumpSpeed', loadParam: 'outgassing', loadUnit: 'mbar·L/s',
    hardGate: true, article: 'infra-vacuum',
  },
  rfWaveguide: {
    capacityParam: 'capacity', loadParam: 'demand', loadUnit: 'kW',
    hardGate: true, article: 'infra-rf-power',
  },
  coolingWater: {
    capacityParam: 'capacity', loadParam: 'heatLoad', loadUnit: 'kW',
    hardGate: true, article: 'infra-cooling',
  },
  waterSupplyPipe: {
    capacityParam: 'capacity', loadParam: 'heatLoad', loadUnit: 'kW',
    hardGate: true, article: 'infra-cooling',
  },
  cryoTransfer: {
    capacityParam: 'coldCapacityW', loadParam: 'srfHeatW', loadUnit: 'W',
    hardGate: true, article: 'infra-cryogenics',
  },
  hvCable: {
    capacityParam: 'capacity', loadParam: 'demand', loadUnit: 'kW',
    hardGate: true, article: 'infra-power',
  },
  dataFiber: {
    capacityParam: 'capacity', loadParam: 'demand', loadUnit: 'Gbps',
    hardGate: false, article: 'infra-controls',
  },
};

export const UTILITY_IDS = Object.keys(UTILITY_META);

/** Display name / unit / colour, straight off the solver descriptors. */
export function utilityInfo(utility) {
  const d = UTILITY_TYPES[utility] || {};
  const meta = UTILITY_META[utility] || {};
  return {
    id: utility,
    name: d.displayName || utility,
    color: d.color,
    capacityUnit: d.capacityUnit,
    loadUnit: meta.loadUnit,
    hardGate: !!meta.hardGate,
    costPerSubUnit: d.costPerSubUnit,
    article: meta.article,
  };
}

// ---------------------------------------------------------------------------
// Capacity ladders
// ---------------------------------------------------------------------------

/**
 * Every source of `utility`, ascending by capacity, with its rung number.
 * Derived from the port table, so adding a pump or a klystron puts it on the
 * ladder automatically — the tables in docs/infra-wiki are prose, this is the
 * machine-readable version and it cannot drift.
 */
function buildLadder(utility) {
  const param = UTILITY_META[utility].capacityParam;
  const rungs = [];
  for (const [id, comp] of Object.entries(COMPONENTS)) {
    const ports = Object.values(getUtilityPortsV2(id))
      .filter(port => port.utility === utility && port.role === 'source');
    if (ports.length === 0) continue;
    rungs.push({
      id,
      name: comp.name || id,
      // Multi-port equipment divides its nameplate across physical outlets.
      // The wiki ladder must add those parts back together just like solve().
      capacity: ports.reduce((sum, port) => sum + (port.params[param] ?? 0), 0),
      cost: comp.cost?.funding ?? 0,
      // An RF source is defined by the bands it covers, not by a frequency
      // of its own. Undefined for every other utility.
      bands: ports[0].params.bands,
      dutyFactor: ports[0].params.dutyFactor,
    });
  }
  rungs.sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
  return rungs.map((r, i) => ({ ...r, rung: i + 1, rungs: rungs.length }));
}

export const UTILITY_LADDERS = Object.fromEntries(
  UTILITY_IDS.map(u => [u, buildLadder(u)]),
);

/** This component's rung on its utility's ladder, or null if it is not a source. */
export function ladderPosition(utility, componentId) {
  return UTILITY_LADDERS[utility]?.find(r => r.id === componentId) || null;
}

// ---------------------------------------------------------------------------
// Effect prose
// ---------------------------------------------------------------------------

const fmt = (n, digits = 2) => {
  if (!isFinite(n)) return String(n);
  if (n !== 0 && (Math.abs(n) < 1e-3 || Math.abs(n) >= 1e6)) return n.toExponential(1);
  return String(Number(n.toFixed(digits)));
};

/**
 * One sentence-or-three explaining what this utility does to THIS component.
 *
 * `klass` distinguishes the cases the model actually treats differently:
 * 'srfCavity', 'ncCavity', 'magnet', 'diagnostic', 'source' (a source of the
 * utility, not a particle source) and 'other'.
 */
function sinkEffect(utility, klass, params, comp) {
  switch (utility) {
    case 'hvCable':
      // The one sink on the HV side is a distribution device's feeder inlet.
      return 'Hard gate: this is the feeder inlet of a distribution device. It '
        + 'draws the load currently connected to its downstream sockets, up to '
        + 'its nameplate rating, and with no live feeder '
        + 'behind it the device\'s outlets deliver nothing, which starves every '
        + 'machine plugged into them.';

    case 'powerCable': {
      const base = 'Hard gate: a power network carrying sinks but no source capacity '
        + 'raises power_starved and trips the beam. Above zero, every sink on the '
        + 'network shares one quality = capacity / demand.';
      if (klass === 'magnet') {
        return `${base} Focus strength scales linearly with that quality — coil `
          + 'field goes as supply current, so a magnet on a 70%-served network '
          + 'focuses at 70% of its set gradient.';
      }
      if (klass === 'srfCavity' || klass === 'ncCavity') {
        return `${base} Gradient does not read this quality: a modelled cavity `
          + 'takes its energy gain from delivered RF watts and bath temperature, '
          + 'so power only has to be present.';
      }
      return `${base} Everything without a device model derates linearly on it.`;
    }

    case 'coolingWater': {
      const heat = params.heatLoad;
      if (klass === 'ncCavity') {
        return `Removes ${fmt(heat)} kW. A starved loop runs `
          + `ΔT = ${MAX_DELTA_T} K × (1 − quality) hot, and a warm copper cavity `
          + 'walks off resonance rather than fading: coupling = 1 / (1 + (2·Q_L·Δf/f)²) '
          + 'with Δf ≈ 20 kHz/K scaled by frequency. The power that does not couple '
          + 'in is reflected back at the klystron — that is the VSWR readout.';
      }
      return `Removes ${fmt(heat)} kW. Hard gate only: a cooling network with heat `
        + 'load but no chiller capacity trips the beam. Below that there is no '
        + 'graded response — coolingDegradation is computed in gameplay.py and '
        + 'nothing reads it, and thermal detuning applies to normal-conducting '
        + 'cavities alone.';
    }

    case 'waterSupplyPipe': {
      const waterCircuit = normalizeWaterCircuit(params.waterCircuit);
      const circuit = waterCircuit === 'hot'
        ? 'hot return'
        : waterCircuit === 'lukewarm'
          ? 'lukewarm transfer'
          : 'cold supply';
      return `Rigid ${circuit} header carrying ${fmt(params.heatLoad)} kW for high-flow equipment. `
        + 'Cold, lukewarm, and hot circuits are solved independently and must never be joined.';
    }

    case 'cryoTransfer': {
      return `Static heat load ${fmt(params.srfHeatW)} W. The bath holds its plant's `
        + `design temperature — ${T_SUPERFLUID} K with a 2 K Cryogenic Supply on the network, `
        + `otherwise ${T_NORMAL} K — for as long as capacity covers load. Overload `
        + 'warms it, Q₀ collapses as it warms, and the extra dissipation warms it '
        + `faster still; at ${T_CRITICAL} K the cavity quenches and the element `
        + 'becomes a drift. Backing the gradient off pulls the bath back down. '
        + `Plant output scales as (T / T_design)^${COLD_CAPACITY_EXPONENT}, which is `
        + 'why 4.5 K operation is cheap and 2 K is not.';
    }

    case 'rfWaveguide': {
      const f = params.frequency ? `${fmt(params.frequency / 1e6, 1)} MHz` : 'its band';
      const bandName = params.band ? bandLabel(params.band) : 'its band';
      const cav = (klass === 'srfCavity' || klass === 'ncCavity');
      const head = `Draws ${fmt(params.demand)} kW at ${f}. Any source covering `
        + `${bandName} can drive it — but a network carries one frequency, the one `
        + 'with the most demand on it, and everything else on that network is '
        + 'starved until you run it a second waveguide. A served frequency with no '
        + 'in-band source anywhere on its network delivers zero watts.';
      if (!cav) return head;
      return `${head} Delivered power is peak, not average — average ÷ duty factor — `
        + 'and gradient goes as sqrt(P), so doubling RF power buys 41% more '
        + 'gradient and a pulsed source at 0.1% duty buys a factor of ~32.';
    }

    case 'vacuumPipe': {
      const q = params.outgassing;
      const drawn = comp?.isDrawnConnection;
      const head = `Gas load ${fmt(q)} mbar·L/s. Network pressure is P = Q / S over `
        + 'every pump on it; quality falls log-linearly from 1e-8 mbar (perfect) '
        + 'to 1e-4 mbar (unusable).';
      const tail = ' Pressure is published per sink and reaches the beam through '
        + 'beam_gas: multiple Coulomb scattering grows emittance as 1/(βγ)², so a '
        + 'low-energy injector is far more fragile than the far end of a linac, '
        + 'and large-angle scattering removes current as exp(−L/λ). Sinks with no '
        + 'pump anywhere on the network is a hard gate.';
      if (drawn) {
        return `${head}${tail} Beam pipe is charged by surface area rather than by `
          + 'a port — the vacuum solver reads state.beamPipes directly, so every '
          + 'metre you draw adds load.';
      }
      return head + tail;
    }

    case 'dataFiber':
      return `Wants ${fmt(params.demand)} Gbps. Soft only: connectivity is binary, so `
        + 'one source anywhere on the network serves every sink on it. An orphaned '
        + 'data sink raises data_disconnected and costs science income, but never '
        + 'trips the beam.';

    default:
      return '';
  }
}

function sourceEffect(utility, params, componentId) {
  const info = utilityInfo(utility);
  const pos = ladderPosition(utility, componentId);
  const cap = params[UTILITY_META[utility].capacityParam] ?? 0;
  const rung = pos ? ` Rung ${pos.rung} of ${pos.rungs} on the ${info.name} ladder.` : '';

  switch (utility) {
    case 'coolingWater': {
      const ports = Object.values(getUtilityPortsV2(componentId))
        .filter(port => port.utility === utility && port.role === 'source');
      const supply = ports.reduce(
        (sum, port) => sum + (port.params.supplyRateLPerTick || 0), 0);
      const storage = ports.reduce(
        (sum, port) => sum + (port.params.storageCapacityL || 0), 0);
      if (supply > 0 || storage > 0) {
        const roles = [];
        if (supply > 0) roles.push(`supplies ${fmt(supply)} L/tick of make-up water`);
        if (storage > 0) roles.push(`stores ${fmt(storage)} L`);
        const separation = supply > 0 && storage > 0
          ? ' Flow and storage are independent network capabilities.'
          : supply > 0
            ? ' It provides no storage, so the network still needs a tank.'
            : ' It is passive storage and never generates water.';
        return `${roles.join(' and ')}.${separation}`;
      }
      return `Supplies ${fmt(cap)} ${info.capacityUnit} of process cooling. `
        + 'Thermal capacity, make-up flow and stored inventory are separate.' + rung;
    }
    case 'rfWaveguide': {
      const duty = params.dutyFactor ?? 1;
      const covered = params.bands || [];
      const band = covered.length
        ? `Covers ${covered.map(bandLabel).join(', ')}: it drives any cavity whose `
          + 'frequency falls in one of those bands, and nothing outside them. Its '
          + 'capacity only counts on a network whose served frequency it covers.'
        : 'Declares no band coverage, so it drives nothing.';
      const peak = duty < 1
        ? ` Pulsed at ${fmt(duty * 100, 3)}% duty, so ${fmt(cap)} kW average is `
          + `${fmt(cap / duty / 1000)} MW peak — peak power is what sets gradient.`
        : ' Continuous wave: average power is peak power, which buys average '
          + 'current rather than peak gradient.';
      return `Supplies ${fmt(cap)} kW. ${band}${peak}${rung}`;
    }
    case 'cryoTransfer':
      return `Removes ${fmt(cap)} W at its design temperature, and more than that if `
        + `run warm ((T/T_design)^${COLD_CAPACITY_EXPONENT}, capped at 3×). A 2K plant `
        + 'buys ~35× the Q₀ of a 4.5 K one at roughly 3× the wall power.' + rung;
    case 'vacuumPipe':
      return `Pumps ${fmt(cap)} L/s. Pump speeds add across the network, and pressure `
        + `is total gas load over that sum.${rung}`;
    default:
      return `Supplies ${fmt(cap)} ${info.capacityUnit} to every sink reachable on `
        + `this network. Capacity is per network, not per facility — two sources with `
        + `no line between them are two independent budgets.${rung}`;
  }
}

function busEffect(utility, params) {
  const cells = params.serviceRadius ?? 0;
  const info = utilityInfo(utility);
  return `Distribution bus. Serves any ${info.name} sink within ${cells} grid cells `
    + `(${cells * 2} m) with no drawn line, and adds no capacity of its own — it `
    + `changes how much pipe you lay, not how much the network can carry. At `
    + `$${info.costPerSubUnit}/sub-unit for individual runs it pays for itself at `
    + 'roughly four to six sinks.';
}

/** `utilities` row for one component/utility pair. */
export function utilityRow(componentId, utility, role, params, klass) {
  const comp = COMPONENTS[componentId];
  let effect;
  if (role === 'source') effect = sourceEffect(utility, params, componentId);
  else if (role === 'pass') effect = busEffect(utility, params);
  else effect = sinkEffect(utility, klass, params, comp);
  return { utility, role, params, effect };
}
