// test/test-designer-workspaces.js — persistent per-beamline Designer tabs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import {
  CURRENT_DRAFT_ID, createDesignerAlternative, ensureDesignerWorkspace,
  getDesignerWorkspace, replaceCurrentDesignerDraft, saveDesignerDraft,
  selectDesignerDraft,
} from '../src/beamline/designer-workspaces.js';

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed++;
  console.log('  PASS:', message);
}

const source = { id: 'src-1', type: 'source', params: { current: 2 } };
const cup = { id: 'cup-1', type: 'faradayCup', params: {} };
const giant = Array.from({ length: 180 }, (_, index) => ({
  id: index === 0 ? 'src-1' : `draft-${index}`,
  type: index === 0 ? 'source' : 'quadrupole',
  params: index === 0 ? { current: 2 } : { gradient: 5 + index },
}));

console.log('\n=== Per-beamline draft store ===\n');

{
  const state = {};
  const workspace = ensureDesignerWorkspace(state, {
    workspaceId: 'bl-1', beamlineId: 'bl-1', sourceId: 'src-1',
    currentDraft: { draftNodes: [source, cup], selectedIndex: 0 },
  });
  ok(workspace.activeDraftId === CURRENT_DRAFT_ID,
    'a new beamline workspace opens on Current');
  ok(workspace.drafts.length === 1 && workspace.drafts[0].name === 'Current',
    'Current is the stable first tab');

  saveDesignerDraft(state, 'bl-1', CURRENT_DRAFT_ID, {
    draftNodes: giant, selectedIndex: 179, viewX: 92, viewZoom: 1.2, hasChanges: true,
  });
  ok(getDesignerWorkspace(state, 'bl-1').drafts[0].draftNodes.length === 180,
    'an unplaceably large working draft is retained without validation');
  ok(getDesignerWorkspace(state, 'bl-1').drafts[0].hasChanges === true,
    'Current records whether it is a pending proposal or a clean map mirror');

  // Stored nodes must not alias the live Designer arrays.
  giant[1].params.gradient = -999;
  ok(getDesignerWorkspace(state, 'bl-1').drafts[0].draftNodes[1].params.gradient === 6,
    'workspace persistence clones node parameters');

  const alternative = createDesignerAlternative(state, 'bl-1', {
    draftNodes: [source, cup], selectedIndex: 0,
  });
  ok(alternative.id === 'design-1' && alternative.name === 'Design 1',
    'the plus tab creates a predictably named alternative');
  ok(getDesignerWorkspace(state, 'bl-1').activeDraftId === alternative.id,
    'a new alternative becomes the active tab');
  ok(selectDesignerDraft(state, 'bl-1', CURRENT_DRAFT_ID),
    'Current can be selected again');
  ok(!selectDesignerDraft(state, 'bl-1', 'missing'),
    'a tab id from nowhere cannot become active');

  replaceCurrentDesignerDraft(state, 'bl-1', {
    draftNodes: [source, { id: 'dump-1', type: 'beamStop', params: {} }],
  });
  const afterApply = getDesignerWorkspace(state, 'bl-1');
  ok(afterApply.activeDraftId === CURRENT_DRAFT_ID
      && afterApply.drafts.find(d => d.id === CURRENT_DRAFT_ID).draftNodes[1].type === 'beamStop',
  'Apply refreshes Current from the installed line');
  ok(afterApply.drafts.find(d => d.id === alternative.id).draftNodes[1].type === 'faradayCup',
    'refreshing Current preserves alternative designs');

  ensureDesignerWorkspace(state, {
    workspaceId: 'bl-2', beamlineId: 'bl-2', sourceId: 'src-2',
    currentDraft: { draftNodes: [{ id: 'src-2', type: 'ionSource', params: {} }] },
  });
  ok(getDesignerWorkspace(state, 'bl-2').drafts.length === 1
      && getDesignerWorkspace(state, 'bl-1').drafts.length === 2,
  'beamlines own independent tab sets');
}

console.log('\n=== Save and undo boundaries ===\n');

{
  const game = new Game(new BeamlineRegistry(), { seed: 31 });
  game.ensureBeamlineDesignerWorkspace({
    workspaceId: 'bl-1', beamlineId: 'bl-1', sourceId: 'src-1',
    currentDraft: { draftNodes: [source, cup] },
  });
  const serialized = JSON.parse(game.serialize());
  ok(serialized.state.beamlineDesignerWorkspaces['bl-1'].drafts[0].draftNodes.length === 2,
    'closed beamline drafts are part of ordinary save data');

  // Make one world gesture, then author a large draft after its before-snapshot.
  // Undo must rewind the world without rewinding player-authored Designer work.
  const oldExtent = game.state.mapHalfExtent;
  game.commitGesture({ mutate: () => {
    game.state.mapHalfExtent = oldExtent + 1;
    return true;
  } });
  game.saveBeamlineDesignerDraft('bl-1', CURRENT_DRAFT_ID, { draftNodes: giant });
  game.undo();
  ok(game.state.log[0]?.msg === 'Undo', 'setup world gesture is undoable');
  ok(game.state.mapHalfExtent === oldExtent,
    'undo restores the world mutation');
  ok(game.getBeamlineDesignerWorkspace('bl-1').drafts[0].draftNodes.length === 180,
    'undo preserves drafts authored after the world snapshot');
}

console.log('\n=== Designer tab presentation ===\n');

{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/ui/BeamlineDesigner.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  ok(html.includes('id="dsgn-workspace-tabs"') && html.includes('role="tablist"'),
    'the Designer header exposes an accessible draft tab strip');
  ok(css.includes('.dsgn-workspace-tab.active') && css.includes('.dsgn-workspace-add'),
    'Current, alternatives, and the plus tab have dedicated visual states');
  ok(controller.includes('_saveActiveWorkspaceDraft();')
      && controller.includes('_createWorkspaceAlternative()'),
  'closing/switching saves the active tab and plus creates an alternative');
  ok(!main.includes('designer._cleanup();'),
    'all navigation exits route through autosaving close()');
}

console.log(`\n${passed} passed`);
