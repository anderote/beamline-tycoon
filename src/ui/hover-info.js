// Compact, shared summaries for world hover tooltips and beamline RF readouts.
// Every hover result is exactly two logical lines: a title and one detail.

import { RF_BANDS, bandForFrequencyHz } from '../utility/types/rfWaveguide.js';

const RF_LABELS = Object.fromEntries(RF_BANDS.map(b => [b.id, b.label]));

function sumPorts(ports, utilityTypes, role, param) {
  const wanted = new Set(utilityTypes);
  return ports
    .filter(p => p && wanted.has(p.utility) && p.role === role)
    .reduce((sum, p) => sum + (Number(p.params?.[param]) || 0), 0);
}

function fmtNumber(value) {
  if (!Number.isFinite(value)) return '--';
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

function humanize(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, c => c.toUpperCase());
}

export function formatRfFrequencyHz(hz) {
  const mhz = hz / 1e6;
  const rounded = Math.round(mhz * 10) / 10;
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded.toFixed(1)} MHz`;
}

function rfSink(ports) {
  return ports.find(p => p?.utility === 'rfWaveguide' && p.role === 'sink'
    && (p.params?.frequency > 0 || p.params?.band));
}

/** The first accelerating RF element fixes the beam's bunch frequency. */
export function beamlineRfOperatingInfo(nodes, components) {
  for (const node of nodes || []) {
    const comp = components?.[node.type];
    if (!comp || (comp.physicsType !== 'rfCavity' && comp.physicsType !== 'cryomodule')) continue;
    const sink = rfSink(Object.values(comp.ports || {}));
    const frequencyHz = sink?.params?.frequency > 0
      ? sink.params.frequency
      : (comp.rfFrequency > 0 ? comp.rfFrequency * 1e6 : 0);
    const bandId = sink?.params?.band || comp.rfBand || bandForFrequencyHz(frequencyHz);
    if (!bandId && !(frequencyHz > 0)) continue;
    const bandLabel = RF_LABELS[bandId] || humanize(bandId) || 'RF';
    return {
      bandId: bandId || null,
      bandLabel,
      frequencyHz,
      display: frequencyHz > 0
        ? `${bandLabel} · ${formatRfFrequencyHz(frequencyHz)}`
        : bandLabel,
    };
  }
  return null;
}

/** Summarize a component definition into one title line and one detail line. */
export function componentHoverInfo(comp, { autoConnectPlan = null } = {}) {
  if (!comp) return null;
  const ports = Object.values(comp.ports || {});
  const title = comp.name || humanize(comp.id) || 'Object';

  if (Number(comp.autoConnectRadius) > 0 && autoConnectPlan) {
    const candidates = Math.max(0, Number(autoConnectPlan.candidates) || 0);
    const connectable = Array.isArray(autoConnectPlan.stubs)
      ? autoConnectPlan.stubs.length
      : Math.max(0, Number(autoConnectPlan.connectable) || 0);
    return {
      title,
      detail: `${candidates} unconnected power plug${candidates === 1 ? '' : 's'} in range`
        + ` · Tab connects ${connectable}`,
    };
  }

  const powerOut = sumPorts(ports, ['powerCable', 'hvCable'], 'source', 'capacity');
  const powerIn = sumPorts(ports, ['powerCable', 'hvCable'], 'sink', 'demand');
  if (powerOut > 0) {
    const consumed = powerIn > 0 ? powerIn : (Number(comp.energyCost) || 0);
    return {
      title,
      detail: `Power: ${fmtNumber(consumed)} kW consumed · ${fmtNumber(powerOut)} kW produced`,
    };
  }

  const sink = rfSink(ports);
  if (sink) {
    const hz = Number(sink.params?.frequency) || 0;
    const band = sink.params?.band || comp.rfBand || bandForFrequencyHz(hz);
    const parts = [RF_LABELS[band] || humanize(band) || 'RF'];
    if (hz > 0) parts.push(formatRfFrequencyHz(hz));
    const demand = Number(sink.params?.demand) || Number(comp.rfPowerRequired) || 0;
    if (demand > 0) parts.push(`${fmtNumber(demand)} kW demand`);
    return { title, detail: `RF: ${parts.join(' · ')}` };
  }

  const rfOut = sumPorts(ports, ['rfWaveguide'], 'source', 'capacity');
  if (rfOut > 0) {
    const bands = (comp.rfBands || (comp.rfBand ? [comp.rfBand] : []))
      .map(b => RF_LABELS[b] || humanize(b)).join(', ');
    return { title, detail: `RF output: ${fmtNumber(rfOut)} kW${bands ? ` · ${bands}` : ''}` };
  }

  const coolingOut = sumPorts(ports, ['coolingWater'], 'source', 'capacity');
  if (coolingOut > 0) {
    return { title, detail: `Cooling output: ${fmtNumber(coolingOut)} kW` };
  }

  const waterSupply = sumPorts(
    ports, ['coolingWater'], 'source', 'supplyRateLPerTick');
  const waterStorage = sumPorts(
    ports, ['coolingWater'], 'source', 'storageCapacityL');
  if (waterSupply > 0 || waterStorage > 0) {
    const parts = [];
    if (waterSupply > 0) parts.push(`${fmtNumber(waterSupply)} L/tick supply`);
    if (waterStorage > 0) parts.push(`${fmtNumber(waterStorage)} L storage`);
    return { title, detail: `Water: ${parts.join(' · ')}` };
  }

  const sourceSpecs = [
    ['cryoTransfer', 'coldCapacityW', 'Cryo output', 'W'],
    ['vacuumPipe', 'pumpSpeed', 'Pumping speed', 'L/s'],
    ['dataFiber', 'capacity', 'Data output', 'Gbps'],
  ];
  for (const [utility, param, label, unit] of sourceSpecs) {
    const value = sumPorts(ports, [utility], 'source', param);
    if (value > 0) return { title, detail: `${label}: ${fmtNumber(value)} ${unit}` };
  }

  if (Number(comp.energyCost) > 0) {
    return { title, detail: `Power use: ${fmtNumber(comp.energyCost)} kW` };
  }
  if (Number(comp.stats?.beamCurrent) > 0) {
    return { title, detail: `Beam current: ${fmtNumber(comp.stats.beamCurrent)} mA` };
  }
  return { title, detail: humanize(comp.category || comp.kind || 'Placed object') };
}

export function furnishingHoverInfo(def) {
  if (!def) return null;
  const effects = Object.entries(def.effects || {})
    .filter(([, value]) => value !== 0)
    .slice(0, 2)
    .map(([key, value]) => {
      const shown = typeof value === 'number' && Math.abs(value) < 1
        ? `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`
        : `${value > 0 ? '+' : ''}${value}`;
      return `${humanize(key)} ${shown}`;
    });
  return {
    title: def.name || humanize(def.id) || 'Furnishing',
    detail: effects.length ? effects.join(' · ') : humanize(def.category || 'Furnishing'),
  };
}

export function utilityNetworkHoverInfo(descriptor, flow) {
  const title = `${descriptor?.displayName || 'Utility'} Network`;
  if (!flow) return { title, detail: 'Awaiting network data' };
  const capacity = Number(flow.totalCapacity) || 0;
  const demand = Number(flow.totalDemand) || 0;
  const unit = descriptor?.capacityUnit || '';
  const suffix = unit ? ` ${unit}` : '';
  const supplyText = `Supply: ${fmtNumber(capacity)}${suffix}`;
  const demandText = `Demand: ${fmtNumber(demand)}${suffix}`;

  // Exact coverage is healthy. Once demand exceeds supply, move from orange
  // to red when less than half of the requested load can be served.
  const coverage = demand > 0 ? capacity / demand : 1;
  const demandTone = capacity >= demand
    ? 'healthy'
    : (coverage >= 0.5 ? 'warning' : 'critical');

  return {
    title,
    detail: `${supplyText} · ${demandText}`,
    detailSegments: [
      { text: supplyText, tone: 'supply' },
      { text: ' · ' },
      { text: demandText, tone: demandTone },
    ],
  };
}
