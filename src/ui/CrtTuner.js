// src/ui/CrtTuner.js — dev-only slider panel for dialling in the CRT look on
// the welcome screen. Mounted by TitleScreen behind `import.meta.env.DEV`, so
// none of this ships in a production build. F9 hides it without a reload.
//
// Four groups of knobs:
//   • GEOMETRY — the canvas barrel warp (src/ui/crtWarp.js).
//   • OVERLAY  — the <crt-effect> component's painted layers. Its "curvature"
//     attribute is not geometry: it's a black radial gradient, i.e. pure edge
//     darkening. All actual bend lives in the GEOMETRY group.
//   • MOTION   — the animated layers: rolling sweep bar, flicker, glitch.
//
// Values persist to localStorage, and "COPY VALUES" puts a paste-ready snippet
// on the clipboard for baking the final numbers back into TitleScreen.

const STORE_KEY = 'bl:crtTuner';

// [key, label, min, max, step] — barrel handle properties.
const GEOMETRY_KNOBS = [
  ['bulge', 'bulge', 0, 0.2, 0.002],
  ['corner', 'corner bias', 0, 1, 0.01],
  // Below 2 the tube edge stops being cropped and starts showing as a curved
  // black bezel — a legitimate look, so the slider goes all the way down.
  ['overscanPad', 'overscan', 0, 4, 0.05],
  // Drawn pre-warp in the canvas, so it follows the curved glass. The
  // <crt-effect> component's own edge glow is a DOM box-shadow and traces the
  // rectangular screen edge instead, which is wrong once the bend lives in the
  // canvas — that's why this lives here and not in the OVERLAY group.
  ['glow', 'edge glow', 0, 1, 0.01],
  ['glowSize', 'glow depth', 1, 40, 1],
];

// [attribute, label, min, max, step, default] — <crt-effect> numeric attributes.
// Defaults mirror the values baked into TitleScreen's crtAttrs, so opening the
// panel starts from the shipped look rather than jolting it somewhere else.
const OVERLAY_KNOBS = [
  ['curvature-intensity', 'edge darken', 0, 1, 0.01, 0.43],
  ['vignette-intensity', 'vignette', 0, 0.8, 0.01, 0.23],
  ['glare-intensity', 'glare', 0, 0.6, 0.01, 0.14],
  ['noise-opacity', 'noise', 0, 0.3, 0.005, 0.09],
  ['scanline-opacity', 'scanlines', 0, 0.6, 0.01, 0.11],
  ['scanline-thickness', 'scan thick', 1, 8, 1, 4],
  ['scanline-gap', 'scan gap', 1, 10, 1, 3],
];

const MOTION_KNOBS = [
  // Seconds for one top-to-bottom pass: lower is a faster roll.
  ['sweep-duration', 'sweep secs', 1, 20, 0.5, 9],
  ['sweep-thickness', 'sweep thick', 2, 200, 2, 48],
  ['flicker-intensity', 'flicker', 0, 0.3, 0.005, 0.08],
  ['flicker-speed', 'flicker secs', 0.1, 3, 0.05, 0.8],
  ['glitch-intensity', 'glitch', 0, 1, 0.01, 0],
];

// Layers the component only paints when the matching enable- flag is present,
// so a slider dragged above zero has to switch its layer on.
const GATED = {
  'noise-opacity': 'enable-noise',
  'vignette-intensity': 'enable-vignette',
  'curvature-intensity': 'enable-curvature',
  'glare-intensity': 'enable-glare',
  'glitch-intensity': 'enable-glitch',
  'flicker-intensity': 'enable-flicker',
};

// [attribute, label, default] — plain on/off flags.
const TOGGLES = [
  ['enable-sweep', 'sweep bar', true],
  ['enable-scanlines', 'scanlines', true],
  ['glitch-chromatic', 'rgb split (needs glitch)', false],
];

const decimals = (step) => (step < 0.01 ? 3 : step < 1 ? 2 : 0);

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * @param {object}      opts
 * @param {object}      opts.warp    handle returned by createCrtWarp()
 * @param {HTMLElement} opts.crtEl   the <crt-effect> overlay element
 */
