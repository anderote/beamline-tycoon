// Consistent material treatment for geometry shown below the active storey.
// Materials in the production builders are often shared module-level objects,
// so ghosting is clone-on-apply and fully reversible before builder teardown.

export const LOWER_STOREY_OPACITY = 0.22;

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function ghostMaterial(material, opacity) {
  if (!material?.clone || material.visible === false) return material;
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = Math.min(Number.isFinite(material.opacity) ? material.opacity : 1, opacity);
  clone.depthWrite = false;
  if (Number.isFinite(clone.alphaTest) && clone.alphaTest > 0) {
    clone.alphaTest = Math.min(clone.alphaTest, clone.opacity * 0.5);
  }
  if ('emissiveIntensity' in clone) clone.emissiveIntensity = 0;
  clone.userData = { ...(clone.userData || {}), lowerStoreyGhost: true };
  return clone;
}

export function applyStoreyGhost(root, opacity = LOWER_STOREY_OPACITY) {
  root?.traverse?.((object) => {
    if (!object?.material || object.userData?._lowerStoreyBaseMaterial) return;
    const base = object.material;
    const ghosts = asArray(base).map(material => ghostMaterial(material, opacity));
    object.userData ||= {};
    object.userData._lowerStoreyBaseMaterial = base;
    object.userData._lowerStoreyGhostMaterials = ghosts.filter((material, index) =>
      material && material !== asArray(base)[index]);
    object.userData._lowerStoreyCastShadow = object.castShadow === true;
    object.userData._lowerStoreyReceiveShadow = object.receiveShadow === true;
    object.userData._lowerStoreyLayerMask = object.layers?.mask;
    object.material = Array.isArray(base) ? ghosts : ghosts[0];
    object.castShadow = false;
    object.receiveShadow = false;
    object.layers?.set?.(0);
  });
}

export function restoreStoreyGhost(root) {
  root?.traverse?.((object) => {
    const base = object?.userData?._lowerStoreyBaseMaterial;
    if (!base) return;
    object.material = base;
    for (const material of object.userData._lowerStoreyGhostMaterials || []) {
      material.dispose?.();
    }
    object.castShadow = object.userData._lowerStoreyCastShadow;
    object.receiveShadow = object.userData._lowerStoreyReceiveShadow;
    if (object.layers && Number.isFinite(object.userData._lowerStoreyLayerMask)) {
      object.layers.mask = object.userData._lowerStoreyLayerMask;
    }
    delete object.userData._lowerStoreyBaseMaterial;
    delete object.userData._lowerStoreyGhostMaterials;
    delete object.userData._lowerStoreyCastShadow;
    delete object.userData._lowerStoreyReceiveShadow;
    delete object.userData._lowerStoreyLayerMask;
  });
}
