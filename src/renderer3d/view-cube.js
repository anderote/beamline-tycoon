// src/renderer3d/view-cube.js
//
// Live mini view-cube widget. Mirrors the main camera's yaw/pitch in a small
// cached Canvas2D projection so orientation controls do not need a second GPU
// context or another copy of Three's classic renderer.
// Click semantics:
//   - top face         -> setViewMode('top', currentTopYawIdx)
//   - side faces (4)   -> setViewMode('iso', faceYawIdx)
//   - compass ring N/E/S/W -> snap yaw within the *current* mode (no mode change)
//
// Face-to-yaw mapping is fixed at construction. The cube has 6 unit faces;
// the four side faces map to the four cardinal yaw indices so that clicking
// the visible face directly facing you snaps the camera to that direction.
//
// THREE is a CDN global — do NOT import it.

import {
  cameraOffset,
  PITCH_REST,
} from './free-orbit-math.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Side-face mapping. Keys are the cube's local face axes, values are the
// yaw index that produces an iso view facing that face.
//
// Derivation: at yaw=0, the camera sits at +X+Z looking toward -X-Z, so the
// +X cube face is visible (labelled "E"). Iso now snaps in 8 divisions of
// π/4 (matching top-down), so a full +π/2 turn is 2 steps: rotating yaw by
// +π/2 moves the camera to +X-Z (visible faces +X and -Z; -Z labelled "S").
// The cube has only 4 side faces, so it only ever addresses the 4 cardinal
// (even) yaw indices — the 4 odd, diagonal indices are reachable via the
// Q/E rotate keys but have no corresponding cube face.
export const FACE_TO_YAW = {
  posX: 0,  // East
  negZ: 2,  // South
  negX: 4,  // West
  posZ: 6,  // North
};

// Top face renders a cross icon instead of a text label; encoded as a
// sentinel that makeFaceTexture recognises.
const FACE_LABELS = {
  posX: 'E',
  negZ: 'S',
  negX: 'W',
  posZ: 'N',
  posY: '__cross__',
  negY: '',
};

const CUBE_CANVAS_PX = 86;

const CUBE_FACES = [
  { id: 'posX', normal: [1, 0, 0], verts: [[1,-1,-1],[1,-1,1],[1,1,1],[1,1,-1]] },
  { id: 'negX', normal: [-1, 0, 0], verts: [[-1,-1,1],[-1,-1,-1],[-1,1,-1],[-1,1,1]] },
  { id: 'posY', normal: [0, 1, 0], verts: [[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]] },
  { id: 'negY', normal: [0, -1, 0], verts: [[-1,-1,1],[1,-1,1],[1,-1,-1],[-1,-1,-1]] },
  { id: 'posZ', normal: [0, 0, 1], verts: [[1,-1,1],[-1,-1,1],[-1,1,1],[1,1,1]] },
  { id: 'negZ', normal: [0, 0, -1], verts: [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1]] },
];

export class ViewCube {
  constructor(renderer, hostEl) {
    this.renderer = renderer; // ThreeRenderer
    this.host = hostEl;
    this._hoveredFace = null;

    this._buildDom();
    this._buildScene();
    this._bindEvents();
  }

