// === PROBE PLOT RENDERERS ===

export const ProbePlots = (() => {
  const PAD = { top: 18, right: 10, bottom: 20, left: 46 };

  function draw(canvas, type, envelope, pins, activePin, xRange, yScale) {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 10 || canvas.height < 10) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!envelope || envelope.length < 2) {
      _msg(ctx, canvas, 'No beam data');
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
    };

    const fn = fns[type];
    if (fn) fn(ctx, canvas, envelope, pins, activePin, xRange, yScale);
    else _msg(ctx, canvas, 'Unknown: ' + type);
  }

  function _msg(ctx, canvas, text) {
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

  function _lineScaled(ctx, a, data, key, color, xMin, xMax, yMin, yMax, dashed, scale) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
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

  function _line(ctx, a, data, key, color, xMin, xMax, yMin, yMax, dashed) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
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

  function _hexRgb(hex) {
    const s = hex.length === 4
      ? hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]
      : hex.slice(1);
    const n = parseInt(s, 16);
    return `${(n>>16)&255}, ${(n>>8)&255}, ${n&255}`;
  }

  // --- "Along beamline" plots ---

  function _drawBeamEnvelope(ctx, canvas, env, pins, activePin, xRange, yScale) {
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    // Focus health color bands (behind everything)
    _drawFocusBands(ctx, a, env, [xMin, xMax]);
    const scaled = env.map(d => ({ ...d, sx_mm: (d.sigma_x || 0) * 1000, sy_mm: (d.sigma_y || 0) * 1000 }));
    const [yMin, yMax] = _applyYScale(..._range(scaled.flatMap(d => [d.sx_mm, d.sy_mm])), yScale);
    _axes(ctx, a, 's (m)', 'mm', yMin, yMax);
    _line(ctx, a, scaled, 'sx_mm', '#44aaff', xMin, xMax, yMin, yMax, false);
    _line(ctx, a, scaled, 'sy_mm', '#ff6644', xMin, xMax, yMin, yMax, true);
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#44aaff', label: '\u03c3_x' }, { color: '#ff6644', label: '\u03c3_y' }]);
  }

  function _drawCurrentLoss(ctx, canvas, env, pins, activePin, xRange, yScale) {
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    const [yMin, yMax] = _applyYScale(..._range(env.map(d => d.current).filter(v => v != null)), yScale);
    _axes(ctx, a, 's (m)', 'mA', yMin, yMax);
    // Shade loss regions
    for (let i = 1; i < env.length; i++) {
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
    _line(ctx, a, env, 'current', '#ddaa44', xMin, xMax, yMin, yMax, false);
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#ddaa44', label: 'Current' }]);
  }

  function _drawEmittance(ctx, canvas, env, pins, activePin, xRange, yScale) {
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    // Use normalized emittance — the conserved quantity
    const vals = env.flatMap(d => [d.emit_nx, d.emit_ny].filter(v => v != null && isFinite(v)));
    const [yMin, yMax] = _applyYScale(..._range(vals), yScale);
    _axes(ctx, a, 's (m)', '\u03b5_n (m\u00b7rad)', yMin, yMax);
    _line(ctx, a, env, 'emit_nx', '#44aaff', xMin, xMax, yMin, yMax, false);
    _line(ctx, a, env, 'emit_ny', '#ff6644', xMin, xMax, yMin, yMax, true);
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#44aaff', label: '\u03b5_nx' }, { color: '#ff6644', label: '\u03b5_ny' }]);
  }

  function _drawEnergyDispersion(ctx, canvas, env, pins, activePin, xRange, yScale) {
    const a = _area(canvas);
    // Shrink plot area slightly for right axis labels
    const aR = { ...a, w: a.w - 30 };
    const [xMin, xMax] = xRange || _xRange(env);

    // Left axis: energy with smart unit scaling
    const eVals = env.map(d => d.energy).filter(v => v != null && isFinite(v));
    const [eMinGev, eMaxGev] = _range(eVals);
    const eRef = Math.max(Math.abs(eMinGev), Math.abs(eMaxGev)) || 1;
    const eScale = eRef >= 1000 ? 1e-3 : eRef >= 1 ? 1 : eRef >= 1e-3 ? 1e3 : 1e6;
    const eUnit = eRef >= 1000 ? 'TeV' : eRef >= 1 ? 'GeV' : eRef >= 1e-3 ? 'MeV' : 'keV';
    const eMin = eMinGev * eScale, eMax = eMaxGev * eScale;

    // Right axis: dispersion in metres
    const dVals = env.map(d => d.eta_x).filter(v => v != null && isFinite(v));
    const [dMin, dMax] = _range(dVals.length > 0 ? dVals : [0]);

    _axesDual(ctx, aR, 's (m)', `E (${eUnit})`, eMin, eMax, '\u03b7_x (m)', dMin, dMax);
    _lineScaled(ctx, aR, env, 'energy', '#44dd88', xMin, xMax, eMin, eMax, false, eScale);
    _line(ctx, aR, env, 'eta_x', '#ff8844', xMin, xMax, dMin, dMax, true);
    _pinMarkers(ctx, aR, env, pins, xMin, xMax);
    _legend(ctx, aR, [{ color: '#44dd88', label: 'Energy' }, { color: '#ff8844', label: '\u03b7_x' }]);
  }

  function _drawPeakCurrent(ctx, canvas, env, pins, activePin, xRange, yScale) {
    const a = _area(canvas);
    const [xMin, xMax] = xRange || _xRange(env);
    const vals = env.map(d => d.peak_current).filter(v => v != null && isFinite(v) && v > 0);
    if (vals.length === 0) {
      _msg(ctx, canvas, 'No peak current data');
      return;
    }

    // Use log scale if range spans > 2 orders of magnitude
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const useLog = maxVal / Math.max(minVal, 1e-10) > 100;

    if (useLog) {
      const logMin = Math.floor(Math.log10(Math.max(minVal, 1e-3)));
      const logMax = Math.ceil(Math.log10(maxVal));
      const lMin = logMin - 0.3, lMax = logMax + 0.3;

      // Custom log axes
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

      // Draw line in log space
      ctx.strokeStyle = '#ee55ee'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
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
      ctx.stroke();
    } else {
      const [yMin, yMax] = _range(vals);
      _axes(ctx, a, 's (m)', 'I_peak (A)', yMin, yMax);
      _line(ctx, a, env, 'peak_current', '#ee55ee', xMin, xMax, yMin, yMax, false);
    }
    _pinMarkers(ctx, a, env, pins, xMin, xMax);
    _legend(ctx, a, [{ color: '#ee55ee', label: 'I_peak' }]);
  }

  // --- "At this point" plots ---

  function _drawPhaseSpace(ctx, canvas, env, pins, activePin) {
    const pin = pins[activePin];
    if (!pin) { _msg(ctx, canvas, 'No pin selected'); return; }
    const d = env[pin.elementIndex];
    if (!d) { _msg(ctx, canvas, 'No data at pin'); return; }

    const w = canvas.width, h = canvas.height;
    const halfW = Math.floor((w - 20) / 2);
    const plotH = h - PAD.top - PAD.bottom;

    _drawEllipse(ctx, 10, PAD.top, halfW - 5, plotH,
      d.cov_xx, d.cov_xxp, d.cov_xpxp, pin.color, 'x', "x'", d.emit_x);
    _drawEllipse(ctx, halfW + 15, PAD.top, halfW - 5, plotH,
      d.cov_yy, d.cov_yyp, d.cov_ypyp, pin.color, 'y', "y'", d.emit_y);
  }

  function _drawEllipse(ctx, ox, oy, w, h, s11, s12, s22, color, xLbl, yLbl, emittance) {
    if (!s11 || !s22) return;
    const trace = s11 + s22;
    const det = s11 * s22 - s12 * s12;
    const disc = Math.sqrt(Math.max((trace * trace / 4) - det, 0));
    const lam1 = trace / 2 + disc;
    const lam2 = Math.max(trace / 2 - disc, 1e-30);
    const angle = Math.atan2(2 * s12, s11 - s22) / 2;

    const maxR = Math.sqrt(lam1) * 3;
    const scale = Math.min(w, h) / 2 / maxR;
    const cx = ox + w / 2, cy = oy + h / 2;

    // Crosshairs
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.4)'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ox, cy); ctx.lineTo(ox + w, cy);
    ctx.moveTo(cx, oy); ctx.lineTo(cx, oy + h);
    ctx.stroke();

    // Ellipse
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-angle);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.sqrt(lam1) * scale, Math.sqrt(lam2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${_hexRgb(color)}, 0.1)`;
    ctx.fill();
    ctx.restore();

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

  function _drawLongitudinal(ctx, canvas, env, pins, activePin) {
    const pin = pins[activePin];
    if (!pin) { _msg(ctx, canvas, 'No pin selected'); return; }
    const d = env[pin.elementIndex];
    if (!d) { _msg(ctx, canvas, 'No data at pin'); return; }

    const a = _area(canvas);
    const s44 = d.cov_tt || 1e-24, s45 = d.cov_tdE || 0, s55 = d.cov_dEdE || 1e-10;

    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const trace = s44 + s55;
    const det = s44 * s55 - s45 * s45;
    const disc = Math.sqrt(Math.max((trace * trace / 4) - det, 0));
    const lam1 = trace / 2 + disc;
    const lam2 = Math.max(trace / 2 - disc, 1e-30);
    const angle = Math.atan2(2 * s45, s44 - s55) / 2;
    const maxR = Math.sqrt(lam1) * 3;
    const scale = Math.min(a.w, a.h) / 2 / maxR;

    // Crosshairs
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.4)'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(a.x, cy); ctx.lineTo(a.x + a.w, cy);
    ctx.moveTo(cx, a.y); ctx.lineTo(cx, a.y + a.h);
    ctx.stroke();

    // Ellipse
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-angle);
    ctx.strokeStyle = pin.color; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.sqrt(lam1) * scale, Math.sqrt(lam2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${_hexRgb(pin.color)}, 0.1)`;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText('dt (s)', a.x + a.w / 2, a.y + a.h + 14);
    ctx.fillText(`\u03c3t=${Math.sqrt(s44).toExponential(1)} \u03c3E=${Math.sqrt(s55).toExponential(1)}`,
      a.x + a.w / 2, a.y - 3);
  }

  return { draw };
})();
