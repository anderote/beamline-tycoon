// === PROBE PLOT RENDERERS ===

export const ProbePlots = (() => {
  const PAD = { top: 18, right: 10, bottom: 20, left: 46 };

  // Ghost pass: dimmed + dashed marks, drawn underneath a live curve for comparison.
  const GHOST_ALPHA = 0.4;
  const GHOST_DASH = [3, 3];

  /** draw(canvas, type, envelope, pins, activePin, xRange, yScale, opts)
   *  opts (all optional; omitting opts entirely === legacy single-pass behavior):
   *    yDomain  [lo, hi] — or [[lo, hi], ...] for multi-channel plots — overrides
   *             this pass's autoscale. Use yDomainFor()/unionYDomain() to build it.
   *    noClear  skip the clear + background fill so this pass composites over the last.
   *    ghost    draw data marks only (no bands, axes, pin lines, legend or labels),
   *             dimmed and dashed, so the pass drawn on top of it reads first. */
  function draw(canvas, type, envelope, pins, activePin, xRange, yScale, opts) {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 10 || canvas.height < 10) return;
    const o = {
      ghost: !!(opts && opts.ghost),
      yd: null,
      targets: (opts && opts.targets) || null,
    };
    if (!(opts && opts.noClear)) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
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
      'energy-dispersion': _drawEnergyDispersion,
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
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  // --- Shared utilities ---

  function _area(canvas) {
    return {
      x: PAD.left, y: PAD.top,
      w: canvas.width - PAD.left - PAD.right,
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
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
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

    // Dual axis: [energy (GeV, pre unit-scaling), dispersion (m)]
    'energy-dispersion': (env) => {
      const dVals = env.map(d => d.eta_x).filter(v => v != null && isFinite(v));
      return [
        _range(env.map(d => d.energy).filter(v => v != null && isFinite(v))),
        _range(dVals.length > 0 ? dVals : [0]),
      ];
    },

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

  /** Extra y extent required to keep a machine mission band visible. */
  function targetYDomain(type, targets) {
    if (!targets) return null;
    if (type === 'energy-dispersion' && targets.energyGeV) {
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

  function _axes(ctx, a, xLbl, yLbl, yMin, yMax) {
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.3)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) {
      const y = a.y + a.h - (i / 3) * a.h;
      ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke();
      ctx.fillStyle = 'rgba(120, 120, 160, 0.7)';
      ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillText((yMin + (i / 3) * (yMax - yMin)).toPrecision(3), a.x - 3, y + 3);
    }
    ctx.strokeStyle = 'rgba(80, 80, 130, 0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + a.h); ctx.lineTo(a.x + a.w, a.y + a.h); ctx.stroke();
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    if (xLbl) ctx.fillText(xLbl, a.x + a.w / 2, a.y + a.h + 14);
    if (yLbl) {
      ctx.save(); ctx.translate(8, a.y + a.h / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText(yLbl, 0, 0); ctx.restore();
    }
  }

  // Dual-axis: second Y axis on the right
  function _axesDual(ctx, a, xLbl, yLblL, yMinL, yMaxL, yLblR, yMinR, yMaxR) {
    _axes(ctx, a, xLbl, yLblL, yMinL, yMaxL);
    // Right axis ticks
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.15)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) {
      const y = a.y + a.h - (i / 3) * a.h;
      ctx.fillStyle = 'rgba(160, 120, 100, 0.7)';
      ctx.font = '9px monospace'; ctx.textAlign = 'left';
      ctx.fillText((yMinR + (i / 3) * (yMaxR - yMinR)).toPrecision(3), a.x + a.w + 3, y + 3);
    }
    // Right axis label
    ctx.fillStyle = 'rgba(180, 140, 120, 0.7)'; ctx.font = '8px monospace';
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

  function _lineScaled(ctx, a, data, key, color, xMin, xMax, yMin, yMax, dashed, scale, ghost) {
    _strokeStyle(ctx, color, dashed, ghost);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const xV = data[i].s != null ? data[i].s : i;
      const v = data[i][key];
      if (v == null || !isFinite(v)) continue;
      const x = a.x + ((xV - xMin) / (xMax - xMin)) * a.w;
      const y = a.y + a.h - ((v * scale - yMin) / (yMax - yMin)) * a.h;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  function _line(ctx, a, data, key, color, xMin, xMax, yMin, yMax, dashed, ghost) {
    _strokeStyle(ctx, color, dashed, ghost);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const xV = data[i].s != null ? data[i].s : i;
      const v = data[i][key];
      if (v == null || !isFinite(v)) continue;
      const x = a.x + ((xV - xMin) / (xMax - xMin)) * a.w;
      const y = a.y + a.h - ((v - yMin) / (yMax - yMin)) * a.h;
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
    ctx.font = '8px monospace';
    let lx = a.x + 4;
    for (const it of items) {
      ctx.fillStyle = it.color;
      ctx.fillRect(lx, a.y - 11, 8, 6);
      ctx.fillStyle = 'rgba(180, 180, 220, 0.8)'; ctx.textAlign = 'left';
      ctx.fillText(it.label, lx + 11, a.y - 5);
      lx += ctx.measureText(it.label).width + 24;
    }
  }

  /** Draw an endpoint mission band behind a live curve. The label is explicit
   *  because a final-energy target is not a claim that energy must remain in
   *  that band throughout the accelerator. */
  function _targetBand(ctx, a, band, yMin, yMax) {
    if (!Array.isArray(band) || band.length < 2 || !isFinite(yMin) || !isFinite(yMax)) return;
    const span = yMax - yMin || 1;
    const lo = band[0] == null ? yMin : band[0];
    const hi = band[1] == null ? yMax : band[1];
    if (hi < yMin || lo > yMax) return;
    const clippedLo = Math.max(yMin, Math.min(yMax, lo));
    const clippedHi = Math.max(yMin, Math.min(yMax, hi));
    const yTop = a.y + a.h - ((clippedHi - yMin) / span) * a.h;
    const yBottom = a.y + a.h - ((clippedLo - yMin) / span) * a.h;

    ctx.save();
    ctx.fillStyle = 'rgba(80, 220, 150, 0.07)';
    ctx.fillRect(a.x, yTop, a.w, Math.max(1, yBottom - yTop));
    ctx.strokeStyle = 'rgba(80, 220, 150, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const y of [yTop, yBottom]) {
      ctx.beginPath();
      ctx.moveTo(a.x, y);
      ctx.lineTo(a.x + a.w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(100, 235, 165, 0.82)';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('END TARGET', a.x + a.w - 3, Math.max(a.y + 8, yTop + 8));
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
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    const ghost = o && o.ghost;
    // Focus health color bands (behind everything)
    if (!ghost) _drawFocusBands(ctx, a, env, [xMin, xMax]);
    const scaled = env.map(d => ({ ...d, sx_mm: (d.sigma_x || 0) * 1000, sy_mm: (d.sigma_y || 0) * 1000 }));
    const [yMin, yMax] = _chan(o, 0, [0, 1]);
    if (!ghost) _axes(ctx, a, 's (m)', 'mm', yMin, yMax);
    if (!ghost) _targetBand(ctx, a, o?.targets?.spotSizeMm, yMin, yMax);
    _line(ctx, a, scaled, 'sx_mm', '#44aaff', xMin, xMax, yMin, yMax, false, ghost);
    _line(ctx, a, scaled, 'sy_mm', '#ff6644', xMin, xMax, yMin, yMax, true, ghost);
    if (ghost) return;
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#44aaff', label: '\u03c3_x' }, { color: '#ff6644', label: '\u03c3_y' }]);
  }

  function _drawCurrentLoss(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    const ghost = o && o.ghost;
    const [yMin, yMax] = _chan(o, 0, [0, 1]);
    if (!ghost) _axes(ctx, a, 's (m)', 'mA', yMin, yMax);
    if (!ghost) _targetBand(ctx, a, o?.targets?.currentMA, yMin, yMax);
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
    _line(ctx, a, env, 'current', '#ddaa44', xMin, xMax, yMin, yMax, false, ghost);
    if (ghost) return;
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#ddaa44', label: 'Current' }]);
  }

  function _drawEmittance(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    const [yMin, yMax] = _chan(o, 0, [0, 1]);
    if (o && o.ghost) {
      _line(ctx, a, env, 'emit_nx', '#44aaff', xMin, xMax, yMin, yMax, false, true);
      _line(ctx, a, env, 'emit_ny', '#ff6644', xMin, xMax, yMin, yMax, true, true);
      return;
    }
    // Use normalized emittance — the conserved quantity
    _axes(ctx, a, 's (m)', '\u03b5_n (m\u00b7rad)', yMin, yMax);
    _line(ctx, a, env, 'emit_nx', '#44aaff', xMin, xMax, yMin, yMax, false);
    _line(ctx, a, env, 'emit_ny', '#ff6644', xMin, xMax, yMin, yMax, true);
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#44aaff', label: '\u03b5_nx' }, { color: '#ff6644', label: '\u03b5_ny' }]);
  }

  function _drawEnergyDispersion(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas);
    // Shrink plot area slightly for right axis labels
    const aR = { ...a, w: a.w - 30 };
    const [xMin, xMax] = xRange || _xRange(env);

    // Left axis: energy with smart unit scaling
    const [eMinGev, eMaxGev] = _chan(o, 0, [0, 1]);
    const eRef = Math.max(Math.abs(eMinGev), Math.abs(eMaxGev)) || 1;
    const eScale = eRef >= 1000 ? 1e-3 : eRef >= 1 ? 1 : eRef >= 1e-3 ? 1e3 : 1e6;
    const eUnit = eRef >= 1000 ? 'TeV' : eRef >= 1 ? 'GeV' : eRef >= 1e-3 ? 'MeV' : 'keV';
    const eMin = eMinGev * eScale, eMax = eMaxGev * eScale;

    // Right axis: dispersion in metres
    const [dMin, dMax] = _chan(o, 1, [0, 1]);

    if (o && o.ghost) {
      _lineScaled(ctx, aR, env, 'energy', '#44dd88', xMin, xMax, eMin, eMax, false, eScale, true);
      _line(ctx, aR, env, 'eta_x', '#ff8844', xMin, xMax, dMin, dMax, true, true);
      return;
    }

    _axesDual(ctx, aR, 's (m)', `E (${eUnit})`, eMin, eMax, '\u03b7_x (m)', dMin, dMax);
    const energyTarget = o?.targets?.energyGeV;
    _targetBand(ctx, aR,
      energyTarget ? energyTarget.map(v => v == null ? null : v * eScale) : null,
      eMin, eMax);
    _lineScaled(ctx, aR, env, 'energy', '#44dd88', xMin, xMax, eMin, eMax, false, eScale);
    _line(ctx, aR, env, 'eta_x', '#ff8844', xMin, xMax, dMin, dMax, true);
    _pinMarkers(ctx, aR, env, pins, xMin, xMax);
    _legend(ctx, aR, [{ color: '#44dd88', label: 'Energy' }, { color: '#ff8844', label: '\u03b7_x' }]);
  }

  function _drawPeakCurrent(ctx, canvas, env, pins, activePin, xRange, yScale, o) {
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    const ghost = !!(o && o.ghost);
    const vals = env.map(d => d.peak_current).filter(v => v != null && isFinite(v) && v > 0);
    if (vals.length === 0) {
      _msg(ctx, canvas, 'No peak current data', o);
      return;
    }

    // Use log scale if range spans > 2 orders of magnitude.
    // The span comes from the shared domain when there is one, so both passes of
    // a comparison pick the same mode and the same decades.
    const [minVal, maxVal] = _chan(o, 0, [Math.min(...vals), Math.max(...vals)]);
    const useLog = maxVal / Math.max(minVal, 1e-10) > 100;

    if (useLog) {
      const logMin = Math.floor(Math.log10(Math.max(minVal, 1e-3)));
      const logMax = Math.ceil(Math.log10(maxVal));
      const lMin = logMin - 0.3, lMax = logMax + 0.3;

      // Custom log axes
      if (!ghost) _logAxes(ctx, a, logMin, logMax, lMin, lMax);

      // Draw line in log space
      _strokeStyle(ctx, '#ee55ee', false, ghost);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < env.length; i++) {
        const xV = env[i].s != null ? env[i].s : i;
        const v = env[i].peak_current;
        if (v == null || !isFinite(v) || v <= 0) continue;
        const x = a.x + ((xV - xMin) / (xMax - xMin)) * a.w;
        const logV = Math.log10(v);
        const y = a.y + a.h - ((logV - lMin) / (lMax - lMin)) * a.h;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    } else {
      const [yMin, yMax] = _range([minVal, maxVal]);
      if (!ghost) _axes(ctx, a, 's (m)', 'I_peak (A)', yMin, yMax);
      _line(ctx, a, env, 'peak_current', '#ee55ee', xMin, xMax, yMin, yMax, false, ghost);
    }
    if (ghost) return;
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#ee55ee', label: 'I_peak' }]);
  }

  // Log-decade gridlines + frame + labels, factored out so a ghost pass can skip it.
  function _logAxes(ctx, a, logMin, logMax, lMin, lMax) {
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.3)'; ctx.lineWidth = 0.5;
    for (let dec = logMin; dec <= logMax; dec++) {
      const frac = (dec - lMin) / (lMax - lMin);
      const y = a.y + a.h - frac * a.h;
      ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke();
      ctx.fillStyle = 'rgba(120, 120, 160, 0.7)';
      ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillText('10^' + dec, a.x - 3, y + 3);
    }
    ctx.strokeStyle = 'rgba(80, 80, 130, 0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + a.h); ctx.lineTo(a.x + a.w, a.y + a.h); ctx.stroke();
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText('s (m)', a.x + a.w / 2, a.y + a.h + 14);
    ctx.save(); ctx.translate(8, a.y + a.h / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('I_peak (A)', 0, 0); ctx.restore();
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
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
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

    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
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
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.35)';
    ctx.lineWidth = 0.5;
    for (const frac of [0.25, 0.5, 0.75, 1.0]) {
      _eicPath(ctx, cx, cy, R, angles, [frac, frac, frac]);
      ctx.stroke();
    }

    // --- Spokes ---
    ctx.strokeStyle = 'rgba(80, 80, 130, 0.5)';
    ctx.lineWidth = 1;
    for (const a of angles) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }

    // --- Reference "par" polygon (dashed) ---
    ctx.strokeStyle = 'rgba(150, 150, 190, 0.55)';
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
    ctx.font = '10px monospace';
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
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('E / I / \u03b5  (log, par dashed)', cx, 12);
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

  return { draw, yDomainFor, unionYDomain, targetYDomain };
})();