  _buildDom() {
    this.host.innerHTML = '';
    this.host.classList.add('view-cube-host');

    this.cubeCanvas = document.createElement('canvas');
    this.cubeCanvas.className = 'vc-cube-canvas';
    this.cubeCanvas.style.width = CUBE_CANVAS_PX + 'px';
    this.cubeCanvas.style.height = CUBE_CANVAS_PX + 'px';
    this.host.appendChild(this.cubeCanvas);

    // Q / E rotate arrows: two short ~30° arc segments below the cube on
    // an imaginary rotation circle around the cube's vertical axis. Each
    // segment ends in a small tangent-aligned arrowhead.
    const svg = svgEl('svg', {
      class: 'vc-rotate-bar',
      viewBox: '0 0 96 22',
      width: '96',
      height: '22',
    });
    // Both arrows are 30° segments on the SAME imaginary circle. The circle
    // is centered horizontally over the cube (CX = 48) and sized at 1.2x
    // the cube canvas radius — so the visible arcs feel like they're
    // wrapping a pedestal slightly larger than the cube. Center is above
    // the SVG so the circle's lowest 30°-each on each side dips in.
    const CX = 48, CY = -36, R = 58;
    const makeArrow = (dir, label) => {
      // dir = -1 → Q (counterclockwise / left); +1 → E (clockwise / right).
      // Q: 105° → 135°. E: 75° → 45°. Gap of 30° centered at the bottom.
      const g = svgEl('g', { class: `vc-rot vc-rot-${label.toLowerCase()}` });
      const startDeg = dir < 0 ? 105 : 75;
      const endDeg = dir < 0 ? 135 : 45;
      const ccw = dir < 0;
      const sweep = ccw ? 1 : 0; // SVG sweep flag in Y-down system
      const sx = CX + R * Math.cos(startDeg * Math.PI / 180);
      const sy = CY + R * Math.sin(startDeg * Math.PI / 180);
      const ex = CX + R * Math.cos(endDeg * Math.PI / 180);
      const ey = CY + R * Math.sin(endDeg * Math.PI / 180);
      const arcD = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${R} ${R} 0 0 ${sweep} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
      // Invisible fat-stroke hit target along the arc. Uses stroke-opacity:0
      // so the visible-arc hover CSS (which sets `stroke`) doesn't make it
      // appear. `pointer-events: stroke` makes the entire stroked band
      // clickable regardless of opacity.
      const hit = svgEl('path', {
        d: arcD,
        fill: 'none',
        stroke: '#000',
        'stroke-opacity': '0',
        'stroke-width': '14',
        'stroke-linecap': 'round',
        'pointer-events': 'stroke',
      });
      const arc = svgEl('path', {
        d: arcD,
        fill: 'none',
        'stroke-linecap': 'round',
        'pointer-events': 'none',
      });
      // Arrowhead at the arc endpoint, oriented along the tangent.
      const a = endDeg * Math.PI / 180;
      const tx = ccw ? -Math.sin(a) : Math.sin(a);
      const ty = ccw ?  Math.cos(a) : -Math.cos(a);
      const HL = 5.4, HW = 2.6;
      const baseX = ex - tx * HL;
      const baseY = ey - ty * HL;
      const px = -ty, py = tx; // perpendicular
      const b1x = baseX + px * HW, b1y = baseY + py * HW;
      const b2x = baseX - px * HW, b2y = baseY - py * HW;
      const head = svgEl('polygon', {
        points: `${ex.toFixed(2)},${ey.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)} ${b2x.toFixed(2)},${b2y.toFixed(2)}`,
        'pointer-events': 'none',
      });
      // Labels at the outer corners of the arrow band, away from the arc
      // tips which now reach near the SVG's left/right edges at the top.
      const text = svgEl('text', {
        x: dir < 0 ? 2 : 94,
        y: 20,
        'text-anchor': dir < 0 ? 'start' : 'end',
        class: 'vc-rot-label',
        'pointer-events': 'none',
      });
      text.textContent = label;
      // Invisible rect over the label corner so clicking the Q/E text also
      // triggers rotation. Placed at outer ~22px corner of the SVG.
      const labelHit = svgEl('rect', {
        x: dir < 0 ? 0 : 74,
        y: 8,
        width: 22,
        height: 14,
        fill: '#000',
        'fill-opacity': '0',
        'pointer-events': 'all',
      });
      g.appendChild(hit);
      g.appendChild(labelHit);
      g.appendChild(arc);
      g.appendChild(head);
      g.appendChild(text);
      g.addEventListener('click', () => this.renderer.rotateView(dir));
      return g;
    };
    svg.appendChild(makeArrow(-1, 'Q'));
    svg.appendChild(makeArrow(+1, 'E'));
    this.host.appendChild(svg);
  }