export function createCrtTuner({ warp, crtEl }) {
  const saved = loadSaved();
  const geom = { ...warp.get(), ...(saved.geom || {}) };
  const attrs = {};
  for (const [attr, , , , , def] of [...OVERLAY_KNOBS, ...MOTION_KNOBS]) {
    attrs[attr] = saved.attrs?.[attr] ?? def;
  }
  const flags = {};
  for (const [attr, , def] of TOGGLES) flags[attr] = saved.flags?.[attr] ?? def;

  const applyAttrs = () => {
    for (const [attr, value] of Object.entries(attrs)) {
      crtEl.setAttribute(attr, String(value));
      const gate = GATED[attr];
      if (gate) {
        if (value > 0) crtEl.setAttribute(gate, '');
        else crtEl.removeAttribute(gate);
      }
    }
    for (const [attr, on] of Object.entries(flags)) {
      if (on) crtEl.setAttribute(attr, '');
      else crtEl.removeAttribute(attr);
    }
  };
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ geom, attrs, flags }));
    } catch {
      /* storage unavailable — tuning still works, just doesn't persist */
    }
  };

  const el = document.createElement('div');
  el.id = 'crt-tuner';
  el.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:99999',
    'width:250px', 'padding:10px 12px 12px',
    'background:rgba(10,14,18,0.93)', 'border:1px solid #3c4b5a', 'border-radius:6px',
    'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace', 'color:#cfe3f2',
    'box-shadow:0 6px 24px rgba(0,0,0,0.5)', 'user-select:none',
    'max-height:calc(100vh - 24px)', 'overflow:auto',
  ].join(';');
  // The title screen listens for pointerdown anywhere to start the music /
  // reveal the menu; tuning must not count as that click.
  for (const type of ['pointerdown', 'click']) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;letter-spacing:0.08em;color:#8fd3ff;';
  header.innerHTML = '<span>CRT TUNER · dev</span>';
  const hide = document.createElement('button');
  hide.textContent = '×';
  hide.title = 'hide (F9 to toggle)';
  hide.style.cssText = 'background:none;border:none;color:#8fa8bd;font-size:15px;cursor:pointer;padding:0 2px;';
  hide.addEventListener('click', () => { el.style.display = 'none'; });
  header.appendChild(hide);
  el.appendChild(header);

  const section = (label) => {
    const h = document.createElement('div');
    h.textContent = label;
    h.style.cssText = 'margin:9px 0 3px;color:#7f97ab;border-top:1px solid #2a3742;padding-top:5px;letter-spacing:0.06em;';
    el.appendChild(h);
  };

  const addSlider = (label, value, min, max, step, onInput) => {
    const row = document.createElement('div');
    row.style.cssText = 'margin:4px 0;';
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;';
    const name = document.createElement('span');
    name.textContent = label;
    const out = document.createElement('span');
    out.style.color = '#ffd479';
    out.textContent = Number(value).toFixed(decimals(step));
    top.append(name, out);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText = 'width:100%;margin:1px 0 0;accent-color:#8fd3ff;cursor:pointer;';
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = v.toFixed(decimals(step));
      onInput(v);
    });
    row.append(top, input);
    el.appendChild(row);
  };

  section('GEOMETRY — real bend');
  for (const [key, label, min, max, step] of GEOMETRY_KNOBS) {
    addSlider(label, geom[key], min, max, step, (v) => {
      geom[key] = v;
      warp.set({ [key]: v });
      save();
    });
  }

  section('OVERLAY — painted layers');
  for (const [attr, label, min, max, step] of OVERLAY_KNOBS) {
    addSlider(label, attrs[attr], min, max, step, (v) => {
      attrs[attr] = v;
      applyAttrs();
      save();
    });
  }

  section('MOTION — animated layers');
  for (const [attr, label, min, max, step] of MOTION_KNOBS) {
    addSlider(label, attrs[attr], min, max, step, (v) => {
      attrs[attr] = v;
      applyAttrs();
      save();
    });
  }

  section('TOGGLES');
  for (const [attr, label] of TOGGLES) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:3px 0;cursor:pointer;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = flags[attr];
    box.style.accentColor = '#8fd3ff';
    box.addEventListener('change', () => {
      flags[attr] = box.checked;
      applyAttrs();
      save();
    });
    row.append(box, document.createTextNode(label));
    el.appendChild(row);
  }

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:6px;margin-top:10px;';
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'flex:1;background:#1d2a35;border:1px solid #3c4b5a;color:#cfe3f2;font:inherit;padding:4px 0;border-radius:3px;cursor:pointer;';
    b.addEventListener('click', fn);
    buttons.appendChild(b);
    return b;
  };
  const copyBtn = mkBtn('COPY VALUES', async () => {
    const snippet = [
      '// crtWarp',
      `createCrtWarp(${JSON.stringify(geom, null, 2)});`,
      '// crt-effect attributes',
      ...Object.entries(attrs).map(([k, v]) => `'${k}': '${v}',`),
      ...Object.entries(flags).filter(([, on]) => on).map(([k]) => `'${k}': '',`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(snippet);
      copyBtn.textContent = 'COPIED';
      setTimeout(() => { copyBtn.textContent = 'COPY VALUES'; }, 1200);
    } catch {
      console.log(snippet);
      copyBtn.textContent = 'SEE CONSOLE';
      setTimeout(() => { copyBtn.textContent = 'COPY VALUES'; }, 1600);
    }
  });
  mkBtn('RESET', () => {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch { /* ignore */ }
    location.reload();
  });
  el.appendChild(buttons);

  const onKey = (e) => {
    if (e.key === 'F9') el.style.display = el.style.display === 'none' ? '' : 'none';
  };
  window.addEventListener('keydown', onKey);

  applyAttrs();
  warp.set(geom);
  document.body.appendChild(el);

  return {
    el,
    dispose() {
      window.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
