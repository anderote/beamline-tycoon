// src/beamline/designer-workspaces.js — persistent per-beamline draft tabs.
//
// A Designer session is transient UI state. A draft is player-authored content:
// closing the overlay, saving the game, or opening another beamline must not
// discard it. Workspaces live in ordinary serialized game state and are kept
// outside world undo by Game.js, alongside the saved-design library.

export const CURRENT_DRAFT_ID = 'current';

function cloneNode(node) {
  return {
    ...node,
    params: node?.params ? { ...node.params } : {},
    _sourceRef: node?._sourceRef ? { ...node._sourceRef } : undefined,
  };
}

function clonePayload(payload = {}) {
  return {
    draftNodes: (payload.draftNodes || []).map(cloneNode),
    selectedIndex: Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0,
    viewX: Number.isFinite(payload.viewX) ? payload.viewX : 0,
    viewZoom: Number.isFinite(payload.viewZoom) ? payload.viewZoom : 0.7,
    hasChanges: payload.hasChanges === true,
  };
}

function workspaces(state) {
  if (!state.beamlineDesignerWorkspaces
      || typeof state.beamlineDesignerWorkspaces !== 'object'
      || Array.isArray(state.beamlineDesignerWorkspaces)) {
    state.beamlineDesignerWorkspaces = {};
  }
  return state.beamlineDesignerWorkspaces;
}

/** Return one workspace without creating it. */
export function getDesignerWorkspace(state, workspaceId) {
  return workspaces(state)[workspaceId] || null;
}

/** Ensure every beamline has a stable Current working draft. */
export function ensureDesignerWorkspace(state, {
  workspaceId, beamlineId = null, sourceId = null, currentDraft = {},
}) {
  if (!workspaceId) return null;
  const all = workspaces(state);
  let workspace = all[workspaceId];
  if (!workspace) {
    workspace = {
      id: workspaceId,
      beamlineId,
      sourceId,
      activeDraftId: CURRENT_DRAFT_ID,
      nextAlternativeId: 1,
      drafts: [{
        id: CURRENT_DRAFT_ID,
        name: 'Current',
        ...clonePayload(currentDraft),
      }],
    };
    all[workspaceId] = workspace;
  }

  workspace.beamlineId = beamlineId || workspace.beamlineId || null;
  workspace.sourceId = sourceId || workspace.sourceId || null;
  if (!Array.isArray(workspace.drafts)) workspace.drafts = [];
  if (!workspace.drafts.some(draft => draft.id === CURRENT_DRAFT_ID)) {
    workspace.drafts.unshift({
      id: CURRENT_DRAFT_ID,
      name: 'Current',
      ...clonePayload(currentDraft),
    });
  }
  if (!workspace.drafts.some(draft => draft.id === workspace.activeDraftId)) {
    workspace.activeDraftId = CURRENT_DRAFT_ID;
  }
  if (!Number.isInteger(workspace.nextAlternativeId) || workspace.nextAlternativeId < 1) {
    workspace.nextAlternativeId = 1;
  }
  return workspace;
}

/** Replace the persisted contents of one tab. */
export function saveDesignerDraft(state, workspaceId, draftId, payload) {
  const workspace = getDesignerWorkspace(state, workspaceId);
  const draft = workspace?.drafts?.find(candidate => candidate.id === draftId);
  if (!draft) return null;
  Object.assign(draft, clonePayload(payload));
  return draft;
}

/** Make a fresh alternative from the caller's chosen baseline. */
export function createDesignerAlternative(state, workspaceId, payload) {
  const workspace = getDesignerWorkspace(state, workspaceId);
  if (!workspace) return null;
  const number = workspace.nextAlternativeId++;
  const draft = {
    id: `design-${number}`,
    name: `Design ${number}`,
    ...clonePayload(payload),
  };
  workspace.drafts.push(draft);
  workspace.activeDraftId = draft.id;
  return draft;
}

/** Select a tab, rejecting ids that do not belong to this beamline. */
export function selectDesignerDraft(state, workspaceId, draftId) {
  const workspace = getDesignerWorkspace(state, workspaceId);
  if (!workspace?.drafts?.some(draft => draft.id === draftId)) return false;
  workspace.activeDraftId = draftId;
  return true;
}

/** Refresh Current after a successful Apply, without touching alternatives. */
export function replaceCurrentDesignerDraft(state, workspaceId, payload) {
  const saved = saveDesignerDraft(state, workspaceId, CURRENT_DRAFT_ID, {
    ...payload,
    hasChanges: false,
  });
  const workspace = getDesignerWorkspace(state, workspaceId);
  if (saved && workspace) workspace.activeDraftId = CURRENT_DRAFT_ID;
  return saved;
}
