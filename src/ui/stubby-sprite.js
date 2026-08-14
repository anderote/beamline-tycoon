// src/ui/stubby-sprite.js — Stubby, drawn.
//
// A three-stub tuner is a straight run of rectangular waveguide with three
// adjustable stubs standing off one broad wall; you screw them in and out to
// match a load. That makes it the right character for an advisor — its whole
// job is getting the coupling right — and the three stubs give it a face's
// worth of expression before you draw a face at all.
//
// Drawn in the idiom of UIHost.drawSchematic: a tiny canvas, px()/dot()
// helpers, a fixed palette, scaled up with image-rendering: pixelated. No
// image assets. The palette is local rather than shared with drawSchematic's,
// which is private to that function — duplicating six colours costs less than
// widening that interface for one caller.
//
// Pixely 3-D: light on the top face, mid on the front, dark on the right, with
// a one-pixel highlight along the top-front edge. Light comes from up-left,
// matching the rest of the game's art.

export const STUBBY_W = 40;
export const STUBBY_H = 40;

/** The frames Stubby can be in. `idle` is the resting pose. */
export const STUBBY_FRAMES = ['idle', 'alert', 'talk', 'pleased'];

const C = {
  bodyTop:   '#8fa2b8',   // lit top face
  bodyFront: '#6a7d94',   // front face
  bodySide:  '#465768',   // shaded right face
  edge:      '#b3c4d6',   // top-front highlight
  outline:   '#26303c',
  stub:      '#c9a227',   // brass tuning stubs
  stubHi:    '#e8c860',
  stubDk:    '#8a6f18',
  flangeDk:  '#3b4a5a',
  eye:       '#1a2028',
  eyeWhite:  '#e6eef7',
  mouth:     '#1a2028',
  blush:     '#c46a6a',
};

/** Stub heights per frame — the stubs ARE the expression. Index 0 is left. */
const STUB_HEIGHTS = {
  idle:    [6, 8, 6],
  alert:   [10, 12, 10],   // all three shoot up
  talk:    [7, 10, 6],     // mid stub bobs
  pleased: [9, 7, 9],      // outer two lift, a shrug
};

/**
 * Draw Stubby onto a canvas at native pixel size.
 *
 * The canvas is sized to STUBBY_W x STUBBY_H; scale it up in CSS with
 * image-rendering: pixelated so the pixels stay square.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{frame?: string}} opts
 */
