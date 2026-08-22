// Renderer-owned context for storeys below the active construction level.
// The active world keeps its ordinary builders and materials; this coordinator
// owns separate builder instances so lower geometry can be ghosted without
// mutating shared materials or becoming a picking target.

import { FloorBuilder } from './floor-builder.js';
import { WallBuilder } from './wall-builder.js';
import { ComponentBuilder } from './component-builder.js';
import { EquipmentBuilder } from './equipment-builder.js';
import { DecorationBuilder } from './decoration-builder.js';
import { BeamPipeBuilder } from './beam-pipe-builder.js';
import { PipeAttachmentBuilder } from './pipe-attachment-builder.js';
import { buildWorldSnapshot } from './world-snapshot.js';
import { normalizeLevel } from '../game/storeys.js';
import { contentKey } from './content-hash.js';
import { applyStoreyGhost, restoreStoreyGhost } from './storey-ghost-material.js';

const CONTEXT_SECTIONS = Object.freeze([
  'floors', 'walls', 'doors', 'windows', 'components', 'equipment',
  'decorations', 'furnishings', 'beamPipes', 'moduleSubTiles', 'pipeAttachments',
]);

export function lowerStoreyLevels(activeLevel) {
  return Array.from({ length: normalizeLevel(activeLevel) }, (_, level) => level);
}

class LowerStoreyFrame {
  constructor(level, textureManager, parents) {
    this.level = level;
    this._key = null;
    this.floorBuilder = new FloorBuilder(textureManager);
    this.wallBuilder = new WallBuilder(textureManager);
    this.componentBuilder = new ComponentBuilder();
    this.equipmentBuilder = new EquipmentBuilder();
    this.decorationBuilder = new DecorationBuilder();
    this.beamPipeBuilder = new BeamPipeBuilder();
    this.beamAttachmentBuilder = new PipeAttachmentBuilder();
    this.infrastructureAttachmentBuilder = new PipeAttachmentBuilder();

    this.structureGroup = new THREE.Group();
    this.structureGroup.name = `lower-storey-${level}-structure`;
    parents.structure.add(this.structureGroup);
    this.floorGroup = new THREE.Group();
    this.wallGroup = new THREE.Group();
    this.structureGroup.add(this.floorGroup, this.wallGroup);

    this.facilityGroup = new THREE.Group();
    this.facilityGroup.name = `lower-storey-${level}-facility`;
    parents.facility.add(this.facilityGroup);

    this.decorationGroup = new THREE.Group();
    this.decorationGroup.name = `lower-storey-${level}-decorations`;
    parents.grounds.add(this.decorationGroup);

    this.componentGroup = new THREE.Group();
    this.componentGroup.name = `lower-storey-${level}-components`;
    parents.scene.add(this.componentGroup);
    this.beamlineGroup = new THREE.Group();
    this.infrastructureGroup = new THREE.Group();
    this.componentGroup.add(this.beamlineGroup, this.infrastructureGroup);
    this.beamAttachmentGroup = new THREE.Group();
    this.infrastructureAttachmentGroup = new THREE.Group();
    this.beamlineGroup.add(this.beamAttachmentGroup);
    this.infrastructureGroup.add(this.infrastructureAttachmentGroup);

    this.beamPipeGroup = new THREE.Group();
    this.beamPipeGroup.name = `lower-storey-${level}-beam-pipes`;
    parents.scene.add(this.beamPipeGroup);
  }

  groups() {
    return [
      this.structureGroup, this.facilityGroup, this.decorationGroup,
      this.componentGroup, this.beamPipeGroup,
    ];
  }

  build(snapshot, activeComponentIds) {
    const components = (snapshot.components || [])
      .filter(component => component.level === this.level
        && !activeComponentIds.has(component.id));
    const key = contentKey({ ...snapshot, components });
    if (key === this._key) return;
    for (const group of this.groups()) restoreStoreyGhost(group);

    this.floorBuilder.build(snapshot.floors || [], this.floorGroup);
    this.wallBuilder.build(
      snapshot.walls || [], snapshot.doors || [], snapshot.windows || [],
      this.wallGroup, 'up', null,
    );
    this.componentBuilder.build(components, this.componentGroup, {
      categoryGroups: {
        beamline: this.beamlineGroup,
        infrastructure: this.infrastructureGroup,
      },
    });
    this.componentBuilder.setDetailLevel(true);
    this.equipmentBuilder.build(
      snapshot.equipment || [], snapshot.furnishings || [], this.facilityGroup,
    );
    this.decorationBuilder.build(snapshot.decorations || [], this.decorationGroup);
    const attachments = snapshot.pipeAttachments || [];
    this.beamAttachmentBuilder.build(
      attachments.filter(item => item.category !== 'infrastructure'),
      this.beamAttachmentGroup,
    );
    this.infrastructureAttachmentBuilder.build(
      attachments.filter(item => item.category === 'infrastructure'),
      this.infrastructureAttachmentGroup,
    );
    this.beamPipeBuilder.build(snapshot, this.beamPipeGroup);
    this.beamPipeBuilder.setDetailLevel(true);

    for (const group of this.groups()) applyStoreyGhost(group);
    this._key = key;
  }

  dispose(parents) {
    for (const group of this.groups()) restoreStoreyGhost(group);
    this.floorBuilder.dispose(this.floorGroup);
    this.wallBuilder.dispose(this.wallGroup);
    this.componentBuilder.dispose(this.componentGroup);
    this.equipmentBuilder.dispose(this.facilityGroup);
    this.decorationBuilder.dispose(this.decorationGroup);
    this.beamAttachmentBuilder.dispose(this.beamAttachmentGroup);
    this.infrastructureAttachmentBuilder.dispose(this.infrastructureAttachmentGroup);
    this.beamPipeBuilder.dispose(this.beamPipeGroup);
    parents.structure.remove(this.structureGroup);
    parents.facility.remove(this.facilityGroup);
    parents.grounds.remove(this.decorationGroup);
    parents.scene.remove(this.componentGroup);
    parents.scene.remove(this.beamPipeGroup);
  }
}

export class LowerStoreyPresentation {
  constructor(game, textureManager, parents) {
    this.game = game;
    this.textureManager = textureManager;
    this.parents = parents;
    this.frames = new Map();
  }

  get beamlineGroups() {
    return [...this.frames.values()].flatMap(frame => [frame.beamlineGroup, frame.beamPipeGroup]);
  }

  get infrastructureGroups() {
    return [...this.frames.values()].map(frame => frame.infrastructureGroup);
  }

  sync(activeSnapshot) {
    const levels = new Set(lowerStoreyLevels(this.game.activeLevel));
    for (const [level, frame] of this.frames) {
      if (levels.has(level)) continue;
      frame.dispose(this.parents);
      this.frames.delete(level);
    }
    const activeComponentIds = new Set(
      (activeSnapshot?.components || []).map(component => component.id),
    );
    for (const level of levels) {
      let frame = this.frames.get(level);
      if (!frame) {
        frame = new LowerStoreyFrame(level, this.textureManager, this.parents);
        this.frames.set(level, frame);
      }
      frame.build(buildWorldSnapshot(this.game, {
        level,
        only: CONTEXT_SECTIONS,
      }), activeComponentIds);
    }
  }

  dispose() {
    for (const frame of this.frames.values()) frame.dispose(this.parents);
    this.frames.clear();
  }
}
