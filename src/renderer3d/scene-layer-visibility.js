// Presentation-only scene layer visibility.
//
// This coordinator owns no game state and never rebuilds world data. It only
// flips Object3D.visible on renderer-owned groups. A target may belong to more
// than one layer (lighting fixtures are both Grounds decorations and Lights),
// so every apply computes visibility from the complete enabled-state map.

export const WORLD_LAYER_IDS = Object.freeze([
  'lights',
  'zoneLabels',
  'beamline',
  'infra',
  'facility',
  'structure',
  'grounds',
  'staff',
]);

export class SceneLayerVisibility {
  constructor(resolveTargets = () => []) {
    this._resolveTargets = resolveTargets;
    this._visible = new Map(WORLD_LAYER_IDS.map(id => [id, true]));
  }

  isVisible(id) {
    return this._visible.get(id) !== false;
  }

  setVisible(id, visible) {
    if (!this._visible.has(id)) return null;
    const next = visible !== false;
    this._visible.set(id, next);
    this.apply();
    return next;
  }

  toggle(id) {
    if (!this._visible.has(id)) return null;
    return this.setVisible(id, !this.isVisible(id));
  }

  reset() {
    for (const id of WORLD_LAYER_IDS) this._visible.set(id, true);
    this.apply();
    return this.snapshot();
  }

  snapshot() {
    return Object.fromEntries(WORLD_LAYER_IDS.map(id => [id, this.isVisible(id)]));
  }

  apply() {
    for (const target of this._resolveTargets?.() || []) {
      const object = target?.object;
      if (!object) continue;
      const layers = Array.isArray(target.layers) ? target.layers : [target.layer];
      object.visible = layers.filter(Boolean).every(id => this.isVisible(id));
    }
  }
}

/**
 * Resolve the live renderer groups controlled by each player-facing layer.
 * Kept here so ThreeRenderer remains a composition surface.
 */
export function sceneLayerTargets(renderer) {
  const targets = [];
  const add = (layers, ...objects) => {
    for (const object of objects.flat()) {
      if (object) targets.push({ layers, object });
    }
  };

  add(['beamline'],
    renderer.beamlineComponentGroup,
    renderer.beamEffectGroup,
    renderer.beamPipeGroup,
    renderer.pipeAttachmentGroup,
    renderer.lowerStoreyPresentation?.beamlineGroups,
  );
  add(['infra'],
    renderer.infrastructureComponentGroup,
    renderer.connectionGroup,
    renderer.utilityLineGroup,
    renderer.utilityPortIssueGroup,
    renderer.portFittingGroup,
    renderer.lowerStoreyPresentation?.infrastructureGroups,
  );
  add(['facility'], renderer.facilityLayerGroup);
  add(['structure'], renderer.structureLayerGroup);
  add(['grounds'], renderer.groundsLayerGroup);
  add(['staff'], renderer.staffPawns?.group);
  add(['lights'],
    renderer.lightPoolGroup,
    renderer.lightHaloGroup,
    renderer.volumetricLightGroup,
  );
  add(['zoneLabels'], renderer._zoneLabelMeshes);

  // Fixture housings remain ordinary decoration-builder objects for picking
  // and demolition, but the Lights toggle should hide those meshes too.
  for (const fixture of renderer.lightingGroup || []) {
    add(['lights', 'grounds'], fixture?.group);
  }

  return targets;
}
