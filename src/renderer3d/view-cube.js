// src/renderer3d/view-cube.js
//
// Live mini view-cube widget. Mirrors the main camera's yaw/pitch in a
// small WebGL canvas so the player always sees the current orientation.
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
// +X cube face is visible (labelled "E"). Rotating yaw by +π/2 moves the
// camera to +X-Z (visible faces +X and -Z; -Z labelled "S"). And so on.
const FACE_TO_YAW = {
  posX: 0,  // East
  negZ: 1,  // South
  negX: 2,  // West
  posZ: 3,  // North
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

// Material order for THREE.BoxGeometry: [+X, -X, +Y, -Y, +Z, -Z].
const FACE_MAT_ORDER = ['posX', 'negX', 'posY', 'negY', 'posZ', 'negZ'];

const CUBE_CANVAS_PX = 64;
const CUBE_RADIUS = 2.4; // distance from cube center for the mirror camera

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

    // Q / E rotate arrows: two curved arcs wrapping around the base of the
    // cube. Click → renderer.rotateView(±1).
    const svg = svgEl('svg', {
      class: 'vc-rotate-bar',
      viewBox: '0 0 80 22',
      width: '80',
      height: '22',
    });
    const makeArrow = (dir, label) => {
      // dir = -1 for Q (counterclockwise, left), +1 for E (clockwise, right).
      const g = svgEl('g', { class: `vc-rot vc-rot-${label.toLowerCase()}` });
      const sweep = dir < 0 ? 0 : 1;
      const startX = dir < 0 ? 36 : 44;
      const endX = dir < 0 ? 10 : 70;
      const arc = svgEl('path', {
        d: `M ${startX} 2 A 22 18 0 0 ${sweep} ${endX} 18`,
        fill: 'none',
        'stroke-linecap': 'round',
      });
      // Arrowhead — small triangle at the arc endpoint pointing tangent.
      const headPts = dir < 0
        ? `${endX},${18} ${endX + 6},${14} ${endX + 6},${22}`
        : `${endX},${18} ${endX - 6},${14} ${endX - 6},${22}`;
      const head = svgEl('polygon', { points: headPts });
      const text = svgEl('text', {
        x: dir < 0 ? 1 : 79,
        y: 10,
        'text-anchor': dir < 0 ? 'start' : 'end',
        class: 'vc-rot-label',
      });
      text.textContent = label;
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
    this.scene = new THREE.Scene();

    // Ortho camera tracking main camera's yaw/pitch at fixed radius.
    const aspect = 1;
    const fs = 3.0;
    this.camera = new THREE.OrthographicCamera(
      -fs * aspect / 2, fs * aspect / 2,
       fs / 2,         -fs / 2,
       0.1, 100
    );

    // Lights: soft ambient + a directional from the camera's general
    // direction so faces have subtle shading.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2, 3, 2);
    this.scene.add(dir);

    // Build textured materials for the 6 faces.
    this.materials = FACE_MAT_ORDER.map((face) => {
      const tex = makeFaceTexture(FACE_LABELS[face]);
      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        emissive: 0x000000,
      });
      mat.userData = { face, baseEmissive: 0x000000 };
      return mat;
    });

    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.cube = new THREE.Mesh(geo, this.materials);
    this.scene.add(this.cube);

    // Renderer (separate WebGL context, transparent background).
    this.cubeRenderer = new THREE.WebGLRenderer({
      canvas: this.cubeCanvas,
      alpha: true,
      antialias: true,
    });
    this.cubeRenderer.setPixelRatio(window.devicePixelRatio || 1);
    this.cubeRenderer.setSize(CUBE_CANVAS_PX, CUBE_CANVAS_PX, false);
    this.cubeRenderer.setClearColor(0x000000, 0);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
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
      // Toggle: in top-down → back to iso (last iso facing); else → top-down.
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
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.cube, false);
    if (hits.length === 0) return null;
    // Each BoxGeometry face uses the material at the order in FACE_MAT_ORDER.
    const matIdx = hits[0].face.materialIndex;
    return FACE_MAT_ORDER[matIdx] || null;
  }

  _updateHoverHighlight() {
    for (const mat of this.materials) {
      const isHover = mat.userData.face === this._hoveredFace;
      mat.emissive.setHex(isHover ? 0x444444 : mat.userData.baseEmissive);
      mat.needsUpdate = true;
    }
  }

  /**
   * Per-frame: place mirror camera to match main camera yaw/pitch, render
   * the cube, and update compass-ring active direction.
   */
  update() {
    const yaw = this.renderer._effectiveYaw();
    const pitch = this.renderer._effectivePitch();
    const off = cameraOffset(yaw, pitch);
    const scale = CUBE_RADIUS / Math.hypot(off.x, off.y, off.z);
    this.camera.position.set(off.x * scale, off.y * scale, off.z * scale);
    this.camera.lookAt(0, 0, 0);
    this.cubeRenderer.render(this.scene, this.camera);
  }

  dispose() {
    this.cubeCanvas.removeEventListener('pointermove', this._onMove);
    this.cubeCanvas.removeEventListener('pointerleave', this._onLeave);
    this.cubeCanvas.removeEventListener('click', this._onClick);
    if (this.cube) {
      this.cube.geometry.dispose();
      for (const mat of this.materials) {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    }
    if (this.cubeRenderer) this.cubeRenderer.dispose();
    this.host.innerHTML = '';
  }
}

function makeFaceTexture(label) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  // Slightly off-white face with a thin dark border so faces are visually
  // separable when adjacent in projection.
  ctx.fillStyle = '#e8e6dd';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#2a2a3a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  if (label === '__cross__') {
    // Plus-sign / cross glyph for the top face.
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 14;
    ctx.lineCap = 'square';
    const pad = 30;
    ctx.beginPath();
    ctx.moveTo(size / 2, pad); ctx.lineTo(size / 2, size - pad);
    ctx.moveTo(pad, size / 2); ctx.lineTo(size - pad, size / 2);
    ctx.stroke();
  } else if (label) {
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, size / 2, size / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
