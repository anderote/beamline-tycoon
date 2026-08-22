// Four large, world-space arrows at the corners of the owned map. Each arrow
// buys the same next square parcel; they are repeated so the control is visible
// from every camera heading and wherever the player is working near the edge.
// THREE is loaded as a CDN global — do NOT import it.

export const LAND_MARKER_OFFSET = 4;
export const LAND_WORLD_UNITS_PER_TILE = 2;

/** Pure marker layout, kept independent of THREE for contract tests. */
export function landMarkerLayout(mapHalfExtent, offset = LAND_MARKER_OFFSET) {
  const edge = (mapHalfExtent + offset) * LAND_WORLD_UNITS_PER_TILE;
  return [
    { x: -edge, z: -edge, dx: -1, dz: -1, corner: 'nw' },
    { x:  edge, z: -edge, dx:  1, dz: -1, corner: 'ne' },
    { x:  edge, z:  edge, dx:  1, dz:  1, corner: 'se' },
    { x: -edge, z:  edge, dx: -1, dz:  1, corner: 'sw' },
  ];
}

/** Execute a marker purchase through the public game command. */
export function purchaseLandFromMarker(game) {
  const result = game.buyLand();
  if (!result.ok && result.reason) game.log(result.reason, 'bad');
  return result;
}

function priceLabel(cost) {
  if (cost === 500_000) return '$500K';
  return `$${Number(cost).toLocaleString()}`;
}

function makeLabelTexture(parcel) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5, 16, 28, 0.92)';
  ctx.strokeStyle = '#8ff7ff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 18);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px monospace';
  ctx.fillText('BUY LAND', canvas.width / 2, 40);
  ctx.fillStyle = '#ffd35a';
  ctx.font = 'bold 42px monospace';
  ctx.fillText(priceLabel(parcel.cost), canvas.width / 2, 88);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeArrowGeometry() {
  // Local +Z is outward. A broad tail and oversized head stay readable at the
  // ordinary construction zoom as well as in the top-down view.
  const points = [
    -1.0, 0, -2.1,   1.0, 0, -2.1,   1.0, 0, 0.0,
    -1.9, 0, 0.0,    0.0, 0, 2.3,    1.9, 0, 0.0,
    -1.0, 0, 0.0,
  ];
  const indices = [0, 1, 2, 0, 2, 6, 3, 4, 5];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class LandPurchaseMarkers {
  constructor(game, scene) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'landPurchaseMarkers';
    this.group.renderOrder = 1100;
    scene.add(this.group);
    this._signature = null;
    this._hovered = false;
  }

  sync() {
    const status = this.game.getLandPurchaseStatus();
    const signature = status.parcel
      ? `${status.mapHalfExtent}:${status.parcel.id}:${status.parcel.cost}:${status.affordable}`
      : `${status.mapHalfExtent}:complete`;
    if (signature === this._signature) return;
    this._signature = signature;
    this._clear();
    if (!status.parcel) return;

    const geometry = makeArrowGeometry();
    const color = status.affordable ? 0x55f4ff : 0xe59a45;
    const labelTexture = makeLabelTexture(status.parcel);
    for (const marker of landMarkerLayout(status.mapHalfExtent)) {
      const root = new THREE.Group();
      root.position.set(marker.x, 0.32, marker.z);
      root.rotation.y = Math.atan2(marker.dx, marker.dz);
      root.userData.landPurchaseMarker = true;

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const arrow = new THREE.Mesh(geometry, material);
      arrow.renderOrder = 1100;
      root.userData.arrowMaterial = material;
      root.add(arrow);

      const labelMaterial = new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthTest: false,
      });
      const label = new THREE.Sprite(labelMaterial);
      label.position.set(0, 2.2, -1.35);
      label.scale.set(6, 2, 1);
      label.renderOrder = 1101;
      root.add(label);
      this.group.add(root);
    }
  }

  hitTest(raycaster) {
    const hits = raycaster.intersectObjects(this.group.children, true);
    for (const hit of hits) {
      let obj = hit.object;
      while (obj && obj !== this.group) {
        if (obj.userData?.landPurchaseMarker) return true;
        obj = obj.parent;
      }
    }
    return false;
  }

  setHovered(hovered) {
    if (this._hovered === hovered) return;
    this._hovered = hovered;
    for (const root of this.group.children) {
      const material = root.userData.arrowMaterial;
      if (!material) continue;
      material.opacity = hovered ? 1 : 0.92;
    }
  }

  purchase() {
    const result = purchaseLandFromMarker(this.game);
    this.sync();
    return result;
  }

  _clear() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    this.group.traverse(obj => {
      if (obj.geometry) geometries.add(obj.geometry);
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material);
        if (material.map) textures.add(material.map);
      }
    });
    this.group.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this._hovered = false;
  }

  dispose() {
    this._clear();
    this.group.removeFromParent();
  }
}
