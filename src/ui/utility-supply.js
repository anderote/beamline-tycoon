// src/ui/utility-supply.js
//
// Shared, pure derivation of the "what does this component draw / supply"
// stat rows shown in every component-info panel (hud.js build-preview,
// overlays.js component + facility popups, EquipmentWindow.js). Before this
// existed, all four sites unconditionally printed `Energy Cost: {energyCost}
// kW`, which is fine for a load but noise for a zero-draw component and
// silent about the one interesting fact pure distribution gear has: what it
// supplies. hvTransformer / switchgear / padMountTransformer / powerPanel
// all draw 0 kW and were reporting exactly that number.
//
// Draw and supply are NOT mutually exclusive: several components genuinely
// do both (ups draws 2 kW and supplies 100 kW; chiller draws 5 kW and
// supplies 300 kW of cooling; mcc draws 1 kW and supplies 250 kW), so this
// returns independent rows for each, included only when the underlying
// number is real (present and non-zero). Only the pure passive gear has zero
// draw; hiding a genuine draw would be a regression.
//
// Supply is read off the component's own SOURCE ports — the same ports
// COMPONENTS[id].ports exposes after the merge in src/data/components.js,
// sourced from src/data/utility-ports-v2.js. This generalises across all
// five utilities rather than special-casing power.

const DRAW_LABEL = 'Energy Cost';
const SUPPLY_LABEL = 'Supplies';

// Per-utility: which params.* key on a `role: 'source'` port holds its
// capacity, and the unit to display it in. coolingWater capacity is thermal
// kW, not electrical kW, hence the qualifier; cryoTransfer's cold capacity is
// watts, not kilowatts (see utility-ports-v2.js param names).
const SUPPLY_SPEC = {
  powerCable:   { param: 'capacity',      unit: 'kW' },
  hvCable:      { param: 'capacity',      unit: 'kW' },
  rfWaveguide:  { param: 'capacity',      unit: 'kW' },
  coolingWater: { param: 'capacity',      unit: 'kW thermal' },
  cryoTransfer: { param: 'coldCapacityW', unit: 'W' },
  vacuumPipe:   { param: 'pumpSpeed',     unit: 'L/s' },
};

// 0.001 -> "0.1%", 0.005 -> "0.5%", 0.05 -> "5%", 1 -> "100%".
function fmtDutyPercent(dutyFactor) {
  const pct = Math.round(dutyFactor * 1000) / 10;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct}%`;
}

/**
 * Draw + supply stat rows for a component's info panel.
 *
 * @param {{ energyCost?: number, ports?: object }} comp - a COMPONENTS[id]
 *   entry (or anything with the same shape: an `energyCost` number and a
 *   `ports` map of { utility, role, params }).
 * @returns {Array<{ label: string, value: string }>} in display order: the
 *   draw row (if the draw is real), then one row per utility the component
 *   sources — its outlets' capacities summed, the way discovery unites them.
 */
export function utilityStatRows(comp) {
  const rows = [];

  if (comp && comp.energyCost) {
    rows.push({ label: DRAW_LABEL, value: `${comp.energyCost} kW` });
  }

  // One row per utility, not per port. A device's outlets each declare
  // capacity/N — discovery unites them into one busbar, so they add back up to
  // the device's actual rating (see supplyPorts / distributionPorts in
  // utility-ports-v2.js). Printing them individually turned an 8-way MCC into
  // eight identical "31.25 kW" rows instead of one "250 kW".
  const totals = new Map();
  for (const port of Object.values((comp && comp.ports) || {})) {
    if (!port || port.role !== 'source') continue;
    const spec = SUPPLY_SPEC[port.utility];
    if (!spec) continue;
    const amount = port.params ? port.params[spec.param] : undefined;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) continue;

    const entry = totals.get(port.utility)
      ?? { utility: port.utility, spec, amount: 0, dutyFactor: undefined };
    entry.amount += amount;
    // Every source port of one device shares its duty cycle; take the first
    // that declares one.
    if (entry.dutyFactor === undefined && typeof port.params?.dutyFactor === 'number') {
      entry.dutyFactor = port.params.dutyFactor;
    }
    totals.set(port.utility, entry);
  }

  for (const { utility, spec, amount, dutyFactor } of totals.values()) {
    // Skip zero — e.g. bakeoutSystem's pumpSpeed:0 marker port, which exists
    // only so the vacuum solver can detect the component, not because it
    // supplies any real pumping.
    if (!amount) continue;
    // capacity/N can land on a repeating fraction; the sum is the round number.
    const shown = Math.round(amount * 1e6) / 1e6;
    let value = `${shown} ${spec.unit}`;
    if (utility === 'rfWaveguide' && typeof dutyFactor === 'number') {
      value += ` peak (${fmtDutyPercent(dutyFactor)} duty)`;
    }
    rows.push({ label: SUPPLY_LABEL, value });
  }

  return rows;
}
