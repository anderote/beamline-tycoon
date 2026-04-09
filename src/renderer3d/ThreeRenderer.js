// src/renderer3d/ThreeRenderer.js — Three.js scaffold with isometric camera
// THREE is loaded as a CDN global — do NOT import it

import { TextureManager } from './texture-manager.js';
import { TerrainBuilder } from './terrain-builder.js';
import { InfraBuilder } from './infra-builder.js';
import { WallBuilder } from './wall-builder.js';
import { ComponentBuilder } from './component-builder.js';
import { BeamBuilder } from './beam-builder.js';
import { EquipmentBuilder } from './equipment-builder.js';
import { DecorationBuilder } from './decoration-builder.js';
import { ConnectionBuilder } from './connection-builder.js';
import { buildWorldSnapshot } from './world-snapshot.js';
import { Overlay } from './overlay.js';
import { syncOverlay } from './camera-sync.js';

export class ThreeRenderer {
  constructor(game) {
    this.game = game;

    this._panX = 0;
    this._panY = 0;
    this.zoom = 1;

    this._frustumSize = 20;
    this._animFrameId = null;

    this.renderer = null;
    this.scene = null;
    this.camera = null;

    // Scene groups
    this.terrainGroup = null;
    this.infrastructureGroup = null;
    this.wallGroup = null;
    this.zoneGroup = null;
    this.connectionGroup = null;
    this.equipmentGroup = null;
    this.componentGroup = null;
    this.decorationGroup = null;

    this._boundOnResize = this._onResize.bind(this);

    this.textureManager = new TextureManager();
    this.terrainBuilder = new TerrainBuilder(this.textureManager);
    this.infraBuilder = new InfraBuilder(this.textureManager);
    this.wallBuilder = new WallBuilder(this.textureManager);
    this.componentBuilder = new ComponentBuilder();
    this.beamBuilder = new BeamBuilder();
    this.equipmentBuilder = new EquipmentBuilder();
    this.decorationBuilder = new DecorationBuilder();
    this.connectionBuilder = new ConnectionBuilder();
    this.wallVisibilityMode = 'up';
    this._snapshot = null;

    this.overlay = new Overlay();
  }

