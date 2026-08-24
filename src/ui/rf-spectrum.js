// Discrete RF spectrum presentation for UtilityInspector.
//
// All physical quantities come from rfWaveguide.solve(). This module only
// formats those published values and maps them to screen-space bar heights.

import { RF_BANDS } from '../data/rf-bands.js';
import { escapeHtml } from './format.js';

const BAND_LABELS = Object.fromEntries(RF_BANDS.map(band => [band.id, band.label]));

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function formatRfSpectrumFrequency(frequencyHz) {
  if (!(frequencyHz > 0)) return 'Untuned';
  const mhz = frequencyHz / 1e6;
  const rounded = Math.round(mhz * 10) / 10;
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded.toFixed(1)} MHz`;
}

export function formatRfSpectrumPower(powerW) {
  const watts = Math.max(0, finite(powerW));
  if (watts >= 1e9) return `${(watts / 1e9).toFixed(watts >= 10e9 ? 0 : 1)} GW`;
  if (watts >= 1e6) return `${(watts / 1e6).toFixed(watts >= 10e6 ? 0 : 1)} MW`;
  if (watts >= 1e3) return `${(watts / 1e3).toFixed(watts >= 10e3 ? 0 : 1)} kW`;
  return `${watts.toFixed(watts >= 10 ? 0 : 1)} W`;
}

function formatAveragePower(powerKw) {
  const kw = Math.max(0, finite(powerKw));
  if (kw >= 1000) return `${(kw / 1000).toFixed(kw >= 10000 ? 0 : 1)} MW`;
  return `${kw.toFixed(kw >= 10 ? 0 : 1)} kW`;
}

function bandLabel(bandId) {
  return BAND_LABELS[bandId] || bandId || 'Unbanded';
}

function dutyLabel(meanDuty) {
  const duty = Math.max(0, Math.min(1, finite(meanDuty, 1)));
  if (duty >= 0.9995) return 'CW';
  const pct = duty * 100;
  return `${pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)}% duty`;
}

function binAriaLabel(bin) {
  const status = bin.status === 'carried' ? 'carried' : 'rejected';
  const quality = typeof bin.quality === 'number'
    ? `, ${Math.round(bin.quality * 100)} percent delivered`
    : '';
  return `${formatRfSpectrumFrequency(bin.frequencyHz)}, ${status}, `
    + `${formatRfSpectrumPower(bin.deliveredPeakPowerW)} peak forward power${quality}`;
}

export function renderRfNyquist(flow) {
  if (!flow) {
    return `<figure class="rf-nyquist-panel utility-instrument-panel">
      <figcaption><span><strong>NYQUIST / REFLECTION PLANE</strong><small>Complex reflection coefficient Γ</small></span></figcaption>
      <div class="ui-empty-state">Reflection data is not available yet.</div>
    </figure>`;
  }
  const reflectionFraction = Math.max(0, Math.min(1,
    finite(flow?.branchReflectionFraction ?? flow?.rfSpectrum?.reflectionFraction)));
  const gamma = Math.sqrt(reflectionFraction);
  const vswr = Math.max(1, finite(flow?.vswr ?? flow?.rfSpectrum?.vswr, 1));
  const width = 320;
  const height = 220;
  const cx = 160;
  const cy = 106;
  const radius = 82;
  const markerX = cx + gamma * radius;

  return `<figure class="rf-nyquist-panel utility-instrument-panel">
    <figcaption>
      <span><strong>NYQUIST / REFLECTION PLANE</strong><small>Complex reflection coefficient Γ</small></span>
      <em>|Γ| ${gamma.toFixed(3)} · VSWR ${vswr.toFixed(2)}:1</em>
    </figcaption>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="RF reflection coefficient magnitude ${gamma.toFixed(3)} on a Nyquist plane">
      <line class="rf-nyquist-grid" x1="${cx - radius - 16}" y1="${cy}" x2="${cx + radius + 16}" y2="${cy}"/>
      <line class="rf-nyquist-grid" x1="${cx}" y1="${cy - radius - 16}" x2="${cx}" y2="${cy + radius + 16}"/>
      <circle class="rf-nyquist-unit" cx="${cx}" cy="${cy}" r="${radius}"/>
      <circle class="rf-nyquist-guide" cx="${cx}" cy="${cy}" r="${radius / 2}"/>
      <line class="rf-nyquist-vector" x1="${cx}" y1="${cy}" x2="${markerX.toFixed(2)}" y2="${cy}"/>
      <circle class="rf-nyquist-marker" cx="${markerX.toFixed(2)}" cy="${cy}" r="5"/>
      <text x="${cx + radius + 7}" y="${cy - 5}">+Re</text>
      <text x="${cx + 5}" y="${cy - radius - 6}">+Im</text>
      <text x="${cx + 5}" y="${cy + 15}">0</text>
      <text x="${cx + radius - 4}" y="${cy + 15}">1</text>
    </svg>
    <p>Reflection phase is not modeled; the live marker places solver-published |Γ| on the reference axis.</p>
  </figure>`;
}

export function renderRfSpectrum(flow) {
  const spectrum = flow?.rfSpectrum;
  if (!spectrum || !Array.isArray(spectrum.bins)) {
    return `<div class="rf-spectrum-panel">
      <div class="rf-spectrum-heading">RF POWER SPECTRUM</div>
      <div class="ui-empty-state">Spectrum data is not available yet.</div>
    </div>`;
  }

  const bins = spectrum.bins;
  const carrier = spectrum.carrierFrequencyHz == null
    ? 'No carrier'
    : formatRfSpectrumFrequency(spectrum.carrierFrequencyHz);
  const carrierBand = spectrum.carrierBand ? bandLabel(spectrum.carrierBand) : '--';
  const peakForward = formatRfSpectrumPower(spectrum.forwardPeakPowerW);
  const reflected = formatAveragePower(spectrum.reflectedAveragePowerKw);
  const vswr = Math.max(1, finite(spectrum.vswr, 1)).toFixed(2);

  let html = `<div class="rf-spectrum-panel">
    <div class="rf-spectrum-heading-row">
      <div>
        <div class="rf-spectrum-heading">RF POWER SPECTRUM</div>
        <div class="rf-spectrum-subheading">Discrete network carriers · peak forward power</div>
      </div>
      <span class="rf-spectrum-live">LIVE</span>
    </div>
    <div class="rf-spectrum-summary">
      <div><span>Carrier</span><strong>${escapeHtml(carrier)}</strong></div>
      <div><span>Band</span><strong>${escapeHtml(carrierBand)}</strong></div>
      <div><span>Mode</span><strong>${escapeHtml(dutyLabel(spectrum.meanDuty))}</strong></div>
      <div><span>Peak fwd</span><strong>${escapeHtml(peakForward)}</strong></div>
      <div><span>Reflected avg</span><strong>${escapeHtml(reflected)}</strong></div>
      <div><span>VSWR</span><strong>${escapeHtml(vswr)}:1</strong></div>
    </div>`;

  if (bins.length === 0) {
    html += `<div class="rf-spectrum-empty">
      No tuned RF loads are connected to this network.
    </div></div>`;
    return html;
  }

  const maxPowerW = Math.max(1, ...bins.map(bin => Math.max(0, finite(bin.deliveredPeakPowerW))));
  html += `<div class="rf-spectrum-chart" role="img" aria-label="RF network frequency and peak forward power spectrum">
    <div class="rf-spectrum-y-label">PEAK POWER</div>
    <div class="rf-spectrum-bins" style="--rf-spectrum-bin-count:${bins.length}">`;

  for (const bin of bins) {
    const powerW = Math.max(0, finite(bin.deliveredPeakPowerW));
    const carried = bin.status === 'carried';
    const active = carried && powerW > 0;
    const height = active ? Math.max(6, (powerW / maxPowerW) * 100) : 4;
    const statusLabel = carried ? (active ? 'CARRIED' : 'NO POWER') : 'REJECTED';
    const qualityLabel = typeof bin.quality === 'number'
      ? `${Math.round(bin.quality * 100)}% delivered`
      : '--';
    const binBand = bandLabel(bin.band);
    const loadLabel = `${Math.max(0, finite(bin.demandAveragePowerKw)).toFixed(1)} kW avg demand`;
    html += `<div class="rf-spectrum-bin ${carried ? 'is-carried' : 'is-rejected'}${active ? ' is-active' : ''}"
        aria-label="${escapeHtml(binAriaLabel(bin))}">
      <div class="rf-spectrum-power">${escapeHtml(active ? formatRfSpectrumPower(powerW) : statusLabel)}</div>
      <div class="rf-spectrum-column">
        <div class="rf-spectrum-bar" style="--rf-spectrum-height:${height.toFixed(2)}%"></div>
      </div>
      <div class="rf-spectrum-frequency">${escapeHtml(formatRfSpectrumFrequency(bin.frequencyHz))}</div>
      <div class="rf-spectrum-band">${escapeHtml(binBand)} · ${Math.max(0, finite(bin.sinkCount))} load${bin.sinkCount === 1 ? '' : 's'}</div>
      <div class="rf-spectrum-status">${escapeHtml(statusLabel)} · ${escapeHtml(qualityLabel)}</div>
      <div class="rf-spectrum-demand">${escapeHtml(loadLabel)}</div>
    </div>`;
  }

  html += `</div></div>
    <div class="rf-spectrum-legend">
      <span><i class="is-carried"></i>Delivered carrier</span>
      <span><i class="is-rejected"></i>Rejected frequency</span>
    </div>
    <div class="rf-spectrum-note">A waveguide network carries one frequency. Rejected lines need a separate run and source.</div>
  </div>`;
  return html;
}

export default renderRfSpectrum;