  _buildScene() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cubeCanvas.width = Math.round(CUBE_CANVAS_PX * dpr);
    this.cubeCanvas.height = Math.round(CUBE_CANVAS_PX * dpr);
    this.ctx = this.cubeCanvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._facePolygons = [];
    this._drawSig = null;
  }

  _bindEvents() {
    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onClick = this._onClick.bind(this);
    this.cubeCanvas.addEventListener('pointermove', this._onMove);
    this.cubeCanvas.addEventListener('pointerleave', this._onLeave);
    this.cubeCanvas.addEventListener('click', this._onClick);
  }

  _onMove(e) {
    const face = this._faceAtPointer(e);
    if (face === this._hoveredFace) return;
    this._hoveredFace = face;
    this._updateHoverHighlight();
  }

  _onLeave() {
    if (this._hoveredFace === null) return;
    this._hoveredFace = null;
    this._updateHoverHighlight();
  }

  _onClick(e) {
    const face = this._faceAtPointer(e);
    if (!face) return;
    if (face === 'posY') {
      // Toggle between the cube's two primary faces. The middle-click control
      // cycles all three preferred elevations, including the steeper view.
      if (this.renderer.viewMode === 'top') {
        this.renderer.setViewMode('iso', this.renderer._isoYawIdx);
      } else {
        this.renderer.setViewMode('top', this.renderer._topYawIdx);
      }
    } else if (FACE_TO_YAW[face] !== undefined) {
      this.renderer.setViewMode('iso', FACE_TO_YAW[face]);
    }
  }

  _faceAtPointer(e) {
    const rect = this.cubeCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * CUBE_CANVAS_PX / rect.width;
    const y = (e.clientY - rect.top) * CUBE_CANVAS_PX / rect.height;
    // Polygons are stored back-to-front; test the visible frontmost face first.
    for (let i = this._facePolygons.length - 1; i >= 0; i--) {
      const face = this._facePolygons[i];
      if (pointInPolygon(x, y, face.points)) return face.id;
    }
    return null;
  }

  _updateHoverHighlight() {
    this._drawSig = null;
    this.update();
  }

  /**
   * Per-frame: place mirror camera to match main camera yaw/pitch, render
   * the cube, and update compass-ring active direction.
   */
  update() {
    const yaw = this.renderer._effectiveYaw();
    const pitch = this.renderer._effectivePitch();
    const sig = `${yaw.toFixed(4)}|${pitch.toFixed(4)}|${this._hoveredFace || ''}`;
    if (sig === this._drawSig) return;
    this._drawSig = sig;
    const off = cameraOffset(yaw, pitch);
    this._drawCube(off);
  }

  _drawCube(camera) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, CUBE_CANVAS_PX, CUBE_CANVAS_PX);

    const length = Math.hypot(camera.x, camera.y, camera.z) || 1;
    const forward = { x: -camera.x / length, y: -camera.y / length, z: -camera.z / length };
    let right = { x: -forward.z, y: 0, z: forward.x };
    const rightLen = Math.hypot(right.x, right.z) || 1;
    right = { x: right.x / rightLen, y: 0, z: right.z / rightLen };
    const up = {
      x: right.y * forward.z - right.z * forward.y,
      y: right.z * forward.x - right.x * forward.z,
      z: right.x * forward.y - right.y * forward.x,
    };
    const project = ([x, y, z]) => ({
      x: CUBE_CANVAS_PX / 2 + (x * right.x + y * right.y + z * right.z) * 21,
      y: CUBE_CANVAS_PX / 2 - (x * up.x + y * up.y + z * up.z) * 21,
      depth: x * forward.x + y * forward.y + z * forward.z,
    });

    const visible = CUBE_FACES.filter((face) =>
      face.normal[0] * camera.x + face.normal[1] * camera.y + face.normal[2] * camera.z > 0
    ).map((face) => {
      const points = face.verts.map(project);
      return { ...face, points, depth: points.reduce((sum, p) => sum + p.depth, 0) / points.length };
    }).sort((a, b) => a.depth - b.depth);

    this._facePolygons = visible;
    for (const face of visible) {
      const light = Math.max(0, face.normal[0] * 0.35 + face.normal[1] * 0.8 + face.normal[2] * 0.45);
      const base = face.id === this._hoveredFace ? 232 : 205 + Math.round(light * 25);
      ctx.beginPath();
      ctx.moveTo(face.points[0].x, face.points[0].y);
      for (let i = 1; i < face.points.length; i++) ctx.lineTo(face.points[i].x, face.points[i].y);
      ctx.closePath();
      ctx.fillStyle = `rgb(${base},${base - 2},${base - 10})`;
      ctx.fill();
      ctx.strokeStyle = face.id === this._hoveredFace ? '#6bdcff' : '#2a2a3a';
      ctx.lineWidth = face.id === this._hoveredFace ? 2 : 1.2;
      ctx.stroke();

      const cx = face.points.reduce((sum, p) => sum + p.x, 0) / face.points.length;
      const cy = face.points.reduce((sum, p) => sum + p.y, 0) / face.points.length;
      const label = FACE_LABELS[face.id];
      ctx.fillStyle = '#1a1a2e';
      ctx.strokeStyle = '#1a1a2e';
      if (label === '__cross__') {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
        ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
        ctx.stroke();
      } else if (label) {
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, cy + 1);
      }
    }
  }

  dispose() {
    this.cubeCanvas.removeEventListener('pointermove', this._onMove);
    this.cubeCanvas.removeEventListener('pointerleave', this._onLeave);
    this.cubeCanvas.removeEventListener('click', this._onClick);
    this._facePolygons = [];
    this.ctx = null;
    this.host.innerHTML = '';
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    const crosses = ((a.y > y) !== (b.y > y))
      && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
