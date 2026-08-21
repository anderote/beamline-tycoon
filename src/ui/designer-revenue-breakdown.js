// Player-facing formatting for the Beamline Designer's canonical revenue
// projection. This module names and explains published economy terms; it must
// never derive a second revenue total of its own.

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatRevenueRate(value) {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (amount >= 1000) return `$${Math.round(amount).toLocaleString('en-US')}/t`;
  if (amount >= 100) return `$${amount.toFixed(0)}/t`;
  if (amount >= 10) return `$${amount.toFixed(1)}/t`;
  return `$${amount.toFixed(2)}/t`;
}

function percent(value) {
  const score = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.round(score * 100)}%`;
}

function formatPower(kw) {
  const value = Number.isFinite(kw) ? Math.max(0, kw) : 0;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 2)} MW`;
  if (value >= 100) return `${value.toFixed(0)} kW`;
  if (value >= 10) return `${value.toFixed(1)} kW`;
  return `${value.toFixed(2)} kW`;
}

function deliveryDriver(type, projection) {
  const score = percent(projection?.servicePerformanceScore);
  const power = formatPower(projection?.serviceBeamPowerKw);
  switch (type?.fom) {
    case 'beamPowerKw':
    case 'beamPowerMw':
      return {
        label: 'Delivered beam power',
        value: `${power} · ${score} delivery`,
        story: 'The endpoint customer pays for useful beam power delivered on target.',
      };
    case 'fluence':
      return {
        label: 'Dose / fluence delivery',
        value: `${power} · ${score} delivery`,
        story: 'The endpoint customer pays for useful dose delivered across the target.',
      };
    case 'doseAvailability':
      return {
        label: 'Safe delivery & availability',
        value: score,
        story: 'Treatment revenue follows safe, available delivery; excess current earns nothing extra.',
      };
    case 'photonFlux':
      return {
        label: 'Useful photon output',
        value: `${score} output score`,
        story: 'Photon-science users pay for useful light delivered to their instruments.',
      };
    case 'felBrilliance':
      return {
        label: 'FEL photon performance',
        value: `${score} output score`,
        story: 'XFEL users pay for useful saturated photon performance, not raw electron power.',
      };
    case 'euvPhotonPowerW':
      return {
        label: 'Usable EUV output',
        value: `${score} output score`,
        story: 'The fabrication contract pays for usable EUV photon power at the collector.',
      };
    case 'integratedLuminosity':
      return {
        label: 'Collision performance',
        value: `${score} delivery score`,
        story: 'This is a science programme: luminosity creates discoveries, not commercial service revenue.',
      };
    case 'blackHoleYield':
      return {
        label: 'Discovery yield',
        value: `${score} delivery score`,
        story: 'This is a discovery programme with no commercial endpoint customer.',
      };
    default:
      return {
        label: 'Beam delivery',
        value: `${score} delivery score`,
        story: 'The endpoint contract follows useful beam delivery.',
      };
  }
}

/**
 * Build a display-only model from the economy projection. Values in `terms`
 * are already-computed revenue components and intentionally are not summed
 * here; `projection.total` remains authoritative.
 */
export function designerRevenueBreakdownModel(type, projection, endpointName = null) {
  if (!projection) return null;

  const endpoint = endpointName
    || (projection.serviceEndpointId ? projection.serviceEndpointId : 'No endpoint selected');
  const contract = projection.serviceContract || 'No commercial contract';
  const fallbackDriver = deliveryDriver(type, projection);
  const driver = {
    ...fallbackDriver,
    label: projection.serviceDriverLabel || fallbackDriver.label,
  };
  let story = projection.serviceDescription || driver.story;
  if (!type) {
    story = 'Free Build has no mission contract. Choose a beamline mission to price endpoint work.';
  } else if (!projection.serviceEndpointId) {
    story = 'Add a mission-compatible endpoint to activate service revenue.';
  } else if (!(projection.serviceBaseRevenue > 0)) {
    story = projection.serviceDescription
      || `${endpoint} is a science or disposal endpoint, not a commercial customer.`;
  }

  const factors = [];
  if (projection.serviceBaseRevenue > 0) {
    factors.push({ label: 'Reference contract', value: formatRevenueRate(projection.serviceBaseRevenue) });
    factors.push({ label: 'Energy-band fit', value: percent(projection.serviceEnergyScore) });
    if (type?.spec?.currentMA) {
      factors.push({ label: 'Current-band fit', value: percent(projection.serviceCurrentScore) });
    }
    factors.push({ label: driver.label, value: driver.value });
  }

  const terms = [
    { label: projection.serviceContract || 'Endpoint service', value: projection.serviceRevenue || 0 },
    { label: type ? 'Beam operations allowance' : 'Beam operation', value: projection.operationsRevenue || 0 },
    { label: 'Data collection fees', value: projection.dataFees || 0 },
  ];
  if ((projection.photonPortCount || 0) > 0) {
    terms.push({
      label: `Photon-port users ×${projection.photonPortCount}`,
      value: projection.photonUserFees || 0,
    });
  }

  return {
    endpoint,
    contract,
    story,
    factors,
    terms,
    total: projection.total,
    assumption: 'Assumes full data connectivity · gross revenue before facility upkeep',
  };
}

export function designerRevenueBreakdownHtml(type, projection, endpointName = null) {
  const model = designerRevenueBreakdownModel(type, projection, endpointName);
  if (!model) return '';
  const factorRows = model.factors.map(row =>
    `<span class="dsgn-revenue-factor"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></span>`
  ).join('');
  const termRows = model.terms.map(row =>
    `<span class="dsgn-revenue-term"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(formatRevenueRate(row.value))}</strong></span>`
  ).join('');

  return `<span class="dsgn-revenue-breakdown" id="dsgn-revenue-breakdown" role="tooltip">`
    + '<span class="dsgn-revenue-kicker">Projected gross revenue</span>'
    + `<span class="dsgn-revenue-endpoint">${escapeHtml(model.endpoint)}</span>`
    + `<span class="dsgn-revenue-contract">${escapeHtml(model.contract)}</span>`
    + `<span class="dsgn-revenue-story">${escapeHtml(model.story)}</span>`
    + (factorRows ? `<span class="dsgn-revenue-factors">${factorRows}</span>` : '')
    + `<span class="dsgn-revenue-terms">${termRows}</span>`
    + `<span class="dsgn-revenue-total"><span>Projected gross</span><strong>${escapeHtml(formatRevenueRate(model.total))}</strong></span>`
    + `<span class="dsgn-revenue-assumption">${escapeHtml(model.assumption)}</span>`
    + '</span>';
}