export function drawStubby(canvas, opts = {}) {
  if (!canvas) return;
  const frame = STUBBY_FRAMES.includes(opts.frame) ? opts.frame : 'idle';

  canvas.width = STUBBY_W;
  canvas.height = STUBBY_H;
  const p = canvas.getContext('2d');
  if (!p) return;
  p.imageSmoothingEnabled = false;
  p.clearRect(0, 0, STUBBY_W, STUBBY_H);

  const px = (x, y, w, h, color) => { p.fillStyle = color; p.fillRect(x, y, w, h); };
  const dot = (x, y, color) => px(x, y, 1, 1, color);

  const heights = STUB_HEIGHTS[frame];

  // --- Waveguide body -----------------------------------------------------
  // The top face is a parallelogram sheared right to read as depth without a
  // real projection. bodyR is bounded by that shear, not by the front face:
  // the shaded right face reaches bodyR + maxShift + 2, so bodyR above 34
  // pushes it off a 40 px canvas and clips once the sprite is scaled up.
  const bodyL = 4, bodyR = 34, frontT = 20, frontB = 34;

  // Top face: each row shifts one pixel right for every two rows of depth.
  for (let i = 0; i < 6; i++) {
    const shift = Math.floor((6 - i) * 0.7);
    px(bodyL + shift, frontT - 6 + i, bodyR - bodyL, 1, C.bodyTop);
  }
  // Right (shaded) face, following the same shear.
  for (let i = 0; i < 6; i++) {
    const shift = Math.floor((6 - i) * 0.7);
    px(bodyR + shift - 1, frontT - 6 + i, 3, 1, C.bodySide);
  }
  px(bodyR, frontT, 3, frontB - frontT, C.bodySide);

  // Front face.
  px(bodyL, frontT, bodyR - bodyL, frontB - frontT, C.bodyFront);
  // Highlight along the top-front edge.
  px(bodyL, frontT, bodyR - bodyL, 1, C.edge);

  // End flanges — the bolted plates a waveguide run joins through.
  px(bodyL - 2, frontT - 2, 3, frontB - frontT + 4, C.flangeDk);
  px(bodyR - 1, frontT - 2, 3, frontB - frontT + 4, C.flangeDk);
  for (let y = frontT; y < frontB; y += 4) {
    dot(bodyL - 1, y, C.bodyTop);
    dot(bodyR, y, C.bodyTop);
  }

  // Outline.
  px(bodyL - 2, frontB, bodyR - bodyL + 6, 1, C.outline);
  px(bodyL - 3, frontT - 2, 1, frontB - frontT + 3, C.outline);

  // --- The three tuning stubs --------------------------------------------
  const stubXs = [10, 19, 28];
  for (let i = 0; i < 3; i++) {
    const sx = stubXs[i];
    const h = heights[i];
    const topY = frontT - 4 - h;
    // Shaft: 3 px wide, lit on the left, shaded on the right.
    px(sx, topY, 1, h, C.stubHi);
    px(sx + 1, topY, 1, h, C.stub);
    px(sx + 2, topY, 1, h, C.stubDk);
    // Knurled cap.
    px(sx - 1, topY - 3, 5, 3, C.stub);
    px(sx - 1, topY - 3, 5, 1, C.stubHi);
    px(sx - 1, topY - 1, 5, 1, C.stubDk);
    dot(sx, topY - 2, C.stubHi);
    dot(sx + 2, topY - 2, C.stubDk);
    // Where the stub enters the guide.
    px(sx - 1, frontT - 4, 5, 2, C.bodySide);
  }

  // --- Face ---------------------------------------------------------------
  const eyeY = frontT + 4;
  // Eyes are 4 px wide with a 2 px pupil so there is a pixel of white either
  // side; a 3 px white cannot centre a 2 px pupil and the gaze reads as a
  // squint. Their midpoint sits on the body centreline (bodyL..bodyR = 4..34).
  if (frame === 'alert') {
    px(11, eyeY - 1, 4, 4, C.eyeWhite);
    px(23, eyeY - 1, 4, 4, C.eyeWhite);
    px(12, eyeY, 2, 2, C.eye);
    px(24, eyeY, 2, 2, C.eye);
  } else if (frame === 'pleased') {
    // Happy arcs.
    px(11, eyeY + 1, 1, 1, C.eye);
    px(12, eyeY, 2, 1, C.eye);
    px(14, eyeY + 1, 1, 1, C.eye);
    px(23, eyeY + 1, 1, 1, C.eye);
    px(24, eyeY, 2, 1, C.eye);
    px(26, eyeY + 1, 1, 1, C.eye);
    dot(9, eyeY + 3, C.blush);
    dot(28, eyeY + 3, C.blush);
  } else {
    px(11, eyeY, 4, 3, C.eyeWhite);
    px(23, eyeY, 4, 3, C.eyeWhite);
    px(12, eyeY + 1, 2, 2, C.eye);
    px(24, eyeY + 1, 2, 2, C.eye);
  }

  const mouthY = frontT + 9;
  if (frame === 'talk') {
    px(17, mouthY - 1, 5, 4, C.mouth);
    px(18, mouthY, 3, 2, '#5a2a2a');
  } else if (frame === 'pleased') {
    px(17, mouthY, 1, 1, C.mouth);
    px(18, mouthY + 1, 4, 1, C.mouth);
    px(22, mouthY, 1, 1, C.mouth);
  } else if (frame === 'alert') {
    px(18, mouthY, 4, 2, C.mouth);
  } else {
    px(18, mouthY, 4, 1, C.mouth);
  }
}