  async init() {
    const gameEl = document.getElementById('game');

    // Create WebGL renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setClearColor(0x1a1a2e);

    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '10';
    canvas.style.pointerEvents = 'none';
    gameEl.insertBefore(canvas, gameEl.firstChild);

    this._setSize();

    // Scene
    this.scene = new THREE.Scene();

    // Isometric orthographic camera
    const aspect = gameEl.clientWidth / gameEl.clientHeight;
    const fs = this._frustumSize;
    this.camera = new THREE.OrthographicCamera(
      -fs * aspect / 2,
       fs * aspect / 2,
       fs / 2,
      -fs / 2,
      0.1,
      1000
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = Math.PI / 4;
    this.camera.rotation.x = -Math.atan(Math.sin(Math.atan(1)));
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(this._panX, 0, this._panY);

    // Lighting
    const ambient = new THREE.AmbientLight(0xfff5e6, 0.4);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(-30, 40, -30);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -60;
    dirLight.shadow.camera.right = 60;
    dirLight.shadow.camera.top = 60;
    dirLight.shadow.camera.bottom = -60;
    this.scene.add(dirLight);

    // Scene groups
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain';
    this.scene.add(this.terrainGroup);

    this.infrastructureGroup = new THREE.Group();
    this.infrastructureGroup.name = 'infrastructure';
    this.scene.add(this.infrastructureGroup);

    this.wallGroup = new THREE.Group();
    this.wallGroup.name = 'walls';
    this.scene.add(this.wallGroup);

    this.zoneGroup = new THREE.Group();
    this.zoneGroup.name = 'zones';
    this.scene.add(this.zoneGroup);

    this.connectionGroup = new THREE.Group();
    this.connectionGroup.name = 'connections';
    this.scene.add(this.connectionGroup);

    this.equipmentGroup = new THREE.Group();
    this.equipmentGroup.name = 'equipment';
    this.scene.add(this.equipmentGroup);

    this.componentGroup = new THREE.Group();
    this.componentGroup.name = 'components';
    this.scene.add(this.componentGroup);

    this.decorationGroup = new THREE.Group();
    this.decorationGroup.name = 'decorations';
    this.scene.add(this.decorationGroup);

    window.addEventListener('resize', this._boundOnResize);

    await this.overlay.init();

    this._animate();
  }

  // Zoom centered on a screen position
  zoomAt(screenX, screenY, delta) {
    const gameEl = document.getElementById('game');
    const rect = gameEl.getBoundingClientRect();

    // World position before zoom
    const wBefore = this.screenToWorld(screenX - rect.left, screenY - rect.top);

    this.zoom = Math.max(0.2, Math.min(5, this.zoom * (1 + delta)));
    this._frustumSize = 20 / this.zoom;
    this._updateCameraFrustum();

    // World position after zoom (same screen point)
    const wAfter = this.screenToWorld(screenX - rect.left, screenY - rect.top);

    // Adjust pan to keep the point under the cursor stationary
    this._panX += wBefore.x - wAfter.x;
    this._panY += wBefore.z - wAfter.z;
    this._updateCameraLookAt();
  }

  // Pan by screen pixel deltas
  panBy(dx, dy) {
    const gameEl = document.getElementById('game');
    const screenWidth = gameEl.clientWidth;
    const screenHeight = gameEl.clientHeight;
    const aspect = screenWidth / screenHeight;
    const frustumWidth = this._frustumSize * aspect;

    // Convert screen pixels to world units, accounting for isometric angle
    // The camera is rotated 45° around Y, so screen X maps to world X+Z diagonal
    // and screen Y maps to world Y (elevation) + X-Z diagonal
    const worldPerPixelX = frustumWidth / screenWidth;
    const worldPerPixelY = this._frustumSize / screenHeight;

    // Isometric: screen right = world (X+Z)/sqrt(2), screen up = world Y + (X-Z)/sqrt(2)*sin(iso)
    // For panning on the ground plane (Y=0):
    // screen dx → pan along XZ diagonal
    // screen dy → pan along XZ anti-diagonal
    const cos45 = Math.SQRT1_2;
    this._panX += (-dx * worldPerPixelX * cos45 + dy * worldPerPixelY * cos45);
    this._panY += ( dx * worldPerPixelX * cos45 + dy * worldPerPixelY * cos45);

    this._updateCameraLookAt();
  }

  // Convert screen coordinates to world XZ position (Y=0 ground plane)
  screenToWorld(screenX, screenY) {
    const gameEl = document.getElementById('game');
    const w = gameEl.clientWidth;
    const h = gameEl.clientHeight;

    // Normalized device coordinates
    const ndcX = (screenX / w) * 2 - 1;
    const ndcY = -(screenY / h) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    // Intersect with Y=0 plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);

    return target || new THREE.Vector3(0, 0, 0);
  }

  // Convert world XZ to grid col/row
  worldToGrid(wx, wz) {
    return {
      col: Math.floor(wx),
      row: Math.floor(wz),
    };
  }

  // Convert grid col/row to world XZ center
  gridToWorld(col, row) {
    return {
      x: col + 0.5,
      z: row + 0.5,
    };
  }

  _setSize() {
    const gameEl = document.getElementById('game');
    const w = gameEl.clientWidth;
    const h = gameEl.clientHeight;
    this.renderer.setSize(w, h);
  }

  _updateCameraFrustum() {
    const gameEl = document.getElementById('game');
    const aspect = gameEl.clientWidth / gameEl.clientHeight;
    const fs = this._frustumSize;
    this.camera.left   = -fs * aspect / 2;
    this.camera.right  =  fs * aspect / 2;
    this.camera.top    =  fs / 2;
    this.camera.bottom = -fs / 2;
    this.camera.updateProjectionMatrix();
  }

  _updateCameraLookAt() {
    this.camera.lookAt(this._panX, 0, this._panY);
  }

  _onResize() {
    this._setSize();
    this._updateCameraFrustum();
  }

  _animate() {
    this._animFrameId = requestAnimationFrame(() => this._animate());
    this.renderer.render(this.scene, this.camera);
    syncOverlay(this.camera, this.overlay.world, window.innerWidth, window.innerHeight);
  }

  async loadAssets() {
    await this.textureManager.loadTileManifest();
    await this.textureManager.loadDecorationManifest();
  }

  applySnapshot(snapshot) {
    this._snapshot = snapshot;
    this.terrainBuilder.build(snapshot.terrain, this.terrainGroup);
    this.infraBuilder.build(snapshot.infrastructure, this.infrastructureGroup);
    this.wallBuilder.build(snapshot.walls, snapshot.doors, this.wallGroup, this.wallVisibilityMode);
    this.componentBuilder.build(snapshot.components, this.componentGroup);
    this.beamBuilder.build(snapshot.beamPaths, this.componentGroup);
    this.equipmentBuilder.build(snapshot.equipment, snapshot.furnishings, this.equipmentGroup);
    this.decorationBuilder.build(snapshot.decorations, this.decorationGroup);
    this.connectionBuilder.build(snapshot.connections, this.connectionGroup);
  }

  refresh() {
    const snapshot = buildWorldSnapshot(this.game);
    this.applySnapshot(snapshot);
  }

  dispose() {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    window.removeEventListener('resize', this._boundOnResize);
    this.renderer.dispose();
    const canvas = this.renderer.domElement;
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }
}
