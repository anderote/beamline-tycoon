// control-room-model.js — display-only operational snapshot for the Control Room.
//
// The model joins values their owning systems have already published. It does
// not recalculate revenue, beam physics, utility quality, or staffing coverage.

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function lineStatus(entry, infraCanRun) {
  if (entry?.status === 'running' && infraCanRun === false) return 'held';
  if (entry?.status === 'running') return 'running';
  if (entry?.status === 'faulted') return 'faulted';
  return 'stopped';
}

/** Build a facility operations read model exclusively from published state. */
export function buildControlRoomModel(game) {
  const state = game?.state || {};
  const entries = game?.registry?.getAll?.() || [];
  const economy = game?.getEconomySnapshot?.().snapshot ?? state.economySnapshot ?? null;
  const members = state.staffMembers || [];
  const blockers = (state.infraBlockers || []).map(blocker => ({
    code: blocker?.code || 'facility_fault',
    message: blocker?.message || blocker?.reason || 'Facility fault',
  }));

  const beamlines = entries.map(entry => {
    const beam = entry.beamState || {};
    return {
      id: entry.id,
      name: entry.name || entry.id,
      accentColor: entry.accentColor || '#5b86c8',
      status: lineStatus(entry, state.infraCanRun),
      beamQuality: finite(beam.beamQuality),
      totalLossFraction: finite(beam.totalLossFraction),
      beamEnergy: finite(beam.beamEnergy),
      beamCurrent: finite(beam.beamCurrent),
      effectiveDataRate: finite(beam.effectiveDataRate),
      uptimeFraction: finite(beam.uptimeFraction, 1),
      totalLength: finite(beam.totalLength),
      serviceRevenue: finite(beam.serviceRevenue),
      serviceContract: beam.serviceContract || null,
      dataWorkload: beam.dataWorkload || null,
      rawDataStored: finite(beam.rawDataStored),
      rawDataDropped: finite(beam.rawDataDropped),
    };
  });

  const runningCount = beamlines.filter(line => line.status === 'running').length;
  const heldCount = beamlines.filter(line => line.status === 'held').length;
  const onTaskCount = members.filter(member => member?.job != null).length;
  const attentionCount = members.filter(member =>
    member?.mood === 'stressed' || member?.mood === 'tired' || member?.unservicedPenalty,
  ).length;

  let status = 'NO LINES';
  if (blockers.length > 0) status = 'FACILITY FAULT';
  else if (runningCount > 0) status = 'BEAM LIVE';
  else if (beamlines.length > 0) status = 'STANDBY';

  return {
    tick: finite(state.tick),
    status,
    infraCanRun: state.infraCanRun !== false,
    blockers,
    beamlines,
    runningCount,
    heldCount,
    uptimeFraction: finite(state.uptimeFraction, 1),
    funding: finite(state.resources?.funding),
    economy: economy ? {
      totalIncome: finite(economy.income?.total),
      beamIncome: finite(economy.income?.beam),
      dataFees: finite(economy.income?.dataFees),
      totalUpkeep: finite(economy.upkeep?.total),
      net: finite(economy.net),
    } : null,
    staff: {
      total: members.length,
      onTask: onTaskCount,
      idle: members.length - onTaskCount,
      attention: attentionCount,
    },
  };
}

/** Convert a numeric sample window into SVG polyline points. */
export function sparklinePoints(values, width, height, { min = null, max = null } = {}) {
  const samples = (values || []).map(value => finite(value));
  if (samples.length === 0 || !(width > 0) || !(height > 0)) return '';

  let lo = Number.isFinite(min) ? min : Math.min(...samples);
  let hi = Number.isFinite(max) ? max : Math.max(...samples);
  if (hi <= lo) {
    const pad = Math.max(1, Math.abs(lo) * 0.05);
    lo -= pad;
    hi += pad;
  }

  return samples.map((value, index) => {
    const x = samples.length === 1 ? width : index * width / (samples.length - 1);
    const clamped = Math.max(lo, Math.min(hi, value));
    const y = height - ((clamped - lo) / (hi - lo)) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
