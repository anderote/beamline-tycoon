// === PROBE PLOT RENDERERS ===

export const ProbePlots = (() => {
  const PAD = { top: 18, right: 10, bottom: 20, left: 46 };
  const FONT = Object.freeze({
    message: '11px monospace',
    tick: '10px monospace',
    label: '9px monospace',
    legend: '9px monospace',
    target: 'bold 13px monospace',
    secondaryTick: '8px monospace',
    secondaryLabel: 'bold 9px monospace',
    secondaryLegend: '8px monospace',
    value: '11px monospace',
    readout: '9px monospace',
    readoutHeader: 'bold 9px monospace',
  });

  // Ghost pass: dimmed + dashed marks, drawn underneath a live curve for comparison.
  const GHOST_ALPHA = 0.4;
  const GHOST_DASH = [3, 3];

  /** draw(canvas, type, envelope, pins, activePin, xRange, yScale, opts)
   *  opts (all optional; omitting opts entirely === legacy single-pass behavior):
   *    yDomain  [lo, hi] — or [[lo, hi], ...] for multi-channel plots — overrides
   *             this pass's autoscale. Use yDomainFor()/unionYDomain() to build it.
   *    targetBand [lo, hi] — mission target annotation on the primary y-axis.
   *             Either bound may be null for an open-ended target. Targets do
   *             not affect the data domain; off-scale bounds render at the
   *             nearest plot edge instead.
   *    yAxisMode 'linear' or 'log' for positive primary y-axis values. Signed
   *             secondary axes and geometric plots keep their native scale.
   *    noClear  skip the clear + background fill so this pass composites over the last.
   *    ghost    draw data marks only (no bands, axes, pin lines, legend or labels),
   *             dimmed and dashed, so the pass drawn on top of it reads first. */
  function draw(canvas, type, envelope, pins, activePin, xRange, yScale, opts) {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 10 || canvas.height < 10) return;
    const o = {
      ghost: !!(opts && opts.ghost),
      targetBand: (opts && opts.targetBand) || null,
      yd: null,
      targets: (opts && opts.targets) || null,
      yAxisMode: opts && opts.yAxisMode === 'log' ? 'log' : 'linear',
      rightInset: opts && Number.isFinite(opts.rightInset)
        ? Math.max(0, opts.rightInset)
        : null,
    };
    if (!(opts && opts.noClear)) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(2, 8, 15, 0.82)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (!envelope || envelope.length < 2) {
      _msg(ctx, canvas, 'No beam data', o);
      return;
    }

    const fns = {
      'phase-space': _drawPhaseSpace,
      'beam-envelope': _drawBeamEnvelope,
      'current-loss': _drawCurrentLoss,
      'emittance': _drawEmittance,
      'energy': _drawEnergy,
      'energy-dispersion': _drawEnergyDispersion,
      'beta-acceptance': _drawBetaAcceptance,
      'peak-current': _drawPeakCurrent,
      'longitudinal': _drawLongitudinal,
      'eic-triangle': _drawEICTriangle,
    };

    // One seam for every plot's y-range: an explicit override, else the same
    // autoscale the plot used to do inline.
    o.yd = _normYD(opts && opts.yDomain) ||
           yDomainFor(type, envelope, yScale, pins, activePin);

    const fn = fns[type];
    if (fn) fn(ctx, canvas, envelope, pins, activePin, xRange, yScale, o);
    else _msg(ctx, canvas, 'Unknown: ' + type, o);
  }

  function _msg(ctx, canvas, text, o) {
    if (o && o.ghost) return;  // the pass drawn over us owns the message
    ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.font = FONT.message;
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  // --- Shared utilities ---

  function _area(canvas, opts = null) {
    const rightInset = Math.max(0, Number(opts?.rightInset) || 0);
    return {
      x: PAD.left, y: PAD.top,
      w: Math.max(10, canvas.width - PAD.left - PAD.right - rightInset),
      h: canvas.height - PAD.top - PAD.bottom,
    };
  }

  function _range(values) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) {
      if (v != null && isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) {
      // A fixed 0.5-unit fallback turns a constant 50 keV beam into a roughly
      // ±500 MeV chart (and tiny emittances into ±0.5 m·rad). Scale the padding
      // to the value so flat traces and mission bands retain their real ratio.
      const p = Math.max(Math.abs(lo) * 0.08, 1e-12);
      return [lo - p, hi + p];
    }
    const p = (hi - lo) * 0.08;
    return [lo - p, hi + p];
  }

  function _xRange(env) {
    return _range(env.map(d => d.s != null ? d.s : d.index));
  }

  /** Apply y-scale to an auto-computed [yMin, yMax] range.
   *  yScale: null=auto, 0.5=half, number>1=fixed max from 0 */
  function _applyYScale(yMin, yMax, yScale) {
    if (yScale == null) return [yMin, yMax];
    if (yScale === 0.5) {
      const mid = (yMin + yMax) / 2;
      const half = (yMax - yMin) / 4;
      return [mid - half, mid + half];
    }
    // Fixed range: show [0, yScale] (or [-yScale, yScale] if data goes negative)
    if (yMin < 0) return [-yScale, yScale];
    return [0, yScale];
  }

  // --- Y domains ---
  //
  // Each plot's notion of "what it plots on y" lives here once, so a caller can
  // ask for a domain without re-deriving it and both passes of a comparison land
  // on identical axes. A domain is a list of [lo, hi] channels (dual-axis plots
  // have two, point plots have one per panel); the values are only meaningful to
  // the plot type they came from. Types absent from the table have no y-axis to
  // pin (eic-triangle is on fixed log axes) and return null.
  const _Y = {
    'beam-envelope': (env, yScale) => [_applyYScale(
      ..._range(env.flatMap(d => [(d.sigma_x || 0) * 1000, (d.sigma_y || 0) * 1000])), yScale)],

    'current-loss': (env, yScale) => [_applyYScale(
      ..._range(env.map(d => d.current).filter(v => v != null)), yScale)],

    'emittance': (env, yScale) => [_applyYScale(
      ..._range(env.flatMap(d => [d.emit_nx, d.emit_ny].filter(v => v != null && isFinite(v)))), yScale)],

    'energy': (env) => [_range(
      env.map(d => d.energy).filter(v => v != null && isFinite(v)))],

    // Dual axis: [energy (GeV, pre unit-scaling), dispersion (m)]
    'energy-dispersion': (env) => {
      const dVals = env.map(d => d.eta_x).filter(v => v != null && isFinite(v));
      return [
        _range(env.map(d => d.energy).filter(v => v != null && isFinite(v))),
        _range(dVals.length > 0 ? dVals : [0]),
      ];
    },

    // Relativistic beta is bounded by definition. A fixed domain makes the
    // authored acceptance windows comparable from the ion source to beta=1.
    'beta-acceptance': () => [[0, 1]],

    // Raw [min, max] of the plotted values — the plot derives log-vs-linear from
    // it, so both passes agree on which mode they are in.
    'peak-current': (env) => {
      const vals = env.map(d => d.peak_current).filter(v => v != null && isFinite(v) && v > 0);
      if (vals.length === 0) return null;
      return [[Math.min(...vals), Math.max(...vals)]];
    },

    // Point plots: the domain is the ellipse's radial extent per panel, [0, maxR].
    'phase-space': (env, yScale, pins, activePin) => {
      const d = _pinDatum(env, pins, activePin);
      if (!d) return null;
      const rx = _ellipseMaxR(d.cov_xx, d.cov_xxp, d.cov_xpxp);
      const ry = _ellipseMaxR(d.cov_yy, d.cov_yyp, d.cov_ypyp);
      if (rx == null && ry == null) return null;
      return [[0, rx || 0], [0, ry || 0]];
    },

    'longitudinal': (env, yScale, pins, activePin) => {
      const d = _pinDatum(env, pins, activePin);
      if (!d) return null;
      const r = _ellipseMaxR(d.cov_tt || 1e-24, d.cov_tdE || 0, d.cov_dEdE || 1e-10);
      return r == null ? null : [[0, r]];
    },
  };

  /** The y domain a plot type would autoscale to for one envelope, or null if it
   *  has none. pins/activePin only matter for the at-a-point plots. */
  function yDomainFor(type, envelope, yScale, pins, activePin) {
    const f = _Y[type];
    if (!f || !envelope || envelope.length < 2) return null;
    return f(envelope, yScale, pins || [], activePin || 0);
  }

  /** Channel-wise union of two domains from the same plot type. Either may be null. */
  function unionYDomain(a, b) {
    const da = _normYD(a), db = _normYD(b);
    if (!da) return db;
    if (!db) return da;
    const n = Math.max(da.length, db.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const ca = da[i], cb = db[i];
      if (!ca) { out.push(cb); continue; }
      if (!cb) { out.push(ca); continue; }
      out.push([Math.min(ca[0], cb[0]), Math.max(ca[1], cb[1])]);
    }
    return out;
  }

  /** Mission band associated with a plot's primary y channel. */
  function targetYDomain(type, targets) {
    if (!targets) return null;
    if ((type === 'energy' || type === 'energy-dispersion') && targets.energyGeV) {
      return [targets.energyGeV, null];
    }
    if (type === 'beam-envelope' && targets.spotSizeMm) {
      return [targets.spotSizeMm];
    }
    if (type === 'current-loss' && targets.currentMA) {
      return [targets.currentMA];
    }
    return null;
  }

  // Accept both the documented [lo, hi] and the multi-channel [[lo, hi], ...]
  function _normYD(yd) {
    if (!yd || !yd.length) return null;
    return Array.isArray(yd[0]) ? yd : [yd];
  }

  // Channel accessor: the override if there is one, else the fallback pair.
  function _chan(o, i, fallback) {
    const c = o && o.yd && o.yd[i];
    return (c && isFinite(c[0]) && isFinite(c[1])) ? c : fallback;
  }

  function _pinDatum(env, pins, activePin) {
    const pin = (pins && (pins[activePin] || pins[0])) || null;
    if (!pin) return null;
    return env[pin.elementIndex] || null;
  }

  /** Draw focus margin color bands behind a plot.
   *  Reads focus_margin from envelope data to color the background. */
  function _drawFocusBands(ctx, area, envelope, xr) {
    if (!envelope || envelope.length < 2) return;
    const [xMin, xMax] = xr;
    const xSpan = xMax - xMin || 1;

    for (let i = 0; i < envelope.length - 1; i++) {
      const d = envelope[i];
      const dNext = envelope[i + 1];
      const margin = d.focus_margin;
      if (margin == null) continue;

      const s0 = d.s != null ? d.s : i;
      const s1 = dNext.s != null ? dNext.s : i + 1;

      // Map s to pixel x
      const px0 = area.x + ((s0 - xMin) / xSpan) * area.w;
      const px1 = area.x + ((s1 - xMin) / xSpan) * area.w;

      // Skip if fully outside view
      if (px1 < area.x || px0 > area.x + area.w) continue;

      // Color by margin
      let color;
      if (margin > 0.6) color = 'rgba(0, 200, 0, 0.12)';
      else if (margin > 0.3) color = 'rgba(200, 200, 0, 0.12)';
      else if (margin > 0.0) color = 'rgba(200, 100, 0, 0.15)';
      else color = 'rgba(200, 0, 0, 0.18)';

      ctx.fillStyle = color;
      ctx.fillRect(
        Math.max(px0, area.x), area.y,
        Math.min(px1, area.x + area.w) - Math.max(px0, area.x), area.h
      );
    }
  }

  function _positiveDomain(domain, values) {
    const positive = [...domain, ...values].filter(v => v != null && isFinite(v) && v > 0);
    if (positive.length === 0) return null;
    let lo = Math.min(...positive);
    let hi = Math.max(...positive);
    if (lo === hi) { lo /= 1.2; hi *= 1.2; }
    const logSpan = Math.max(Math.log10(hi) - Math.log10(lo), 0.1);
    const pad = logSpan * 0.04;
    return [10 ** (Math.log10(lo) - pad), 10 ** (Math.log10(hi) + pad)];
  }

  function _yFraction(value, yMin, yMax, logY) {
    if (logY) {
      if (!(value > 0) || !(yMin > 0) || !(yMax > yMin)) return null;
      return (Math.log10(value) - Math.log10(yMin)) /
        (Math.log10(yMax) - Math.log10(yMin));
    }
    return (value - yMin) / (yMax - yMin || 1);
  }

  function _tickValue(fraction, yMin, yMax, logY) {
    if (!logY) return yMin + fraction * (yMax - yMin);
    return 10 ** (Math.log10(yMin) + fraction * (Math.log10(yMax) - Math.log10(yMin)));
  }

  function _fmtPlotValue(value) {
    const abs = Math.abs(value);
    return abs > 0 && (abs < 0.001 || abs >= 10000)
      ? value.toExponential(2)
      : value.toPrecision(3);
  }

  function _axes(ctx, a, xLbl, yLbl, yMin, yMax, logY = false) {
    ctx.strokeStyle = 'rgba(67, 137, 139, 0.28)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) {
      const y = a.y + a.h - (i / 3) * a.h;
      ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke();
      ctx.fillStyle = 'rgba(119, 162, 164, 0.72)';
      ctx.font = FONT.tick; ctx.textAlign = 'right';
      ctx.fillText(_fmtPlotValue(_tickValue(i / 3, yMin, yMax, logY)), a.x - 3, y + 3);
    }
    ctx.strokeStyle = 'rgba(81, 174, 169, 0.58)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + a.h); ctx.lineTo(a.x + a.w, a.y + a.h); ctx.stroke();
    ctx.fillStyle = 'rgba(133, 191, 187, 0.78)'; ctx.font = FONT.label; ctx.textAlign = 'center';
    if (xLbl) ctx.fillText(xLbl, a.x + a.w / 2, a.y + a.h + 14);
    if (yLbl) {
      ctx.save(); ctx.translate(8, a.y + a.h / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${yLbl}${logY ? ' · LOG' : ''}`, 0, 0); ctx.restore();
    }
  }

  // Dual-axis: second Y axis on the right
  function _axesDual(ctx, a, xLbl, yLblL, yMinL, yMaxL, yLblR, yMinR, yMaxR, logLeft = false) {
    _axes(ctx, a, xLbl, yLblL, yMinL, yMaxL, logLeft);
    // Right axis ticks
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.15)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) {
      const y = a.y + a.h - (i / 3) * a.h;
      ctx.fillStyle = 'rgba(160, 120, 100, 0.7)';
      ctx.font = FONT.tick; ctx.textAlign = 'left';
      ctx.fillText((yMinR + (i / 3) * (yMaxR - yMinR)).toPrecision(3), a.x + a.w + 3, y + 3);
    }
    // Right axis label
    ctx.fillStyle = 'rgba(180, 140, 120, 0.7)'; ctx.font = FONT.label;
    ctx.save(); ctx.translate(a.x + a.w + PAD.right - 2, a.y + a.h / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillText(yLblR, 0, 0); ctx.restore();
  }

  // Ghost stroke: same hue, dimmed and dashed, one pixel thinner.
  function _strokeStyle(ctx, color, dashed, ghost) {
    if (ghost) {
      ctx.strokeStyle = `rgba(${_hexRgb(color)}, ${GHOST_ALPHA})`;
      ctx.lineWidth = 1;
      ctx.setLineDash(GHOST_DASH);
      return;
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
  }

  function _lineScaled(ctx, a, data, key, color, xMin, xMax, yMin, yMax, dashed, scale, ghost, logY = false) {
    _strokeStyle(ctx, color, dashed, ghost);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const xV = data[i].s != null ? data[i].s : i;
      const v = data[i][key];
      if (v == null || !isFinite(v)) { started = false; continue; }
      const x = a.x + ((xV - xMin) / (xMax - xMin)) * a.w;
      const frac = _yFraction(v * scale, yMin, yMax, logY);
      if (frac == null) { started = false; continue; }
      const y = a.y + a.h - frac * a.h;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  function _line(ctx, a, data, key, color, xMin, xMax, yMin, yMax, dashed, ghost, logY = false) {
    _strokeStyle(ctx, color, dashed, ghost);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const xV = data[i].s != null ? data[i].s : i;
      const v = data[i][key];
      if (v == null || !isFinite(v)) { started = false; continue; }
      const x = a.x + ((xV - xMin) / (xMax - xMin)) * a.w;
      const frac = _yFraction(v, yMin, yMax, logY);
      if (frac == null) { started = false; continue; }
      const y = a.y + a.h - frac * a.h;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  function _pinMarkers(ctx, a, env, pins, xMin, xMax) {
    for (const pin of pins) {
      // Use explicit s position if provided, otherwise look up from envelope
      let xV;
      if (pin.s != null) {
        xV = pin.s;
      } else {
        const d = env[pin.elementIndex];
        if (!d) continue;
        xV = d.s != null ? d.s : pin.elementIndex;
      }
      const x = a.x + ((xV - xMin) / (xMax - xMin)) * a.w;
      ctx.strokeStyle = pin.color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, a.y); ctx.lineTo(x, a.y + a.h); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function _legend(ctx, a, items) {
    ctx.font = FONT.legend;
    let lx = a.x + 4;
    for (const it of items) {
      ctx.fillStyle = it.color;
      ctx.fillRect(lx, a.y - 11, 8, 6);
      ctx.fillStyle = 'rgba(180, 180, 220, 0.8)'; ctx.textAlign = 'left';
      ctx.fillText(it.label, lx + 11, a.y - 5);
      lx += ctx.measureText(it.label).width + 24;
    }
  }

  function _targetValue(value, formatValue, unit) {
    const formatted = formatValue ? formatValue(value) : _fmtPlotValue(value);
    return unit ? `${formatted} ${unit}` : formatted;
  }

  function _targetRange(band, formatValue, formatBand, unit) {
    if (formatBand) return formatBand(band);
    const [lo, hi] = band;
    if (lo == null) return `≤ ${_targetValue(hi, formatValue, unit)}`;
    if (hi == null) return `≥ ${_targetValue(lo, formatValue, unit)}`;
    return `${_targetValue(lo, formatValue, unit)}–${_targetValue(hi, formatValue, unit)}`;
  }

  const TARGET_TEXT_COLOR = 'rgba(255, 82, 82, 0.98)';
  const TARGET_GUIDE_COLOR = 'rgba(255, 82, 82, 0.62)';

  function _targetLeader(ctx, fromX, fromY, toX, toY) {
    const elbowX = Math.max(toX + 10, fromX - 18);
    ctx.strokeStyle = TARGET_TEXT_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(elbowX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Open chevron arrowhead: military/radar callout furniture without a
    // filled badge obscuring the trace underneath it.
    const angle = Math.atan2(toY - fromY, toX - elbowX);
    const size = 4;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - Math.cos(angle - Math.PI / 6) * size,
      toY - Math.sin(angle - Math.PI / 6) * size);
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - Math.cos(angle + Math.PI / 6) * size,
      toY - Math.sin(angle + Math.PI / 6) * size);
    ctx.stroke();
  }

  function _targetMarker(ctx, a, text, y, edge = null, requestedBaseline = null) {
    const tipY = edge === 'above'
      ? a.y + 1
      : edge === 'below' ? a.y + a.h - 1 : y;
    const baseline = requestedBaseline != null
      ? requestedBaseline
      : edge === 'above'
      ? a.y + 22
      : edge === 'below' ? a.y + a.h - 10
      : Math.max(a.y + 15, Math.min(a.y + a.h - 3,
        y + (y < a.y + a.h - 30 ? 25 : -10)));
    const textX = a.x + a.w - 4;

    // Oversized terminal text plus an angular leader keeps the annotation
    // readable as a tactical target callout while pointing back into the data.
    ctx.font = FONT.target;
    ctx.fillStyle = TARGET_TEXT_COLOR;
    ctx.textAlign = 'right';
    ctx.setLineDash([]);
    ctx.fillText(text, textX, baseline);
    const textWidth = ctx.measureText(text).width;
    _targetLeader(ctx, Math.max(a.x + a.w * 0.55, textX - textWidth - 7), baseline - 5,
      a.x + a.w * 0.48, tipY);
  }

  /** Draw endpoint mission annotations without changing the curve's scale. A
   *  visible boundary gets a restrained guide; a boundary beyond the current
   *  data domain becomes a labelled arrow at the corresponding plot edge. */
  function _targetBand(ctx, a, band, yMin, yMax, logY = false, opts = {}) {
    if (!Array.isArray(band) || band.length < 2 || !isFinite(yMin) || !isFinite(yMax)) return;
    const boundaries = [];
    const targetName = `${opts.metricLabel ? `${opts.metricLabel} ` : ''}TARGET`;
    if (band[0] != null && isFinite(band[0])) {
      boundaries.push({
        value: Number(band[0]),
        label: band[1] == null ? `${targetName} ≥` : `${targetName} MIN`,
      });
    }
    if (band[1] != null && isFinite(band[1])) {
      boundaries.push({
        value: Number(band[1]),
        label: band[0] == null ? `${targetName} ≤` : `${targetName} MAX`,
      });
    }
    if (boundaries.length === 0) return;

    const edgeFor = value => {
      if (logY && !(value > 0)) return 'below';
      if (value < yMin) return 'below';
      if (value > yMax) return 'above';
      return null;
    };
    for (const boundary of boundaries) boundary.edge = edgeFor(boundary.value);

    ctx.save();
    const inRange = boundaries.filter(boundary => !boundary.edge)
      .map(boundary => ({
        ...boundary,
        y: a.y + a.h - _yFraction(boundary.value, yMin, yMax, logY) * a.h,
      }))
      .sort((left, right) => left.y - right.y);
    const labelMin = a.y + 15;
    const labelMax = a.y + a.h - 3;
    const labelYs = inRange.map(boundary =>
      Math.max(labelMin, Math.min(labelMax,
        boundary.y + (boundary.y < a.y + a.h - 30 ? 25 : -10))));
    for (let i = 1; i < labelYs.length; i++) {
      labelYs[i] = Math.max(labelYs[i], labelYs[i - 1] + 17);
    }
    for (let i = labelYs.length - 1; i >= 0; i--) {
      labelYs[i] = Math.min(labelYs[i], i === labelYs.length - 1
        ? labelMax
        : labelYs[i + 1] - 17);
    }
    for (let i = 0; i < inRange.length; i++) {
      const boundary = inRange[i];
      const frac = _yFraction(boundary.value, yMin, yMax, logY);
      const y = a.y + a.h - frac * a.h;
      ctx.strokeStyle = TARGET_GUIDE_COLOR;
      ctx.lineWidth = 0.75;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, y);
      ctx.lineTo(a.x + a.w, y);
      ctx.stroke();
      _targetMarker(ctx, a,
        `${boundary.label} ${_targetValue(boundary.value, opts.formatValue, opts.unit)}`,
        boundary.y, null, labelYs[i]);
    }

    for (const edge of ['above', 'below']) {
      const offScale = boundaries.filter(boundary => boundary.edge === edge);
      if (offScale.length === 0) continue;
      const text = offScale.length === boundaries.length && boundaries.length > 1
        ? `${targetName} ${_targetRange(band, opts.formatValue, opts.formatBand, opts.unit)}`
        : offScale.map(boundary =>
          `${boundary.label} ${_targetValue(boundary.value, opts.formatValue, opts.unit)}`
        ).join(' · ');
      const y = edge === 'above' ? a.y + 8 : a.y + a.h - 2;
      _targetMarker(ctx, a, text, y, edge);
    }
    ctx.restore();
  }

  function _hexRgb(hex) {
    const s = hex.length === 4
      ? hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]
      : hex.slice(1);
    const n = parseInt(s, 16);
    return `${(n>>16)&255}, ${(n>>8)&255}, ${n&255}`;
  }

  // --- "Along beamline" plots ---

  function _drawBeamEnvelope(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas, o);
    const [xMin, xMax] = xRange || _xRange(env);
    const ghost = o && o.ghost;
    // Focus health color bands (behind everything)
    if (!ghost) _drawFocusBands(ctx, a, env, [xMin, xMax]);
    const scaled = env.map(d => ({ ...d, sx_mm: (d.sigma_x || 0) * 1000, sy_mm: (d.sigma_y || 0) * 1000 }));
    const target = o?.targetBand || o?.targets?.spotSizeMm;
    let [yMin, yMax] = _chan(o, 0, [0, 1]);
    const logDomain = o?.yAxisMode === 'log'
      ? _positiveDomain([yMin, yMax], [
        ...scaled.flatMap(d => [d.sx_mm, d.sy_mm]),
      ])
      : null;
    const logY = !!logDomain;
    if (logDomain) [yMin, yMax] = logDomain;
    if (!ghost) _axes(ctx, a, 's (m)', 'mm', yMin, yMax, logY);
    _line(ctx, a, scaled, 'sx_mm', '#44aaff', xMin, xMax, yMin, yMax, false, ghost, logY);
    _line(ctx, a, scaled, 'sy_mm', '#ff6644', xMin, xMax, yMin, yMax, true, ghost, logY);
    if (ghost) return;
    _targetBand(ctx, a, target, yMin, yMax, logY, { unit: 'mm' });
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#44aaff', label: '\u03c3_x' }, { color: '#ff6644', label: '\u03c3_y' }]);
  }

  function _drawCurrentLoss(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas, o);
    const [xMin, xMax] = xRange || _xRange(env);
    const ghost = o && o.ghost;
    const target = o?.targetBand || o?.targets?.currentMA;
    let [yMin, yMax] = _chan(o, 0, [0, 1]);
    const logDomain = o?.yAxisMode === 'log'
      ? _positiveDomain([yMin, yMax], [
        ...env.map(d => d.current),
      ])
      : null;
    const logY = !!logDomain;
    if (logDomain) [yMin, yMax] = logDomain;
    if (!ghost) _axes(ctx, a, 's (m)', 'mA', yMin, yMax, logY);
    // Shade loss regions
    for (let i = 1; !ghost && i < env.length; i++) {
      const prev = env[i - 1], curr = env[i];
      if (prev.current != null && curr.current != null && curr.current < prev.current - 0.001) {
        const x0V = prev.s != null ? prev.s : i - 1;
        const x1V = curr.s != null ? curr.s : i;
        const x0 = a.x + ((x0V - xMin) / (xMax - xMin)) * a.w;
        const x1 = a.x + ((x1V - xMin) / (xMax - xMin)) * a.w;
        ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
        ctx.fillRect(x0, a.y, x1 - x0, a.h);
      }
    }
    _line(ctx, a, env, 'current', '#ddaa44', xMin, xMax, yMin, yMax, false, ghost, logY);
    if (ghost) return;
    _targetBand(ctx, a, target, yMin, yMax, logY, { unit: 'mA' });
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#ddaa44', label: 'Current' }]);
  }

  function _drawEmittance(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas, o);
    const [xMin, xMax] = xRange || _xRange(env);
    let [yMin, yMax] = _chan(o, 0, [0, 1]);
    const logDomain = o?.yAxisMode === 'log'
      ? _positiveDomain([yMin, yMax], env.flatMap(d => [d.emit_nx, d.emit_ny]))
      : null;
    const logY = !!logDomain;
    if (logDomain) [yMin, yMax] = logDomain;
    if (o && o.ghost) {
      _line(ctx, a, env, 'emit_nx', '#44aaff', xMin, xMax, yMin, yMax, false, true, logY);
      _line(ctx, a, env, 'emit_ny', '#ff6644', xMin, xMax, yMin, yMax, true, true, logY);
      return;
    }
    // Use normalized emittance — the conserved quantity
    _axes(ctx, a, 's (m)', '\u03b5_n (m\u00b7rad)', yMin, yMax, logY);
    _line(ctx, a, env, 'emit_nx', '#44aaff', xMin, xMax, yMin, yMax, false, false, logY);
    _line(ctx, a, env, 'emit_ny', '#ff6644', xMin, xMax, yMin, yMax, true, false, logY);
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#44aaff', label: '\u03b5_nx' }, { color: '#ff6644', label: '\u03b5_ny' }]);
  }

  function _drawEnergy(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas, o);
    const [xMin, xMax] = xRange || _xRange(env);
    const [eMinGev, eMaxGev] = _chan(o, 0, [0, 1]);
    const eRef = Math.max(Math.abs(eMinGev), Math.abs(eMaxGev)) || 1;
    const eScale = eRef >= 1000 ? 1e-3 : eRef >= 1 ? 1 : eRef >= 1e-3 ? 1e3 : 1e6;
    const eUnit = eRef >= 1000 ? 'TeV' : eRef >= 1 ? 'GeV' : eRef >= 1e-3 ? 'MeV' : 'keV';
    let eMin = eMinGev * eScale;
    let eMax = eMaxGev * eScale;
    const energyTarget = o?.targetBand || o?.targets?.energyGeV;
    const scaledEnergyTarget = energyTarget
      ? energyTarget.map(v => v == null ? null : v * eScale)
      : null;
    const logDomain = o?.yAxisMode === 'log'
      ? _positiveDomain([eMin, eMax], [
        ...env.map(d => d.energy == null ? null : d.energy * eScale),
      ])
      : null;
    const logY = !!logDomain;
    if (logDomain) [eMin, eMax] = logDomain;
    const ghost = !!o?.ghost;

    if (!ghost) _axes(ctx, a, 's (m)', `E (${eUnit})`, eMin, eMax, logY);
    _lineScaled(ctx, a, env, 'energy', '#55f29a', xMin, xMax,
      eMin, eMax, false, eScale, ghost, logY);
    if (ghost) return;
    _targetBand(ctx, a, scaledEnergyTarget, eMin, eMax, logY, {
      metricLabel: 'ENERGY',
      formatValue: value => _eicFmtEnergy(value / eScale),
      formatBand: values => values.map(value => value == null ? null : _eicFmtEnergy(value / eScale))
        .filter(Boolean).join('–'),
    });
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#55f29a', label: 'Energy' }]);
  }

  function _drawEnergyDispersion(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    // This plot already owns one right axis for dispersion. Callers composing
    // another metric can reserve additional room while keeping every trace on
    // this exact same distance span.
    const aR = _area(canvas, {
      rightInset: o?.rightInset == null ? 30 : o.rightInset,
    });
    const [xMin, xMax] = xRange || _xRange(env);

    // Left axis: energy with smart unit scaling
    const [eMinGev, eMaxGev] = _chan(o, 0, [0, 1]);
    const eRef = Math.max(Math.abs(eMinGev), Math.abs(eMaxGev)) || 1;
    const eScale = eRef >= 1000 ? 1e-3 : eRef >= 1 ? 1 : eRef >= 1e-3 ? 1e3 : 1e6;
    const eUnit = eRef >= 1000 ? 'TeV' : eRef >= 1 ? 'GeV' : eRef >= 1e-3 ? 'MeV' : 'keV';
    let eMin = eMinGev * eScale, eMax = eMaxGev * eScale;
    const energyTarget = o?.targetBand || o?.targets?.energyGeV;
    const scaledEnergyTarget = energyTarget
      ? energyTarget.map(v => v == null ? null : v * eScale)
      : null;
    const logDomain = o?.yAxisMode === 'log'
      ? _positiveDomain([eMin, eMax], [
        ...env.map(d => d.energy == null ? null : d.energy * eScale),
      ])
      : null;
    const logY = !!logDomain;
    if (logDomain) [eMin, eMax] = logDomain;

    // Right axis: dispersion in metres
    const [dMin, dMax] = _chan(o, 1, [0, 1]);

    if (o && o.ghost) {
      _lineScaled(ctx, aR, env, 'energy', '#44dd88', xMin, xMax, eMin, eMax, false, eScale, true, logY);
      _line(ctx, aR, env, 'eta_x', '#ff8844', xMin, xMax, dMin, dMax, true, true);
      return;
    }

    _axesDual(ctx, aR, 's (m)', `E (${eUnit})`, eMin, eMax, '\u03b7_x (m)', dMin, dMax, logY);
    _lineScaled(ctx, aR, env, 'energy', '#44dd88', xMin, xMax, eMin, eMax, false, eScale, false, logY);
    _line(ctx, aR, env, 'eta_x', '#ff8844', xMin, xMax, dMin, dMax, true);
    _targetBand(ctx, aR, scaledEnergyTarget, eMin, eMax, logY, {
      metricLabel: 'ENERGY',
      formatValue: value => _eicFmtEnergy(value / eScale),
      formatBand: values => values.map(value => value == null ? null : _eicFmtEnergy(value / eScale))
        .filter(Boolean).join('–'),
    });
    _pinMarkers(ctx, aR, env, pins, xMin, xMax);
    _legend(ctx, aR, [{ color: '#44dd88', label: 'Energy' }, { color: '#ff8844', label: '\u03b7_x' }]);
  }

  function _drawBetaAcceptance(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas, o);
    const [xMin, xMax] = xRange || _xRange(env);
    const ghost = !!o?.ghost;
    const [yMin, yMax] = _chan(o, 0, [0, 1]);

    // Each accelerating component publishes the window its cell geometry is
    // cut for. Draw it as a segmented band, green while the incoming beam is
    // accepted and red when the player has used the wrong beta rung.
    if (!ghost) {
      for (let i = 0; i < env.length - 1; i++) {
        const d = env[i], next = env[i + 1];
        const lo = d.beta_acceptance_min;
        const hi = d.beta_acceptance_max;
        if (lo == null || hi == null || !isFinite(lo) || !isFinite(hi)) continue;
        const s0 = _datumS(d, i), s1 = _datumS(next, i + 1);
        const px0 = a.x + ((s0 - xMin) / (xMax - xMin || 1)) * a.w;
        const px1 = a.x + ((s1 - xMin) / (xMax - xMin || 1)) * a.w;
        const pyHi = a.y + a.h - ((hi - yMin) / (yMax - yMin || 1)) * a.h;
        const pyLo = a.y + a.h - ((lo - yMin) / (yMax - yMin || 1)) * a.h;
        ctx.fillStyle = d.beta_accepted === false
          ? 'rgba(255, 68, 68, 0.22)'
          : 'rgba(80, 220, 130, 0.16)';
        ctx.fillRect(px0, pyHi, Math.max(0.75, px1 - px0), Math.max(0.75, pyLo - pyHi));
      }
    }

    const plotted = env.map(d => ({
      ...d,
      _betaDesign: d.beta_synchronous ?? d.beta_acceptance_design,
    }));
    if (!ghost) _axes(ctx, a, 's (m)', 'relativistic β', yMin, yMax);
    _line(ctx, a, plotted, '_betaDesign', '#f0b34e', xMin, xMax,
      yMin, yMax, true, ghost);
    _line(ctx, a, plotted, 'rel_beta', '#55ddff', xMin, xMax,
      yMin, yMax, false, ghost);
    if (ghost) return;
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [
      { color: '#55ddff', label: 'Beam β' },
      { color: '#f0b34e', label: 'Design β' },
      { color: '#50dc82', label: 'Acceptance' },
    ]);
  }

  function _drawPeakCurrent(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas, o);
    const [xMin, xMax] = xRange || _xRange(env);
    const ghost = !!(o && o.ghost);
    const vals = env.map(d => d.peak_current).filter(v => v != null && isFinite(v) && v > 0);
    if (vals.length === 0) {
      _msg(ctx, canvas, 'No peak current data', o);
      return;
    }

    const [minVal, maxVal] = _chan(o, 0, [Math.min(...vals), Math.max(...vals)]);
    const logDomain = o?.yAxisMode === 'log'
      ? _positiveDomain([minVal, maxVal], vals)
      : null;
    const logY = !!logDomain;
    const [yMin, yMax] = logDomain || _range([minVal, maxVal]);
    if (!ghost) _axes(ctx, a, 's (m)', 'I_peak (A)', yMin, yMax, logY);
    _line(ctx, a, env, 'peak_current', '#ee55ee', xMin, xMax, yMin, yMax, false, ghost, logY);
    if (ghost) return;
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#ee55ee', label: 'I_peak' }]);
  }

  // --- Secondary distance-axis overlays ---
  //
  // These are deliberately individual quantities (or pairs that share one
  // unit), rather than recursively drawing a second complete plot. That gives
  // the overlay one honest y-axis while both selections use exactly the same
  // physical distance coordinates.
  const SECONDARY_DISTANCE_TYPES = new Set([
    'energy', 'dispersion', 'rel-beta', 'beam-envelope', 'current-loss', 'emittance', 'peak-current',
  ]);

  const OVERLAY_STYLES = Object.freeze({
    2: Object.freeze({ primary: '#ff5ec4', paired: '#a98bff' }),
    3: Object.freeze({ primary: '#5de6ff', paired: '#72f0b0' }),
  });

  function isDistancePlot(type) {
    return ['energy', 'energy-dispersion', 'beta-acceptance', 'beam-envelope', 'current-loss', 'emittance', 'peak-current']
      .includes(type);
  }

  function secondaryYDomain(type, envelope, yScale) {
    if (!SECONDARY_DISTANCE_TYPES.has(type) || !envelope || envelope.length < 2) return null;
    if (type === 'rel-beta') return [0, 1];
    let values;
    let applyScale = false;
    if (type === 'energy') values = envelope.map(d => d.energy);
    else if (type === 'dispersion') values = envelope.map(d => d.eta_x);
    else if (type === 'rel-beta') values = envelope.map(d => d.rel_beta);
    else if (type === 'beam-envelope') {
      values = envelope.flatMap(d => [(d.sigma_x || 0) * 1000, (d.sigma_y || 0) * 1000]);
      applyScale = true;
    } else if (type === 'current-loss') {
      values = envelope.map(d => d.current);
      applyScale = true;
    } else if (type === 'emittance') {
      values = envelope.flatMap(d => [d.emit_nx, d.emit_ny]);
      applyScale = true;
    } else if (type === 'peak-current') values = envelope.map(d => d.peak_current);
    values = (values || []).filter(v => v != null && isFinite(v));
    if (values.length === 0) return null;
    const domain = _range(values);
    return applyScale ? _applyYScale(domain[0], domain[1], yScale) : domain;
  }

  function _secondarySpec(type, env, domain, seriesIndex = 2) {
    const style = OVERLAY_STYLES[seriesIndex] || OVERLAY_STYLES[2];
    const { primary, paired } = style;
    const channel = `${seriesIndex}·`;
    if (type === 'energy') {
      const ref = Math.max(Math.abs(domain[0]), Math.abs(domain[1])) || 1;
      const scale = ref >= 1000 ? 1e-3 : ref >= 1 ? 1 : ref >= 1e-3 ? 1e3 : 1e6;
      const unit = ref >= 1000 ? 'TeV' : ref >= 1 ? 'GeV' : ref >= 1e-3 ? 'MeV' : 'keV';
      return {
        data: env.map(d => ({ ...d, _secondaryA: d.energy == null ? null : d.energy * scale })),
        domain: domain.map(v => v * scale),
        axisLabel: `E (${unit})`,
        scale,
        channels: [{ key: '_secondaryA', color: primary, label: `${channel}Energy` }],
      };
    }
    if (type === 'dispersion') {
      return {
        data: env.map(d => ({ ...d, _secondaryA: d.eta_x })), domain,
        axisLabel: '\u03b7_x (m)',
        channels: [{ key: '_secondaryA', color: primary, label: `${channel}\u03b7_x` }],
      };
    }
    if (type === 'rel-beta') {
      return {
        data: env.map(d => ({ ...d, _secondaryA: d.rel_beta })),
        domain: [0, 1], axisLabel: 'relativistic β',
        channels: [{ key: '_secondaryA', color: primary, label: `${channel}Beam β` }],
      };
    }
    if (type === 'beam-envelope') {
      return {
        data: env.map(d => ({ ...d,
          _secondaryA: (d.sigma_x || 0) * 1000,
          _secondaryB: (d.sigma_y || 0) * 1000,
        })),
        domain, axisLabel: '\u03c3 (mm)',
        channels: [
          { key: '_secondaryA', color: primary, label: `${channel}\u03c3_x` },
          { key: '_secondaryB', color: paired, label: `${channel}\u03c3_y`, dashed: true },
        ],
      };
    }
    if (type === 'current-loss') {
      return {
        data: env.map(d => ({ ...d, _secondaryA: d.current })), domain,
        axisLabel: 'I (mA)',
        channels: [{ key: '_secondaryA', color: primary, label: `${channel}Current` }],
      };
    }
    if (type === 'emittance') {
      return {
        data: env.map(d => ({ ...d, _secondaryA: d.emit_nx, _secondaryB: d.emit_ny })),
        domain, axisLabel: '\u03b5_n (m·rad)',
        channels: [
          { key: '_secondaryA', color: primary, label: `${channel}\u03b5_nx` },
          { key: '_secondaryB', color: paired, label: `${channel}\u03b5_ny`, dashed: true },
        ],
      };
    }
    if (type === 'peak-current') {
      return {
        data: env.map(d => ({ ...d, _secondaryA: d.peak_current })), domain,
        axisLabel: 'I_peak (A)',
        channels: [{ key: '_secondaryA', color: primary, label: `${channel}I_peak` }],
      };
    }
    return null;
  }

  function _secondaryAxis(ctx, a, label, yMin, yMax, logY, color, offset) {
    const axisX = a.x + a.w + offset;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.75;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(axisX, a.y);
    ctx.lineTo(axisX, a.y + a.h);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = FONT.secondaryTick;
    ctx.textAlign = 'left';
    for (let i = 0; i <= 3; i++) {
      const y = a.y + a.h - (i / 3) * a.h;
      ctx.fillText(_fmtPlotValue(_tickValue(i / 3, yMin, yMax, logY)), axisX + 3, y + 3);
    }
    ctx.save();
    ctx.translate(axisX + 27, a.y + a.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = FONT.secondaryLabel;
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function _secondaryLegend(ctx, a, channels, seriesIndex) {
    ctx.font = FONT.secondaryLegend;
    let x = a.x + 4;
    const y = a.y + 8 + Math.max(0, seriesIndex - 2) * 9;
    for (const channel of channels) {
      ctx.fillStyle = channel.color;
      ctx.fillRect(x, y - 5, 7, 2);
      ctx.textAlign = 'left';
      ctx.fillText(channel.label, x + 9, y);
      x += ctx.measureText(channel.label).width + 20;
    }
  }

  /** Draw one independently scaled metric over an existing distance plot.
   *  The caller owns the background and primary axes. `rightInset` must match
   *  the primary draw so the traces share pixel-for-pixel x coordinates. */
  function drawSecondary(canvas, type, envelope, xRange, yScale, opts = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 10 || canvas.height < 10) return;
    const rawDomain = opts.yDomain || secondaryYDomain(type, envelope, yScale);
    if (!rawDomain || !envelope || envelope.length < 2) return;
    const seriesIndex = opts.seriesIndex === 3 ? 3 : 2;
    const spec = _secondarySpec(type, envelope, rawDomain, seriesIndex);
    if (!spec) return;

    const a = _area(canvas, { rightInset: opts.rightInset });
    const [xMin, xMax] = xRange || _xRange(envelope);
    let [yMin, yMax] = spec.domain;
    const values = spec.channels.flatMap(channel =>
      spec.data.map(d => d[channel.key]).filter(v => v != null && isFinite(v)));
    const logDomain = opts.yAxisMode === 'log'
      ? _positiveDomain([yMin, yMax], values)
      : null;
    const logY = !!logDomain;
    if (logDomain) [yMin, yMax] = logDomain;

    ctx.save();
    for (const channel of spec.channels) {
      _line(ctx, a, spec.data, channel.key, channel.color, xMin, xMax,
        yMin, yMax, !!channel.dashed, !!opts.ghost, logY);
    }
    if (!opts.ghost) {
      _secondaryAxis(ctx, a, spec.axisLabel, yMin, yMax, logY,
        spec.channels[0].color, Math.max(0, Number(opts.axisOffset) || 0));
      _secondaryLegend(ctx, a, spec.channels, seriesIndex);
    }
    ctx.restore();
  }

  function _datumS(datum, index) {
    return datum?.s != null && isFinite(datum.s) ? Number(datum.s) : index;
  }

  function _nearestDatumIndex(env, targetS) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < (env?.length || 0); i++) {
      const distance = Math.abs(_datumS(env[i], i) - targetS);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function _cursorText(value, unit) {
    return `${_fmtPlotValue(value)}${unit ? ` ${unit}` : ''}`;
  }

  function _cursorItem(id, label, value, text, color, domain, logY = false) {
    if (value == null || !isFinite(value) || !domain) return null;
    return { id, label, value: Number(value), text, color, domain, logY };
  }

  function _primaryCursorItems(type, env, index, yDomain, yAxisMode) {
    const d = env[index];
    const yd = _normYD(yDomain) || yDomainFor(type, env, null, [], 0);
    if (!d || !yd) return [];
    let domain = yd[0];
    let logY = false;
    const positive = values => {
      const adjusted = yAxisMode === 'log' ? _positiveDomain(domain, values) : null;
      if (adjusted) { domain = adjusted; logY = true; }
    };
    let items = [];

    if (type === 'beam-envelope') {
      positive(env.flatMap(row => [(row.sigma_x || 0) * 1000, (row.sigma_y || 0) * 1000]));
      items = [
        _cursorItem('primary-sx', 'σ_x', (d.sigma_x || 0) * 1000,
          _cursorText((d.sigma_x || 0) * 1000, 'mm'), '#44aaff', domain, logY),
        _cursorItem('primary-sy', 'σ_y', (d.sigma_y || 0) * 1000,
          _cursorText((d.sigma_y || 0) * 1000, 'mm'), '#ff6644', domain, logY),
      ];
    } else if (type === 'current-loss') {
      positive(env.map(row => row.current));
      items = [_cursorItem('primary-current', 'Current', d.current,
        _cursorText(d.current, 'mA'), '#ddaa44', domain, logY)];
    } else if (type === 'emittance') {
      positive(env.flatMap(row => [row.emit_nx, row.emit_ny]));
      items = [
        _cursorItem('primary-enx', 'ε_nx', d.emit_nx,
          _cursorText(d.emit_nx, 'm·rad'), '#44aaff', domain, logY),
        _cursorItem('primary-eny', 'ε_ny', d.emit_ny,
          _cursorText(d.emit_ny, 'm·rad'), '#ff6644', domain, logY),
      ];
    } else if (type === 'energy') {
      positive(env.map(row => row.energy));
      items = [_cursorItem('primary-energy', 'Energy', d.energy, _eicFmtEnergy(d.energy),
        '#55f29a', domain, logY)];
    } else if (type === 'energy-dispersion') {
      positive(env.map(row => row.energy));
      items = [
        _cursorItem('primary-energy', 'Energy', d.energy, _eicFmtEnergy(d.energy),
          '#44dd88', domain, logY),
        _cursorItem('primary-dispersion', 'η_x', d.eta_x,
          _cursorText(d.eta_x, 'm'), '#ff8844', yd[1]),
      ];
    } else if (type === 'beta-acceptance') {
      const status = d.beta_accepted == null
        ? ''
        : d.beta_accepted ? ' · MATCH' : ' · MISMATCH';
      const ttf = d.beta_ttf == null || !isFinite(d.beta_ttf)
        ? ''
        : ` · TTF ${_fmtPlotValue(d.beta_ttf)}`;
      items = [
        _cursorItem('primary-rel-beta', 'Beam β', d.rel_beta,
          `${_fmtPlotValue(d.rel_beta)}${ttf}${status}`,
          d.beta_accepted === false ? '#ff5555' : '#55ddff', domain),
        _cursorItem('primary-beta-min', 'β min', d.beta_acceptance_min,
          _cursorText(d.beta_acceptance_min, ''), '#50dc82', domain),
        _cursorItem('primary-beta-design', d.beta_synchronous != null
          && d.beta_synchronous !== d.beta_acceptance_design ? 'β sync' : 'β design',
        d.beta_synchronous ?? d.beta_acceptance_design,
        _cursorText(d.beta_synchronous ?? d.beta_acceptance_design, ''),
        '#f0b34e', domain),
        _cursorItem('primary-beta-max', 'β max', d.beta_acceptance_max,
          _cursorText(d.beta_acceptance_max, ''), '#50dc82', domain),
      ];
    } else if (type === 'peak-current') {
      const values = env.map(row => row.peak_current)
        .filter(value => value != null && isFinite(value) && value > 0);
      const adjusted = yAxisMode === 'log' ? _positiveDomain(domain, values) : null;
      if (adjusted) { domain = adjusted; logY = true; }
      else domain = _range(domain);
      items = [_cursorItem('primary-peak', 'I_peak', d.peak_current,
        _cursorText(d.peak_current, 'A'), '#ee55ee', domain, logY)];
    }
    return items.filter(Boolean);
  }

  function _secondaryCursorItems(type, env, index, yDomain, yAxisMode, seriesIndex = 2) {
    if (!type || !yDomain) return [];
    const spec = _secondarySpec(type, env, yDomain, seriesIndex);
    if (!spec || !spec.data[index]) return [];
    let domain = spec.domain;
    const values = spec.channels.flatMap(channel =>
      spec.data.map(d => d[channel.key]).filter(value => value != null && isFinite(value)));
    const adjusted = yAxisMode === 'log' ? _positiveDomain(domain, values) : null;
    const logY = !!adjusted;
    if (adjusted) domain = adjusted;
    const unit = type === 'energy'
      ? (spec.axisLabel.match(/\(([^)]+)\)/)?.[1] || '')
      : type === 'dispersion' ? 'm'
      : type === 'rel-beta' ? ''
      : type === 'beam-envelope' ? 'mm'
      : type === 'current-loss' ? 'mA'
      : type === 'emittance' ? 'm·rad'
      : type === 'peak-current' ? 'A'
      : '';
    return spec.channels.map((channel, channelIndex) => {
      const value = spec.data[index][channel.key];
      return _cursorItem(`overlay-${seriesIndex}-${channelIndex}`, channel.label, value,
        _cursorText(value, unit), channel.color, domain, logY);
    }).filter(Boolean);
  }

  function _cursorOverlayItems(opts, env, index) {
    const overlays = Array.isArray(opts.overlays)
      ? opts.overlays
      : [{
        type: opts.secondaryType,
        domain: opts.secondaryDomain,
        seriesIndex: 2,
      }];
    return overlays.flatMap((overlay, overlayIndex) => _secondaryCursorItems(
      overlay?.type,
      env,
      index,
      overlay?.domain,
      opts.yAxisMode,
      overlay?.seriesIndex || overlayIndex + 2,
    ));
  }

  function _drawCursorDot(ctx, a, x, item, ghost = false) {
    const fraction = _yFraction(item.value, item.domain[0], item.domain[1], item.logY);
    if (fraction == null || fraction < 0 || fraction > 1) return;
    const y = a.y + a.h - fraction * a.h;
    ctx.beginPath();
    ctx.arc(x, y, ghost ? 1.5 : 2.3, 0, Math.PI * 2);
    ctx.fillStyle = ghost
      ? `rgba(${_hexRgb(item.color)}, ${GHOST_ALPHA + 0.15})`
      : item.color;
    ctx.fill();
  }

  /** Draw the final hover layer for an along-distance plot. The cursor snaps
   *  to the closest solver sample, marks every visible curve at that distance,
   *  and reports primary plus optional secondary values on the shared x-axis. */
  function drawCursor(canvas, type, envelope, xRange, opts = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !isDistancePlot(type) || !envelope || envelope.length < 2) return null;
    const cursorX = Number(opts.cursorX);
    if (!isFinite(cursorX)) return null;
    const a = _area(canvas, { rightInset: opts.rightInset });
    if (cursorX < a.x || cursorX > a.x + a.w) return null;
    const [xMin, xMax] = xRange || _xRange(envelope);
    const targetS = xMin + ((cursorX - a.x) / (a.w || 1)) * (xMax - xMin);
    const index = _nearestDatumIndex(envelope, targetS);
    if (index < 0) return null;
    const snapS = _datumS(envelope[index], index);
    if (snapS < xMin || snapS > xMax) return null;
    const x = a.x + ((snapS - xMin) / (xMax - xMin || 1)) * a.w;
    const solidItems = [
      ..._primaryCursorItems(type, envelope, index, opts.yDomain, opts.yAxisMode),
      ..._cursorOverlayItems(opts, envelope, index),
    ];
    if (solidItems.length === 0) return null;

    const ghost = opts.ghostEnvelope;
    let ghostItems = [];
    if (ghost?.length) {
      const ghostIndex = _nearestDatumIndex(ghost, snapS);
      if (ghostIndex >= 0) {
        ghostItems = [
          ..._primaryCursorItems(type, ghost, ghostIndex, opts.yDomain, opts.yAxisMode),
          ..._cursorOverlayItems(opts, ghost, ghostIndex),
        ];
      }
    }
    const ghostById = new Map(ghostItems.map(item => [item.id, item]));
    const comparing = ghostById.size > 0;
    const solidTag = opts.solidLabel || 'P';
    const ghostTag = opts.ghostLabel || 'C';
    const rows = solidItems.map(item => {
      const ghostItem = ghostById.get(item.id);
      const valueText = ghostItem
        ? `${solidTag} ${item.text} · ${ghostTag} ${ghostItem.text}`
        : item.text;
      return { item, ghostItem, text: `${item.label}  ${valueText}` };
    });

    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(210, 210, 240, 0.42)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(x, a.y);
    ctx.lineTo(x, a.y + a.h);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const row of rows) {
      _drawCursorDot(ctx, a, x, row.item, false);
      if (row.ghostItem) _drawCursorDot(ctx, a, x, row.ghostItem, true);
    }

    const header = `s=${_fmtPlotValue(snapS)} m${comparing ? `  ${solidTag}/${ghostTag}` : ''}`;
    const lineHeight = 11;
    const pad = 5;
    ctx.font = FONT.readout;
    const textWidth = Math.max(ctx.measureText(header).width,
      ...rows.map(row => ctx.measureText(row.text).width));
    const boxW = textWidth + pad * 2;
    const boxH = (rows.length + 1) * lineHeight + pad * 2 - 2;
    let boxX = x + 7;
    if (boxX + boxW > a.x + a.w - 2) boxX = x - boxW - 7;
    boxX = Math.max(a.x + 2, Math.min(a.x + a.w - boxW - 2, boxX));
    const cursorY = isFinite(Number(opts.cursorY)) ? Number(opts.cursorY) : a.y + a.h / 2;
    let boxY = cursorY - boxH / 2;
    boxY = Math.max(a.y + 2, Math.min(a.y + a.h - boxH - 2, boxY));
    ctx.fillStyle = 'rgba(5, 7, 18, 0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = 'rgba(180, 190, 230, 0.58)';
    ctx.lineWidth = 0.75;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.textAlign = 'left';
    ctx.font = FONT.readoutHeader;
    ctx.fillStyle = 'rgba(225, 230, 250, 0.96)';
    ctx.fillText(header, boxX + pad, boxY + pad + 7);
    ctx.font = FONT.readout;
    rows.forEach((row, rowIndex) => {
      ctx.fillStyle = row.item.color;
      ctx.fillText(row.text, boxX + pad, boxY + pad + 7 + (rowIndex + 1) * lineHeight);
    });
    ctx.restore();
    return { s: snapS, index, rows: rows.map(row => row.text) };
  }

  // --- "At this point" plots ---

  // Not an along-s curve: one operating point, two ellipses. A ghost pass draws a
  // second, dimmed pair of outlines — same panels, same radial scale — rather than
  // being pushed through the curve path.
  function _drawPhaseSpace(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const pin = pins[activePin];
    if (!pin) { _msg(ctx, canvas, 'No pin selected', o); return; }
    const d = env[pin.elementIndex];
    if (!d) { _msg(ctx, canvas, 'No data at pin', o); return; }

    const w = canvas.width, h = canvas.height;
    const halfW = Math.floor((w - 20) / 2);
    const plotH = h - PAD.top - PAD.bottom;

    _drawEllipse(ctx, 10, PAD.top, halfW - 5, plotH,
      d.cov_xx, d.cov_xxp, d.cov_xpxp, pin.color, 'x', "x'", d.emit_x, o, 0);
    _drawEllipse(ctx, halfW + 15, PAD.top, halfW - 5, plotH,
      d.cov_yy, d.cov_yyp, d.cov_ypyp, pin.color, 'y', "y'", d.emit_y, o, 1);
  }

  // Radial extent an ellipse panel autoscales to (3 sigma of the major axis).
  function _ellipseMaxR(s11, s12, s22) {
    if (!s11 || !s22) return null;
    const trace = s11 + s22;
    const det = s11 * s22 - s12 * s12;
    const disc = Math.sqrt(Math.max((trace * trace / 4) - det, 0));
    const r = Math.sqrt(trace / 2 + disc) * 3;
    return isFinite(r) && r > 0 ? r : null;
  }

  function _drawEllipse(ctx, ox, oy, w, h, s11, s12, s22, color, xLbl, yLbl, emittance, o, chan) {
    if (!s11 || !s22) return;
    const trace = s11 + s22;
    const det = s11 * s22 - s12 * s12;
    const disc = Math.sqrt(Math.max((trace * trace / 4) - det, 0));
    const lam1 = trace / 2 + disc;
    const lam2 = Math.max(trace / 2 - disc, 1e-30);
    const angle = Math.atan2(2 * s12, s11 - s22) / 2;

    const ghost = !!(o && o.ghost);
    const shared = _chan(o, chan, null);
    const maxR = (shared && shared[1] > 0) ? shared[1] : Math.sqrt(lam1) * 3;
    const scale = Math.min(w, h) / 2 / maxR;
    const cx = ox + w / 2, cy = oy + h / 2;

    // Crosshairs
    if (!ghost) {
      ctx.strokeStyle = 'rgba(60, 60, 100, 0.4)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(ox, cy); ctx.lineTo(ox + w, cy);
      ctx.moveTo(cx, oy); ctx.lineTo(cx, oy + h);
      ctx.stroke();
    }

    // Ellipse
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-angle);
    _strokeStyle(ctx, color, false, ghost);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.sqrt(lam1) * scale, Math.sqrt(lam2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${_hexRgb(color)}, ${ghost ? 0.05 : 0.1})`;
    ctx.fill();
    ctx.restore();
    if (ghost) return;

    // Labels
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)'; ctx.font = FONT.label; ctx.textAlign = 'center';
    ctx.fillText(xLbl, cx, oy + h + 12);
    ctx.save(); ctx.translate(ox - 2, cy); ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLbl, 0, 0); ctx.restore();
    if (emittance != null) {
      ctx.fillStyle = color;
      ctx.fillText('\u03b5=' + emittance.toExponential(2), cx, oy - 3);
    }
  }

  // Also a single operating point, not a curve: ghost draws a second dimmed ellipse.
  function _drawLongitudinal(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const pin = pins[activePin];
    if (!pin) { _msg(ctx, canvas, 'No pin selected', o); return; }
    const d = env[pin.elementIndex];
    if (!d) { _msg(ctx, canvas, 'No data at pin', o); return; }

    const ghost = !!(o && o.ghost);
    const a = _area(canvas);
    const s44 = d.cov_tt || 1e-24, s45 = d.cov_tdE || 0, s55 = d.cov_dEdE || 1e-10;

    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const trace = s44 + s55;
    const det = s44 * s55 - s45 * s45;
    const disc = Math.sqrt(Math.max((trace * trace / 4) - det, 0));
    const lam1 = trace / 2 + disc;
    const lam2 = Math.max(trace / 2 - disc, 1e-30);
    const angle = Math.atan2(2 * s45, s44 - s55) / 2;
    const shared = _chan(o, 0, null);
    const maxR = (shared && shared[1] > 0) ? shared[1] : Math.sqrt(lam1) * 3;
    const scale = Math.min(a.w, a.h) / 2 / maxR;

    // Crosshairs
    if (!ghost) {
      ctx.strokeStyle = 'rgba(60, 60, 100, 0.4)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(a.x, cy); ctx.lineTo(a.x + a.w, cy);
      ctx.moveTo(cx, a.y); ctx.lineTo(cx, a.y + a.h);
      ctx.stroke();
    }

    // Ellipse
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-angle);
    _strokeStyle(ctx, pin.color, false, ghost);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.sqrt(lam1) * scale, Math.sqrt(lam2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${_hexRgb(pin.color)}, ${ghost ? 0.05 : 0.1})`;
    ctx.fill();
    ctx.restore();
    if (ghost) return;

    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)'; ctx.font = FONT.label; ctx.textAlign = 'center';
    ctx.fillText('dt (s)', a.x + a.w / 2, a.y + a.h + 14);
    ctx.fillText(`\u03c3t=${Math.sqrt(s44).toExponential(1)} \u03c3E=${Math.sqrt(s55).toExponential(1)}`,
      a.x + a.w / 2, a.y - 3);
  }

  // --- E / I / epsilon triangle (core tradeoff radar) ---

  // Log-axis endpoints: value at centre (0.0) vs rim (1.0).
  // Chosen to span the full gameplay range (tabletop 1 MeV → TeV colliders, nA → A, etc.)
  // without needing re-scaling per tier.
  const EIC_ENERGY_MIN_GEV = 1e-3;    // 1 MeV
  const EIC_ENERGY_MAX_GEV = 1e4;     // 10 TeV  (7 decades)
  const EIC_CURRENT_MIN_MA = 1e-3;    // 1 uA
  const EIC_CURRENT_MAX_MA = 1e3;     // 1 A     (6 decades)
  const EIC_EMIT_BAD  = 1e-4;         // rim = centre on emittance (worse)
  const EIC_EMIT_GOOD = 1e-9;         // rim = outer (better)     (5 decades)

  // Reference "par" polygon — shown dashed for contrast
  const EIC_REF_ENERGY_GEV = 1.0;
  const EIC_REF_CURRENT_MA = 10.0;
  const EIC_REF_EMIT = 3e-7;

  function _eicNormLog(v, vMin, vMax) {
    if (v == null || !isFinite(v) || v <= 0) return 0;
    const f = (Math.log10(v) - Math.log10(vMin)) / (Math.log10(vMax) - Math.log10(vMin));
    return Math.max(0, Math.min(1, f));
  }

  // Emittance: smaller = better, so invert (good → outer rim)
  function _eicNormEmit(v) {
    if (v == null || !isFinite(v) || v <= 0) return 0;
    const f = (Math.log10(EIC_EMIT_BAD) - Math.log10(v)) /
              (Math.log10(EIC_EMIT_BAD) - Math.log10(EIC_EMIT_GOOD));
    return Math.max(0, Math.min(1, f));
  }

  // Path a triangle whose vertices sit at norms[i] along each spoke.
  function _eicPath(ctx, cx, cy, R, angles, norms) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const r = R * norms[i];
      const x = cx + Math.cos(angles[i]) * r;
      const y = cy + Math.sin(angles[i]) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // Rings, spokes and the reference "par" polygon — fixed furniture, so a ghost
  // pass skips it and only contributes its own triangle.
  function _eicChrome(ctx, cx, cy, R, angles) {
    // --- Background rings (0.25, 0.5, 0.75, 1.0) ---
    ctx.strokeStyle = 'rgba(74, 139, 118, 0.34)';
    ctx.lineWidth = 0.5;
    for (const frac of [0.25, 0.5, 0.75, 1.0]) {
      _eicPath(ctx, cx, cy, R, angles, [frac, frac, frac]);
      ctx.stroke();
    }

    // --- Spokes ---
    ctx.strokeStyle = 'rgba(82, 168, 139, 0.52)';
    ctx.lineWidth = 1;
    for (const a of angles) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();

      // Short calibration marks turn each spoke into a radar range vector.
      const tx = -Math.sin(a) * 2.5;
      const ty = Math.cos(a) * 2.5;
      for (const frac of [0.25, 0.5, 0.75, 1]) {
        const px = cx + Math.cos(a) * R * frac;
        const py = cy + Math.sin(a) * R * frac;
        ctx.beginPath();
        ctx.moveTo(px - tx, py - ty);
        ctx.lineTo(px + tx, py + ty);
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(93, 230, 197, 0.75)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // --- Reference "par" polygon (dashed) ---
    ctx.strokeStyle = 'rgba(180, 180, 145, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    _eicPath(ctx, cx, cy, R, angles, [
      _eicNormLog(EIC_REF_ENERGY_GEV, EIC_ENERGY_MIN_GEV, EIC_ENERGY_MAX_GEV),
      _eicNormLog(EIC_REF_CURRENT_MA, EIC_CURRENT_MIN_MA, EIC_CURRENT_MAX_MA),
      _eicNormEmit(EIC_REF_EMIT),
    ]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Not an along-s curve either: one operating point on fixed log axes, so there is
  // no y domain to share. Ghost draws a second dimmed triangle over the same rings.
  function _drawEICTriangle(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const pin = pins[activePin] || pins[0];
    if (!pin) { _msg(ctx, canvas, 'Place marker to probe beam', o); return; }
    const d = env[pin.elementIndex];
    if (!d) { _msg(ctx, canvas, 'No data at marker', o); return; }

    const ghost = !!(o && o.ghost);
    const w = canvas.width, h = canvas.height;
    const cx = w / 2;
    const cy = h / 2 + 4;
    const R = Math.min(w, h) * 0.38;

    // Axis angles: Energy top, Current lower-right, Emittance lower-left.
    const angles = [-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6];

    if (!ghost) _eicChrome(ctx, cx, cy, R, angles);

    // --- Current values ---
    const eGeV = d.energy;
    const iMA = d.current;
    const eps = Math.max(d.emit_nx || 0, d.emit_ny || 0);

    const norms = [
      _eicNormLog(eGeV, EIC_ENERGY_MIN_GEV, EIC_ENERGY_MAX_GEV),
      _eicNormLog(iMA, EIC_CURRENT_MIN_MA, EIC_CURRENT_MAX_MA),
      _eicNormEmit(eps),
    ];

    const color = '#ffbb44';
    ctx.fillStyle = `rgba(${_hexRgb(color)}, ${ghost ? 0.08 : 0.22})`;
    _strokeStyle(ctx, color, false, ghost);
    _eicPath(ctx, cx, cy, R, angles, norms);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (ghost) return;

    // Vertex dots
    ctx.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      const r = R * norms[i];
      const x = cx + Math.cos(angles[i]) * r;
      const y = cy + Math.sin(angles[i]) * r;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Axis labels with values ---
    const eFmt = _eicFmtEnergy(eGeV);
    const iFmt = _eicFmtCurrent(iMA);
    const epsFmt = (eps > 0 && isFinite(eps)) ? eps.toExponential(1) : '--';

    ctx.fillStyle = 'rgba(210, 210, 240, 0.9)';
    ctx.font = FONT.value;
    ctx.textAlign = 'center';

    // Energy (top)
    const eLblX = cx + Math.cos(angles[0]) * (R + 12);
    const eLblY = cy + Math.sin(angles[0]) * (R + 12);
    ctx.fillText('E', eLblX, eLblY - 2);
    ctx.fillStyle = color;
    ctx.fillText(eFmt, eLblX, eLblY + 10);

    // Current (lower-right)
    ctx.fillStyle = 'rgba(210, 210, 240, 0.9)';
    ctx.textAlign = 'left';
    const iLblX = cx + Math.cos(angles[1]) * (R + 6) + 2;
    const iLblY = cy + Math.sin(angles[1]) * (R + 6);
    ctx.fillText('I', iLblX, iLblY);
    ctx.fillStyle = color;
    ctx.fillText(iFmt, iLblX, iLblY + 10);

    // Emittance (lower-left)
    ctx.fillStyle = 'rgba(210, 210, 240, 0.9)';
    ctx.textAlign = 'right';
    const epsLblX = cx + Math.cos(angles[2]) * (R + 6) - 2;
    const epsLblY = cy + Math.sin(angles[2]) * (R + 6);
    ctx.fillText('\u03b5', epsLblX, epsLblY);
    ctx.fillStyle = color;
    ctx.fillText(epsFmt, epsLblX, epsLblY + 10);

    // Title
    ctx.fillStyle = 'rgba(180, 180, 220, 0.7)';
    ctx.font = FONT.label;
    ctx.textAlign = 'center';
    ctx.fillText('TACTICAL E / I / \u03b5 VECTOR  //  LOG  //  PAR DASHED', cx, 12);
  }

  function _eicFmtEnergy(gev) {
    if (gev == null || !isFinite(gev)) return '--';
    if (gev >= 1000) return (gev / 1000).toPrecision(3) + ' TeV';
    if (gev >= 1)    return gev.toPrecision(3) + ' GeV';
    if (gev >= 1e-3) return (gev * 1e3).toPrecision(3) + ' MeV';
    return (gev * 1e6).toPrecision(3) + ' keV';
  }

  function _eicFmtCurrent(ma) {
    if (ma == null || !isFinite(ma)) return '--';
    if (ma >= 1000) return (ma / 1000).toPrecision(3) + ' A';
    if (ma >= 1)    return ma.toPrecision(3) + ' mA';
    if (ma >= 1e-3) return (ma * 1e3).toPrecision(3) + ' \u00b5A';
    return (ma * 1e6).toPrecision(3) + ' nA';
  }

  return {
    draw,
    drawSecondary,
    drawCursor,
    isDistancePlot,
    secondaryYDomain,
    yDomainFor,
    unionYDomain,
    targetYDomain,
  };
})();
