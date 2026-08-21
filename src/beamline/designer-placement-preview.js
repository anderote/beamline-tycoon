// Pure read model for the Beamline Designer palette's placement preview.
//
// The UI must not invent beam physics. This module only compares the two
// already-published solver results supplied by BeamlineDesigner: the current
// draft and the hypothetical draft containing the hovered component.

function _finite(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function _percent(value, digits = 1) {
  if (!Number.isFinite(value)) return '--';
  if (Math.abs(value) < 0.01 && value !== 0) return `${value.toFixed(3)}%`;
  return `${value.toFixed(digits)}%`;
}

function _signedPoints(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return 'no change';
  return `${value > 0 ? '+' : '\u2212'}${Math.abs(value).toFixed(1)} pt`;
}

function _sampleForElement(envelope, componentIndex) {
  const samples = (envelope || []).filter(sample => sample?.index === componentIndex);
  if (samples.length) return samples[samples.length - 1];
  // A zero-length inline element can disappear when the solver resamples the
  // s-axis. The first downstream sample is still its published outgoing beam.
  return (envelope || []).find(sample => sample?.index > componentIndex) || null;
}

function _incomingSample(envelope, componentIndex, outgoing) {
  let incoming = null;
  for (const sample of envelope || []) {
    if (sample?.index < componentIndex) incoming = sample;
    if (sample?.index >= componentIndex) break;
  }
  // A source has no incoming beam. Do not describe its generated current as a
  // 0 -> N transmission gain.
  return componentIndex > 0 ? (incoming || outgoing) : null;
}

function _lossFraction(result) {
  const loss = _finite(result?.singlePassLossFraction ?? result?.totalLossFraction);
  return loss == null ? null : Math.max(0, Math.min(1, loss));
}

function _beamSpot(sample) {
  const sx = _finite(sample?.sigma_x);
  const sy = _finite(sample?.sigma_y);
  if (sx == null || sy == null) return null;
  return { xMm: sx * 1000, yMm: sy * 1000 };
}

function _emittance(sample) {
  const x = _finite(sample?.emit_nx);
  const y = _finite(sample?.emit_ny);
  if (!(x > 0) || !(y > 0)) return null;
  return Math.sqrt(x * y) * 1e6;
}

function _changeTone(before, after, tolerance = 1e-9) {
  if (before == null || after == null || Math.abs(after - before) <= tolerance) return 'neutral';
  return after < before ? 'good' : 'bad';
}

/**
 * Build the player-facing impact rows for one hypothetical placement.
 *
 * @param {object} input
 * @param {object} input.component catalogue component definition
 * @param {number} input.componentIndex index of the inserted/replaced element
 * @param {object|null} input.beforeResult solver result for the current draft
 * @param {object|null} input.previewResult solver result for the hypothetical draft
 * @param {'insert'|'replace'} input.action
 * @param {number} input.positionS placement start on the beamline, metres
 */
export function summarizeDesignerPlacement({
  component,
  componentIndex,
  beforeResult,
  previewResult,
  action = 'insert',
  positionS = 0,
}) {
  const heading = `${action === 'replace' ? 'Replace' : 'Insert'} at s=${Number(positionS || 0).toFixed(1)} m`;
  if (!previewResult) {
    return {
      heading,
      state: 'unavailable',
      rows: [{
        label: 'Beam solver',
        value: 'Placement result unavailable',
        tone: 'warn',
      }],
    };
  }
  if (!Array.isArray(previewResult.envelope) || previewResult.envelope.length === 0) {
    return {
      heading,
      state: 'unavailable',
      rows: [{
        label: 'Beam solver',
        value: 'No beam reaches this placement',
        tone: 'bad',
      }],
    };
  }

  const envelope = previewResult.envelope;
  const outgoing = _sampleForElement(envelope, componentIndex);
  const incoming = _incomingSample(envelope, componentIndex, outgoing);
  const rows = [];

  const previewLoss = _lossFraction(previewResult);
  const beforeLoss = _lossFraction(beforeResult);
  if (previewLoss != null) {
    const transmission = (1 - previewLoss) * 100;
    const beforeTransmission = beforeLoss == null ? null : (1 - beforeLoss) * 100;
    const delta = beforeTransmission == null ? null : transmission - beforeTransmission;
    rows.push({
      label: 'Line transmission',
      value: `${_percent(transmission)}${delta == null ? '' : ` \u00b7 ${_signedPoints(delta)}`}`,
      tone: delta == null || Math.abs(delta) < 0.005 ? (previewLoss < 0.01 ? 'good' : 'warn')
        : (delta > 0 ? 'good' : 'bad'),
    });
  }

  const incomingCurrent = _finite(incoming?.current);
  const outgoingCurrent = _finite(outgoing?.current);
  if (incomingCurrent > 0 && outgoingCurrent != null) {
    const localLoss = Math.max(0, 1 - outgoingCurrent / incomingCurrent) * 100;
    rows.push({
      label: 'Loss in this component',
      value: localLoss < 0.005 ? 'None detected' : `${_percent(localLoss)} beam lost`,
      tone: localLoss < 0.05 ? 'good' : 'bad',
    });
  }

  const betaAccepted = outgoing?.beta_accepted;
  if (betaAccepted != null || component?.betaAcceptance) {
    const beta = _finite(outgoing?.rel_beta);
    const ttf = _finite(outgoing?.beta_ttf);
    const window = component?.betaAcceptance;
    const acceptance = window
      ? `${Number(window.min).toFixed(3)}\u2013${Number(window.max).toFixed(3)}`
      : 'authored window';
    const matched = betaAccepted === true;
    rows.push({
      label: '\u03b2 acceptance',
      value: beta == null
        ? `Awaiting beam \u03b2 \u00b7 accepts ${acceptance}`
        : `\u03b2 ${beta.toFixed(4)} \u00b7 ${matched ? 'matched' : 'outside'} ${acceptance}`
          + (ttf == null ? '' : ` \u00b7 TTF ${ttf.toFixed(3)}`),
      tone: betaAccepted == null ? 'neutral' : (matched ? 'good' : 'bad'),
    });
  }

  const spot = _beamSpot(outgoing);
  const apertureMm = _finite(component?.apertureRadius);
  if (spot) {
    const used = apertureMm > 0 ? Math.max(spot.xMm, spot.yMm) / apertureMm * 100 : null;
    rows.push({
      label: 'Acceptance beam spot (1\u03c3)',
      value: `${spot.xMm.toFixed(2)} \u00d7 ${spot.yMm.toFixed(2)} mm`
        + (used == null ? '' : ` \u00b7 ${used.toFixed(0)}% of r=${apertureMm.toFixed(1)} mm`),
      tone: used == null ? 'neutral' : (used <= 100 ? 'good' : 'bad'),
    });
  }

  const spreadIn = _finite(incoming?.energy_spread);
  const spreadOut = _finite(outgoing?.energy_spread);
  if (spreadOut != null) {
    rows.push({
      label: 'Energy spread',
      value: spreadIn == null
        ? _percent(spreadOut * 100, 3)
        : `${_percent(spreadIn * 100, 3)} \u2192 ${_percent(spreadOut * 100, 3)}`,
      tone: _changeTone(spreadIn, spreadOut, 1e-10),
    });
  }

  const emitIn = _emittance(incoming);
  const emitOut = _emittance(outgoing);
  if (emitOut != null) {
    rows.push({
      label: 'Optical spread (\u03b5n)',
      value: emitIn == null
        ? `${emitOut.toFixed(3)} mm\u00b7mrad`
        : `${emitIn.toFixed(3)} \u2192 ${emitOut.toFixed(3)} mm\u00b7mrad`,
      tone: _changeTone(emitIn, emitOut, 1e-6),
    });
  }

  const focusMargin = _finite(outgoing?.focus_margin);
  if (focusMargin != null) {
    rows.push({
      label: 'Aperture margin',
      value: focusMargin >= 0
        ? `${_percent(focusMargin * 100)} remaining`
        : `${_percent(Math.abs(focusMargin) * 100)} over aperture`,
      tone: focusMargin >= 0 ? 'good' : 'bad',
    });
  }

  return { heading, state: 'ready', rows };
}
