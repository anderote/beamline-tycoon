import { COMPONENTS } from '../data/components.js';
import {
  FLOORS, WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, variantCost, floorRequirementLabel,
} from '../data/structure.js';
import { ZONES, ZONE_FURNISHINGS } from '../data/facility.js';
import { DECORATIONS } from '../data/decorations.js';
import { MODES } from '../data/modes.js';
import { DIR, DIR_DELTA } from '../data/directions.js';
import { isoToGrid, isoToGridFloat, gridToIso, isoToSubGrid } from '../renderer/grid.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { openUtilityInspectorForLine } from '../ui/utility-inspector-command.js';
import { appendRequiredPortRequirements } from '../ui/required-port-preview.js';
import { EconomyWindow } from '../ui/EconomyWindow.js';
import { UTILITY_TYPES, utilityLineHeight } from '../utility/registry.js';
import { projectOntoUtilityLine, utilityAttachmentPose } from '../utility/line-attachments.js';
import { findUtilityEndpoint } from '../utility/utility-endpoints.js';
import { PLACEABLES } from '../data/placeables/index.js';
import {
  snapForPlaceable, canPlace, canPlaceWallFixture, previewPlacement,
  canAffordCost, componentCostFor, usesFloorOccupancy, wallFixtureOffFromFrac,
  PLACE_BLOCKED, PLACE_WALL, PLACE_MAP_EDGE, PLACE_UNAFFORDABLE,
} from '../game/placement.js';
import { findStackTarget } from '../game/stacking.js';
import {
  edgeKey, mirrorEdge, findWallKey, findEdgeKey, doorRecordCoversEdge,
} from '../game/edge-keys.js';
import { levelOf, sameLevel, subtileKey, tileKey } from '../game/storeys.js';
import { wallFixtureDir } from '../game/wall-fixture-geometry.js';
import { BeamlineInputController } from './BeamlineInputController.js';
import { LinearManifoldTool } from './linear-manifold-tool.js';
import { UniversalUtilityBusTool } from './universal-utility-bus-tool.js';
import { UtilityLineInputController } from './UtilityLineInputController.js';
import { PlaceableTool, ZonePaintTool } from './placement-tools.js';
import { FloorTool, WallTool, WallPaintTool, DoorTool, WindowTool } from './structure-tools.js';
import {
  buildFloorRegionPerimeter,
  buildSmartFloorWallPath,
} from './floor-wall-paths.js';
import { DemolishTool } from './demolish-tool.js';
import { MoveTool, ProbeTool, SelectionActionTool } from './mode-tools.js';
import { BeamlineTool } from './beamline-tool.js';
import { UtilityLineTool } from './utility-line-tool.js';
import { DeferredUtilityPortDrag } from './deferred-port-drag.js';
import {
  commitPanelAutoConnect,
  disconnectAutoConnectDevice,
  disconnectAutoConnectDevices,
  planPanelAutoConnect,
  utilityAutoConnectProfile,
} from './panel-auto-connect.js';
import { portAnchor3D } from '../utility/port-anchors.js';
import { portWorldPosition } from '../utility/ports.js';
import {
  captureSelectionGroup,
  previewSelectionGroup,
  selectionPayloadCount,
  transformSelectionGroup,
} from './selection-group.js';
import {
  copySelectionGroup,
  demolishSelection,
  mirrorSelectionPorts,
  moveSelectionGroup,
} from './selection-commands.js';
import { reconcileSelectionWindow } from './selection-window.js';
import {
  BEAM_PIPE_Y, projectOntoPipe, pipeSubL, pipeSubUnitAt, pipeSubUnitPath, METRES_PER_SUB,
} from '../beamline/pipe-geometry.js';
import { pipeRefund } from '../beamline/BeamlineSystem.js';
import { placementsConflict } from '../beamline/pipe-placements.js';
import { pushEscHandler } from '../ui/esc-stack.js';
import {
  createDemolishPolicy,
  defaultDemolishFilters,
  legacyDemolishPolicy,
  normalizeDemolishFilters,
  demolishRefund,
} from './demolishScopes.js';
import {
  componentHoverInfo,
  furnishingHoverInfo,
  staffHoverInfo,
  utilityNetworkHoverInfo,
} from '../ui/hover-info.js';
import { renderHoverTooltipDetail } from '../ui/hover-tooltip-detail.js';
import { placeableMutationEvent } from '../game/placeable-events.js';
import {
  floorSelectionKey,
  isSelectionCategory,
  physicalEdgeSelectionKey,
  selectionTargetByKey,
  selectionTargetForPlaceable,
} from '../game/selection-targets.js';
import {
  loadMouseSelectionCategories,
  mouseSelectionCategoryEnabled,
  saveMouseSelectionCategories,
} from './selection-preferences.js';
import { OBJECT_PICK_TOLERANCE_PX } from './pick-tolerance.js';
import { selectedBeamlineFocusModel } from '../renderer3d/selected-beamline-focus.js';

// === BEAMLINE TYCOON: INPUT HANDLER ===

// Per-key variant memory written by the HUD's variant flyouts (ui/hud.js).
// Read here so keyboard palette navigation arms with the same variant a
// mouse click on the item would.
const VARIANT_MEMORY_KEY = 'bt_lastVariantByKey';
const SELECTION_SLOT_STORAGE_KEY = 'beamlineTycoon.selectionSlots.v1';
const MARQUEE_DRAG_THRESHOLD_PX = 6;
export const MIDDLE_CAMERA_DRAG_THRESHOLD_PX = 4;

/** Ignore normal mouse jitter when deciding whether MMB was a click or orbit. */
export function isMiddleCameraDrag(start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy >= MIDDLE_CAMERA_DRAG_THRESHOLD_PX ** 2;
}

function _categoryColor(category) {
  const colors = {
    rfPower:       0xcc4444, // red
    rf:            0xcc4444, // red
    cooling:       0x4488cc, // blue
    vacuum:        0x999999, // grey
    power:         0xccaa44, // amber/yellow
    dataControls:  0x44cc88, // green
    ops:           0xcc8844, // orange
    diagnostic:    0x44aacc, // teal
    optics:        0x8866cc, // purple
    source:        0xcccc44, // yellow
    endpoint:      0xcc6688, // pink
  };
  return colors[category] || 0x88aaff;
}

export class InputHandler {
  constructor(renderer, game) {
    this.renderer = renderer;
    this.game = game;
    this.selectedCategory = 'source';
    this.dipoleBendDir = 'right';
    this.placementDir = DIR.NE;     // direction for source/free placement
    this.placementPortsFlipped = false; // M mirrors armed utility-port sides
    this.selectedParamOverrides = null; // param flyout overrides (BeamlineTool)
    this.selectedNodeId = null;
    this.selectedPlaceableId = null;
    // Ordered by selection time. selectedPlaceableId remains the primary /
    // most-recent id for legacy single-selection call sites.
    this.selectedPlaceableIds = new Set();
    this._selectedRootsById = new Map();
    // Full candidate set from the latest marquee/Shift-add gesture. Category
    // toggles only change selectedPlaceableIds, so a disabled category can be
    // re-enabled without drawing the marquee again.
    this._selectionCandidatesByKey = new Map();
    this._mouseSelectionCategories = loadMouseSelectionCategories();
    this._marquee = null;
    this._marqueeEl = null;
    this._deferredUtilityPortDrag = new DeferredUtilityPortDrag();
    this._placementKeyHintEl = null;
    this._panelAutoConnectPlanCache = new Map();
    this._panelAutoConnectPlanCacheRevision = -1;
    this._selectionClipboard = null;
    this._selectionSlots = this._loadSelectionSlots();
    this.isPanning = false;
    this.isFreeOrbiting = false;
    this.freeOrbitStart = { x: 0, y: 0 };
    this.freeOrbitLast = { x: 0, y: 0 };
    this.freeOrbitDragged = false;
    this.panStart = { x: 0, y: 0 };
    this.worldStart = { x: 0, y: 0 };
    this.activeMode = 'beamline';
    // Demolition is one persistent cursor. Filters survive leaving/re-entering
    // the mode during the session, while their initial state comes from the
    // authored defaults in demolishScopes.js.
    this.demolishFilters = defaultDemolishFilters();
    this.hoverSubCol = -1;              // sub-grid column under cursor
    this.hoverSubRow = -1;              // sub-grid row under cursor
    // Unified placeable preview state. Which placeable is armed derives
    // from the active tool (see the `armedPlaceableId` getter).
    this.selectedPlaceableVariant = 0; // decoration color variant etc.
    this.hoverPlaceable = null; // { id, col, row, subCol, subRow, dir } | null
    this.selectionGroupPreview = null;
    // Shift+drag line placement (trees and other decorations)
    this.isLinePlacingDecoration = false;
    this.linePlaceStartWorld = null; // { x, y } iso-screen world coords
    this.linePlaceHovers = [];       // [{ hover, valid }]
    // Per-placeable spacing override in sub-units (1 sub = quarter tile).
    // Set via Shift+Z/X while drag-placing; persists for the session so each
    // placeable keeps its own feel (e.g. bollards tight, benches loose).
    this.linePlaceSpacingSub = new Map();
    this._linePlaceLastWorld = null; // for re-previewing on spacing change
    this._suppressNextClick = false;
    this._landPurchasePress = false;
    // Live modifier state, kept because synthesized events (the {clientX,
    // clientY, button} record _handleClick hands to onClick) carry no
    // modifier flags, and because a modifier can change under a stationary
    // cursor with no mouse event to read it from.
    this._shiftDown = false;
    // Ctrl (or Cmd) is the mirror of Shift for structure build tools: Shift
    // EXTENDS the gesture, Ctrl INVERTS it into an erase along exactly the
    // path the tool would have drawn. See structure-tools.js.
    this._ctrlDown = false;
    // Continuous panning
    this.keysDown = new Set();
    this._panFrameId = null;
    // Palette keyboard navigation
    this.paletteIndex = -1;  // -1 = no keyboard focus
    // Hover tooltip state
    this._hoverTooltipTarget = null;
    this._tooltipEl = null;
    // Beamline-specific input (junction ghosts, pipe drawing,
    // placement-on-pipe). BeamlineTool routes events here; the controller
    // owns the pipe-draw render state ThreeRenderer reads each frame. The
    // back-reference is for shared non-tool state (placementDir etc.).
    this.beamlineController = new BeamlineInputController({
      game,
      renderer,
      inputHandler: this,
    });
    // Utility-line gesture controller (UtilityLineTool routes events here;
    // ThreeRenderer reads preview/hover state off the controller directly).
    this.utilityLineController = new UtilityLineInputController({
      game,
      renderer,
    });
    // --- Tool abstraction (Phase 4) ---
    // The single armed tool. Every tool family is a Tool object now:
    // placement-tools.js, structure-tools.js, demolish-tool.js,
    // mode-tools.js, beamline-tool.js, utility-line-tool.js. Mutual
    // exclusivity holds by construction — arming any tool disarms the
    // previous one in setTool.
    this.activeTool = null;
    this._toolCtx = { game, renderer, input: this };
    this._bindKeyboard();
    this._bindMouse();
    // Escape is owned by the global esc-stack (ui/esc-stack.js). The game
    // input layer registers the *fallback* (bottom-of-stack) handler — the
    // tool-disarm / selection-sweep ladder — so any open dialog, overlay,
    // or context window pushed above it wins Esc first.
    this._escUnsub = pushEscHandler((e) => this._handleEscape(e), { fallback: true });
  }

  /**
   * The unified-placeable id the active tool has armed, or null. This is
   * the single query the shared preview/commit/rotation paths key on —
   * the legacy per-family selection fields died with the tool conversion.
   */
  get armedPlaceableId() {
    return this.activeTool?.armedPlaceableId ?? null;
  }

  // --- Hover tooltip ---

  _showTooltip(info, screenX, screenY) {
    this._hideTooltip();
    const el = document.createElement('div');
    el.className = 'hover-tooltip';
    const title = document.createElement('div');
    title.className = 'hover-tooltip-title';
    title.textContent = info.title;
    const detail = document.createElement('div');
    detail.className = 'hover-tooltip-detail';
    renderHoverTooltipDetail(detail, info);
    el.append(title, detail);
    document.body.appendChild(el);
    this._tooltipEl = el;
    this._positionTooltip(screenX, screenY);
  }

  _hideTooltip() {
    if (this._tooltipEl) {
      this._tooltipEl.remove();
      this._tooltipEl = null;
    }
    this._hoverTooltipTarget = null;
  }

  _setHoverTooltip(targetId, info, screenX, screenY) {
    if (!info) { this._hideTooltip(); return; }
    if (this._hoverTooltipTarget !== targetId || !this._tooltipEl) {
      this._showTooltip(info, screenX, screenY);
      this._hoverTooltipTarget = targetId;
      return;
    }
    // Keep the compact card beside the cursor without rebuilding its DOM.
    // Panel counts can change while the pointer stays on the same object, so
    // refresh the two text nodes as well as its position.
    const title = this._tooltipEl.querySelector?.('.hover-tooltip-title');
    const detail = this._tooltipEl.querySelector?.('.hover-tooltip-detail');
    if (title && title.textContent !== info.title) title.textContent = info.title;
    renderHoverTooltipDetail(detail, info);
    this._positionTooltip(screenX, screenY);
  }

  _positionTooltip(screenX, screenY) {
    if (!this._tooltipEl) return;
    const margin = 8;
    const left = Math.min(screenX + 12, window.innerWidth - this._tooltipEl.offsetWidth - margin);
    const top = Math.min(screenY - 8, window.innerHeight - this._tooltipEl.offsetHeight - margin);
    this._tooltipEl.style.left = Math.max(margin, left) + 'px';
    this._tooltipEl.style.top = Math.max(margin, top) + 'px';
  }

  _placementKeyHintText() {
    if (this.game._designPlacer?.active) {
      return '<span class="k">F</span> Rotate <span class="sep">•</span> '
        + '<span class="k">R</span> Mirror';
    }
    const payload = this.activeTool?.kind === 'move' ? this.activeTool.payload : null;
    if (payload?.kind === 'selectionGroup') {
      return '<span class="k">F</span> Rotate <span class="sep">•</span> '
        + '<span class="k">M</span> Mirror';
    }
    const armedId = this.armedPlaceableId;
    if (!armedId) return '';
    const comp = COMPONENTS[armedId] || PLACEABLES[armedId];
    const rotatable = !(comp && (comp.role === 'junction'
      || comp.role === 'placement' || comp.isDrawnConnection));
    const hasUtilityPorts = Object.values(comp?.ports || {}).some(port => port?.utility);
    const bits = [];
    if (rotatable) bits.push('<span class="k">F</span> Rotate');
    if (hasUtilityPorts) bits.push('<span class="k">M</span> Mirror ports');
    return bits.join(' <span class="sep">•</span> ');
  }

  /** Cursor-adjacent transform reminder while an item/formation is armed. */
  _updatePlacementKeyHint(screenX = this._lastScreenX, screenY = this._lastScreenY) {
    const html = this._placementKeyHintText();
    if (!html || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      this._hidePlacementKeyHint();
      return;
    }
    if (!this._placementKeyHintEl) {
      const el = document.createElement('div');
      el.className = 'placement-key-hint';
      document.body.appendChild(el);
      this._placementKeyHintEl = el;
    }
    this._placementKeyHintEl.innerHTML = html;
    const margin = 8;
    const width = this._placementKeyHintEl.offsetWidth || 190;
    const height = this._placementKeyHintEl.offsetHeight || 24;
    this._placementKeyHintEl.style.left = Math.max(
      margin, Math.min(screenX + 16, window.innerWidth - width - margin),
    ) + 'px';
    this._placementKeyHintEl.style.top = Math.max(
      margin, Math.min(screenY + 24, window.innerHeight - height - margin),
    ) + 'px';
  }

  _hidePlacementKeyHint() {
    this._placementKeyHintEl?.remove?.();
    this._placementKeyHintEl = null;
  }

  _checkHoverTooltip(world, grid, screenX, screenY) {
    const col = grid.col, row = grid.row;
    const key = col + ',' + row;

    // Staff are animated independently of placeables and can stand directly
    // in front of equipment. Match click picking by giving the visible person
    // priority, then reuse the inspector's canonical activity description.
    const staffHit = this.renderer.raycastStaffScreen?.(screenX, screenY);
    if (staffHit?.staffId) {
      const member = (this.game.state.staffMembers || [])
        .find(candidate => candidate.id === staffHit.staffId);
      if (member) {
        this._setHoverTooltip(
          `staff:${member.id}`,
          staffHoverInfo(member, this.game),
          screenX,
          screenY,
        );
        return;
      }
    }

    // Visible 3D objects win over lines or tile fallbacks.
    const hit = this.renderer.raycastScreen?.(screenX, screenY);
    const hitInfo = hit ? this.renderer.identifyHit?.(hit) : null;
    if (hitInfo) {
      const rootId = hitInfo.nodeId ?? hitInfo.attachmentId ?? hitInfo.rootObj?.userData?.nodeId;
      let entry = rootId ? this.game.getPlaceable?.(rootId) : null;
      if (!entry && hitInfo.group === 'attachment' && rootId) {
        for (const pipe of (this.game.state.beamPipes || [])) {
          entry = (pipe.placements || []).find(p => p.id === rootId);
          if (entry) break;
        }
      }
      if (!entry && hitInfo.group === 'utilityAttachment' && rootId) {
        const line = this.game.state.utilityLines?.get(hitInfo.lineId);
        entry = line?.attachments?.find(a => a.id === rootId) || null;
      }
      if (!entry && hitInfo.rootObj
          && (hitInfo.group === 'equipment' || hitInfo.group === 'decoration')) {
        const p = hitInfo.rootObj.position;
        entry = this._placeableAtWorldPos?.(p.x, p.z);
      }
      const def = entry && (COMPONENTS[entry.type] || PLACEABLES[entry.type]);
      if (def) {
        this._setHoverTooltip(
          `placeable:${entry.id}`,
          this._componentHoverInfo(entry, def),
          screenX,
          screenY,
        );
        return;
      }
      if (hitInfo.group === 'beampipe' && hitInfo.pipeId) {
        const pipe = (this.game.state.beamPipes || []).find(p => p.id === hitInfo.pipeId);
        const nodeId = pipe?.start?.junctionId || pipe?.end?.junctionId;
        const node = nodeId ? this.game.getPlaceable?.(nodeId) : null;
        const beamline = node?.beamlineId ? this.game.registry?.get(node.beamlineId) : null;
        this._setHoverTooltip(`beampipe:${hitInfo.pipeId}`, {
          title: 'Beam Pipe',
          detail: beamline ? beamline.name : 'Beamline transport',
        }, screenX, screenY);
        return;
      }
    }

    // Utility lines report their solved network load immediately.
    const utilityHit = this.renderer.raycastUtilityLine?.(screenX, screenY);
    if (utilityHit?.lineId) {
      const type = utilityHit.utilityType
        || this.game.state.utilityLines?.get?.(utilityHit.lineId)?.utilityType;
      if (!type) { this._hideTooltip(); return; }
      const networks = this.game.state.utilityNetworks?.get?.(type) || [];
      const network = networks.find(n => (n.lineIds || []).includes(utilityHit.lineId));
      const flow = network
        ? this.game.state.utilityNetworkData?.get?.(type)?.get?.(network.id)
        : null;
      this._setHoverTooltip(`utility:${utilityHit.lineId}`,
        utilityNetworkHoverInfo(UTILITY_TYPES[type], flow), screenX, screenY);
      return;
    }

    // Check furnishings (sub-tile)
    const subgrid = this.game.state.zoneFurnishingSubgrids[key];
    if (subgrid) {
      const tilePos = gridToIso(col, row);
      const sub = isoToSubGrid(world.x - tilePos.x, world.y - tilePos.y);
      const sc = Math.floor(sub.subCol);
      const sr = Math.floor(sub.subRow);
      if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
        const furnIdx = subgrid[sr][sc];
        if (furnIdx > 0) {
          const entry = this.game.state.zoneFurnishings[furnIdx - 1];
          if (entry) {
            const targetId = 'furn:' + entry.id;
            const def = ZONE_FURNISHINGS[entry.type];
            this._setHoverTooltip(targetId, furnishingHoverInfo(def), screenX, screenY);
            return;
          }
        }
      }
    }

    // Check facility equipment
    const equipId = this.game.state.facilityGrid[key];
    if (equipId) {
      const targetId = 'equip:' + equipId;
      const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
      const comp = equip && COMPONENTS[equip.type];
      this._setHoverTooltip(targetId, this._componentHoverInfo(equip, comp), screenX, screenY);
      return;
    }

    // Nothing hovered — clear
    if (this._hoverTooltipTarget) {
      this._hideTooltip();
    }
  }

  // --- Demolish hover ---

  /** Hover UX for DemolishTool: outline + refund tooltip. `dt` is the
   *  tool's demolishType (the field died with the demolish conversion). */
  /**
   * The stretch of pipe the demolish tool would remove right now, as
   * `{ pipeId, fromSub, toSub, path, refund, metres, wholePipe }`, or null if
   * the cursor isn't on `pipe`.
   *
   * ONE resolver for both the hover highlight and the click that commits, so
   * the red section the player is shown is exactly the section they get, and
   * the quoted refund is exactly what gets paid (`pipeRefund` over the same
   * geometry Game/BeamlineSystem price from).
   *
   * Three modes, in priority order:
   *   - Shift held      → the whole run, mirroring demolishBuilding's
   *                       Shift-click "take the whole connected wall" gesture.
   *   - `sweep` present → every sub-unit between the press and the cursor.
   *                       Sub-units are 0.5 m, so a drag is what makes the
   *                       fine granularity usable for clearing a long run.
   *   - otherwise       → the single sub-unit under the cursor.
   *
   * @param {object} pipe  - the beam pipe entry from state
   * @param {object} world - iso screen-space cursor position ({x, y})
   * @param {object|null} sweep - `{ pipeId, index }` anchor of an active drag
   */
  _demolishPipeSection(pipe, world, sweep = null) {
    if (!pipe) return null;
    const subL = pipeSubL(pipe);
    const whole = () => ({ fromSub: 0, toSub: subL });

    let range;
    if (this._shiftDown) {
      range = whole();
    } else {
      const gf = isoToGridFloat(world.x, world.y);
      const at = pipeSubUnitAt(pipe, gf.col * 2, gf.row * 2);
      if (!at) return null;
      if (sweep && sweep.pipeId === pipe.id) {
        // Inclusive of both ends: the anchor sub-unit and the one under the
        // cursor are both part of what the player swept over.
        range = {
          fromSub: Math.min(sweep.index, at.index),
          toSub: Math.max(sweep.index, at.index) + 1,
        };
      } else {
        range = { fromSub: at.index, toSub: at.index + 1 };
      }
    }

    const path = pipeSubUnitPath(pipe, range.fromSub, range.toSub);
    if (!path) return null;
    const wholePipe = range.fromSub === 0 && range.toSub === subL;
    // A section cut refuses to swallow mounted hardware (pipe-splice.js
    // rejects with `placement_in_gap`), so say so in the hover rather than
    // quoting a refund the click can't pay. A WHOLE-pipe delete is a different
    // gesture that does take its hardware with it, and is never blocked.
    const from = range.fromSub / subL;
    const blocked = !wholePipe && (pipe.placements || []).some(pl =>
      placementsConflict(subL, pl, {
        position: from,
        subL: range.toSub - range.fromSub,
        inline: false,
      }));
    return {
      pipeId: pipe.id,
      fromSub: range.fromSub,
      toSub: range.toSub,
      path,
      blocked,
      refund: blocked ? 0 : pipeRefund({ path }),
      metres: (range.toSub - range.fromSub) * METRES_PER_SUB,
      wholePipe,
    };
  }

  /** Tooltip title for a pipe section: what it is, how long, or why not. */
  _pipeSectionLabel(section) {
    if (section.wholePipe) return 'Beam Pipe';
    if (section.blocked) return 'Beam Pipe · remove the hardware first';
    return `Beam Pipe · ${section.metres} m`;
  }

  /**
   * @param {object|null} pipeSweep - `{ pipeId, index }` when a section drag is
   *   in flight, so the hover highlights the whole swept range rather than the
   *   single sub-unit under the cursor.
   */
  _updateDemolishHover(world, grid, screenX, screenY, policyOrType, pipeSweep = null) {
    const col = grid.col, row = grid.row;
    const key = tileKey(col, row, this.game.activeLevel);
    const policy = typeof policyOrType === 'string'
      ? legacyDemolishPolicy(policyOrType)
      : policyOrType;

    // --- Live pipe-section sweep ---
    // A drag in flight owns the hover outright: it resolves against the pipe
    // the press anchored on, not whatever the cursor is over now. Going
    // through the pick below instead would highlight a neighbouring pipe when
    // the drag strays across one, and would blank the highlight entirely
    // whenever the cursor wandered off the pipe — while the release still
    // committed the swept range.
    if (pipeSweep) {
      const swept = (this.game.state.beamPipes || []).find(p => p.id === pipeSweep.pipeId);
      const section = swept && this._demolishPipeSection(swept, world, pipeSweep);
      if (section) {
        this.renderer._clearPreview();
        if (!section.blocked) this.renderer.renderBeamPipePreview(section.path, 'remove');
        this._showDemolishTooltip(this._pipeSectionLabel(section), section.refund, screenX, screenY);
        return;
      }
    }

    // --- Unified placeable detection ---
    // Any demolish mode with a placeable scope uses the same hover UX:
    // outline the mesh and show a tooltip with the refund.
    if (policy) {
      // Hover runs on every pointer move, so keep it to one exact ray. The
      // click path uses the full tolerance; footprint fallbacks below still
      // provide broad hover feedback for hollow models.
      const found = this._findDeletablePlaceable(world, grid, screenX, screenY, policy, 0);
      if (found) {
        this.renderer._clearPreview();
        // Beam pipes draw a section highlight below instead: outlining the
        // whole mesh would advertise a whole-run delete this click won't do.
        if (found.rootObj && found.kind !== 'beampipe') {
          this.renderer._outlineObject(found.rootObj);
        }

        // Placements: refund is 50% of the placement component's cost.
        if (found.kind === 'placement') {
          const def = found.placeable;
          const name = def?.name || found.attachment?.type || 'Attachment';
          const cost = def?.cost?.funding || 0;
          const refund = Math.floor(cost * 0.5);
          this._showDemolishTooltip(name, refund, screenX, screenY);
          return;
        }
        // Beam pipes. Under demolishBeamline they are cut by the SECTION, so
        // highlight just the stretch this gesture would take (Shift widens it
        // to the whole run). demolishAll stays all-or-nothing — it is the
        // "level everything here" tool — and keeps the whole-pipe quote.
        if (found.kind === 'beampipe') {
          const pipe = (this.game.state.beamPipes || []).find(p => p.id === found.pipeId);
          if (!pipe) {
            this._showDemolishTooltip('Beam Pipe', 0, screenX, screenY);
            return;
          }
          // No sweep argument: a live drag already returned above.
          const section = policy.allowsCategory('beamline')
            ? this._demolishPipeSection(pipe, world)
            : null;
          if (section) {
            if (!section.blocked) this.renderer.renderBeamPipePreview(section.path, 'remove');
            this._showDemolishTooltip(
              this._pipeSectionLabel(section), section.refund, screenX, screenY,
            );
          } else {
            // Shared with Game.removeBeamPipe so the tooltip can't promise a
            // different number than the demolish actually credits.
            if (found.rootObj) this.renderer._outlineObject(found.rootObj);
            this._showDemolishTooltip('Beam Pipe', pipeRefund(pipe), screenX, screenY);
          }
          return;
        }

        const def = found.placeable;
        const name = def?.name ?? found.entry?.type ?? found.node?.type ?? 'Unknown';
        // A beamline junction takes its connected pipes (and everything placed
        // on them) with it — Game.removePlaceable routes those through
        // removeBeamPipe. Quote the whole payout, not just the module's own
        // 50%, so the tooltip can't understate what the click is worth.
        this._showDemolishTooltip(
          name,
          demolishRefund(def) + this._connectedPipeRefund(found.entry?.id || found.node?.id),
          screenX, screenY,
        );
        return;
      }
    }

    // --- Tile-based fallback for flat objects (zones, floors, connections) ---
    let found = false;

    // Utility lines — raycast-based hover (lines are narrow 3D groups, not
    // tile occupants).
    if (!found && policy?.allowsCategory('infra')) {
      const hit = this.renderer.raycastUtilityLine?.(screenX, screenY);
      if (hit?.busId) {
        this.renderer._clearPreview();
        const bus = this.game.utilityBusSystem?.getBus(hit.busId);
        this._showDemolishTooltip(
          'Universal Utility Bus', (bus?.costFunding || 0) * 0.5, screenX, screenY,
        );
        found = true;
      } else if (hit && hit.lineId) {
        // Drop the previous frame's outline/tile highlight like every sibling
        // branch does — utility lines have no highlight of their own, so the
        // stale one stayed on screen while the tooltip named the line.
        this.renderer._clearPreview();
        const descriptor = UTILITY_TYPES[hit.utilityType];
        this._showDemolishTooltip(
          (descriptor?.displayName || hit.utilityType || 'Utility') + ' Line',
          0, screenX, screenY,
        );
        found = true;
      }
    }

    // Walls / doors — edge-based hover (checks both edge-key aliases).
    // Highlight the matched edge; with Shift held in Building mode,
    // preview the whole connected run.
    if (!found && (policy?.allowsCategory('structure') || policy?.allowsCategory('grounds'))) {
      const hit = this.findDemolishableEdgeAtScreen(screenX, screenY);
      if (hit && policy.allowsEdge(hit)) {
        const { edge, overlayType, wallType, doorType, windowType } = hit;
        if (this._shiftDown) {
          const seg = overlayType
            ? this._buildWallOverlaySegmentPath(edge)
            : wallType
            ? this._buildWallSegmentPath(edge)
            : doorType
              ? this._buildDoorSegmentPath(edge)
              : this._buildWindowSegmentPath(edge);
          if (seg.length > 1) this.renderer.renderDemolishPathPreview(seg);
          else this.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
        } else {
          this.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
        }
        const def = overlayType ? WALL_TYPES[overlayType] : wallType ? WALL_TYPES[wallType] : doorType ? DOOR_TYPES[doorType] : WINDOW_TYPES[windowType];
        // Price the variant that is actually standing there: walls and
        // windows are charged and refunded per variant, so a base-cost
        // preview would promise the wrong money back (a Reinforced
        // structuralWall refunds 17, not 12).
        const kind = overlayType ? 'overlay' : wallType ? 'wall' : doorType ? 'door' : 'window';
        this._showDemolishTooltip(
          def?.name || (overlayType ? 'Wall layer' : wallType ? 'Wall' : doorType ? 'Door' : 'Window'),
          demolishRefund(def, this._placedEdgeVariant(kind, edge)), screenX, screenY,
        );
        found = true;
      }
    }

    // Zones
    if (!found && policy?.allowsCategory('facility')) {
      const zoneType = this.game.state.zoneOccupied[key];
      if (zoneType) {
        const zone = ZONES[zoneType];
        this.renderer.renderDemolishTileOutline(col, row);
        this._showDemolishTooltip(zone ? zone.name : zoneType, 0, screenX, screenY);
        found = true;
      }
    }

    // Infrastructure / floor
    if (!found) {
      const infraType = this.game.state.infraOccupied[key];
      if (infraType && policy?.allowsFloor(infraType)) {
        const infra = FLOORS[infraType];
        this.renderer.renderDemolishTileOutline(col, row);
        this._showDemolishTooltip(infra ? infra.name : infraType, infra ? Math.floor((infra.cost || 0) * 0.5) : 0, screenX, screenY);
        found = true;
      }
    }

    if (!found) {
      this.renderer.clearDragPreview();
      this._hideDemolishTooltip();
    }
  }

  /**
   * Refund for everything that goes with a junction: each connected pipe plus
   * 50% of every component placed on it. Mirrors Game.removeBeamPipe, which is
   * what Game.removePlaceable now calls for those pipes.
   */
  _connectedPipeRefund(junctionId) {
    if (!junctionId) return 0;
    let total = 0;
    for (const pipe of (this.game.state.beamPipes || [])) {
      if (pipe.start?.junctionId !== junctionId && pipe.end?.junctionId !== junctionId) continue;
      total += pipeRefund(pipe);
      for (const att of (pipe.placements || [])) {
        total += Math.floor((COMPONENTS[att.type]?.cost?.funding || 0) * 0.5);
      }
    }
    return total;
  }

  _showDemolishTooltip(name, refund, screenX, screenY) {
    if (!this._demolishTooltipEl) {
      const el = document.createElement('div');
      el.className = 'hover-tooltip demolish-tooltip';
      document.body.appendChild(el);
      this._demolishTooltipEl = el;
    }
    const el = this._demolishTooltipEl;
    let html = `<span style="color:#ff6666">${name}</span>`;
    if (refund > 0 && this.game.sandboxMode) {
      html += '<br><span style="color:#d6b867">No refund · free sandbox build</span>';
    } else if (refund > 0) {
      html += `<br><span style="color:#66ff88">+$${refund.toLocaleString()}</span>`;
    }
    el.innerHTML = html;
    el.style.left = (screenX + 14) + 'px';
    el.style.top = (screenY - 10) + 'px';
    el.style.display = 'block';
  }

  _hideDemolishTooltip() {
    if (this._demolishTooltipEl) {
      this._demolishTooltipEl.style.display = 'none';
    }
  }

  /**
   * Show a green-dollar cost tooltip next to the cursor during infra drag.
   * Passing cost=0 shows "Free". Passing a non-zero skippedNoFoundation also
   * shows a red warning line about missing foundation. `opts.note` adds one
   * neutral line above the warnings (utility run-wiring's sink count).
   */
  _showDragCostTooltip(cost, screenX, screenY, opts = {}) {
    if (!this._dragCostTooltipEl) {
      const el = document.createElement('div');
      el.className = 'hover-tooltip drag-cost-tooltip';
      document.body.appendChild(el);
      this._dragCostTooltipEl = el;
    }
    const el = this._dragCostTooltipEl;
    let html;
    if (cost > 0) {
      html = `<span style="color:#66ff88">$${cost.toLocaleString()}</span>`;
    } else {
      html = `<span style="color:#88ccff">Free</span>`;
    }
    if (opts.note) {
      html += `<br><span style="color:#ffd27a">${opts.note}</span>`;
    }
    if (opts.skippedNoFoundation > 0) {
      html += `<br><span style="color:#ff6666">${opts.skippedNoFoundation} tile(s) need ${opts.foundationName || 'foundation'}</span>`;
    }
    if (opts.insufficientFunding) {
      html += `<br><span style="color:#ff6666">Insufficient funds</span>`;
    }
    el.innerHTML = html;
    el.style.left = (screenX + 14) + 'px';
    el.style.top = (screenY - 10) + 'px';
    el.style.display = 'block';
  }

  _hideDragCostTooltip() {
    if (this._dragCostTooltipEl) {
      this._dragCostTooltipEl.style.display = 'none';
    }
  }

  // --- Helper methods for multi-beamline support ---

  _getNodeAtGrid(col, row) {
    // Find a beamline placeable whose cells cover this tile
    for (const p of this.game.state.placeables) {
      const def = COMPONENTS[p.type];
      if (!def || def.category !== 'beamline' || !sameLevel(p, this.game.activeLevel)) continue;
      const cells = p.cells || [{ col: p.col, row: p.row }];
      if (cells.some(c => c.col === col && c.row === row)) {
        return p;
      }
    }
    // Check beam pipe paths — resolve to a connected beamline node
    for (const pipe of this.game.state.beamPipes) {
      if (pipe.path && pipe.path.some(t => t.col === col && t.row === row)) {
        const nodeId = pipe.start?.junctionId || pipe.end?.junctionId;
        if (nodeId) {
          const p = this.game.state.placeables.find(pl => pl.id === nodeId);
          if (p) return p;
        }
      }
    }
    return null;
  }

  /** Find the beamline node represented by visible projected geometry. */
  _getNodeAtScreenOrGrid(screenX, screenY, col, row) {
    // In the real renderer a miss means the cursor is on visible ground. Do
    // not turn that miss into a hit merely because the ground tile is part of
    // a component's rectangular footprint. The grid lookup remains only as a
    // compatibility path for non-rendering test/legacy harnesses.
    if (typeof this.renderer.raycastScreen === 'function') {
      const hit = this.renderer.raycastScreen(screenX, screenY, OBJECT_PICK_TOLERANCE_PX);
      if (hit) {
        const info = this.renderer.identifyHit(hit);
        if (info) {
          if (info.group === 'component' && info.nodeId) {
            const p = this.game.state.placeables.find(pl => pl.id === info.nodeId);
            if (p) return p;
          }
          // Attachment or beam pipe click — resolve to a connected beamline node
          if ((info.group === 'attachment' || info.group === 'beampipe') && info.pipeId) {
            const pipe = this.game.state.beamPipes.find(bp => bp.id === info.pipeId);
            if (pipe) {
              const nodeId = pipe.start?.junctionId || pipe.end?.junctionId;
              if (nodeId) {
                const p = this.game.state.placeables.find(pl => pl.id === nodeId);
                if (p) return p;
              }
            }
          }
        }
      }
      return null;
    }
    return this._getNodeAtGrid(col, row);
  }

  _selectionRootAt(screenX, screenY) {
    const hit = this.renderer.raycastScreen?.(screenX, screenY, OBJECT_PICK_TOLERANCE_PX);
    return hit ? this.renderer.identifyHit?.(hit)?.rootObj || null : null;
  }

  _clearSelection() {
    this.selectedNodeId = null;
    this.selectedPlaceableId = null;
    this.selectedPlaceableIds.clear();
    this._selectedRootsById.clear();
    this._selectionCandidatesByKey?.clear?.();
    this.renderer.clearSelectionOutline?.();
    this.renderer.closeSelectionWindow?.();
  }

  _selectionTarget(key) {
    const current = this.game?.state
      ? selectionTargetByKey(this.game.state, key)
      : selectionTargetForPlaceable(this.game?.getPlaceable?.(key));
    const candidate = this._selectionCandidatesByKey?.get?.(key);
    if (!current) return candidate || null;
    return {
      ...current,
      rootObj: candidate?.rootObj || this._selectedRootsById?.get?.(key) || current.rootObj || null,
    };
  }

  _selectionTargets(keys = this.selectedPlaceableIds) {
    const resolve = typeof this._selectionTarget === 'function'
      ? key => this._selectionTarget(key)
      : key => InputHandler.prototype._selectionTarget.call(this, key);
    return [...(keys || [])].map(resolve).filter(Boolean);
  }

  _renderSelectionOutlines() {
    const targets = typeof this._selectionTargets === 'function'
      ? this._selectionTargets()
      : InputHandler.prototype._selectionTargets.call(this);
    if (this.renderer.setSelectionTargets) this.renderer.setSelectionTargets(targets);
    else {
      const roots = targets.map(target => target.rootObj).filter(Boolean);
      if (this.renderer.setSelectionOutlines) this.renderer.setSelectionOutlines(roots);
      else this.renderer.setSelectionOutline?.(roots[roots.length - 1] || null);
    }
    const beamlineTarget = targets.length === 1
      && targets[0]?.selectionCategory === 'beamline'
      ? targets[0]
      : null;
    this.renderer.setSelectedBeamlineFocus?.(
      beamlineTarget
        ? selectedBeamlineFocusModel(this.game.state, this.game.registry, beamlineTarget)
        : null,
    );
  }

  /** Re-resolve transient selection presentation after status/topology changes. */
  refreshSelectionPresentation() {
    this._renderSelectionOutlines();
  }

  /** Open the inspector appropriate for one selected placeable. */
  _openPlaceableInfoWindow(entry) {
    if (!entry) return;
    if (entry.category === 'beamline') {
      const blId = entry.beamlineId;
      if (!blId) return;
      this.game.selectedBeamlineId = blId;
      this.renderer._openBeamlineWindow(blId, entry);
      this.game.emit('beamlineSelected', blId);
      return;
    }
    this.renderer.openEquipmentWindow?.(entry);
  }

  /** Leave one live context window representing the complete selection. */
  _reconcileSelectionWindow(previousIds = []) {
    const selectedTargets = typeof this._selectionTargets === 'function'
      ? this._selectionTargets()
      : InputHandler.prototype._selectionTargets.call(this);
    const useSelectionPanel = selectedTargets.length > 1
      || selectedTargets.some(target => target.targetKind !== 'placeable')
      || (this._selectionCandidatesByKey?.size || 0) > selectedTargets.length;

    if (useSelectionPanel && typeof this.renderer.openSelectionWindow === 'function') {
      for (const key of new Set([...(previousIds || []), ...this.selectedPlaceableIds])) {
        const target = this._selectionTarget(key);
        if (target?.entry) this.renderer.closePlaceableInfoWindow?.(target.entry);
      }
      const primary = (typeof this._selectionTarget === 'function'
        ? this._selectionTarget(this.selectedPlaceableId)
        : InputHandler.prototype._selectionTarget.call(this, this.selectedPlaceableId))
        || selectedTargets.at(-1)
        || [...(this._selectionCandidatesByKey?.values?.() || [])].at(-1)
        || null;
      if (primary) this.renderer.openSelectionWindow?.(primary);
      else this.renderer.closeSelectionWindow?.();
      this.renderer.refreshContextWindows?.();
      return primary;
    }

    this.renderer.closeSelectionWindow?.();
    return reconcileSelectionWindow({
      previousIds,
      selectedIds: [...this.selectedPlaceableIds],
      primaryId: this.selectedPlaceableId,
      getPlaceable: id => this.game.getPlaceable(id),
      closeWindow: entry => this.renderer.closePlaceableInfoWindow?.(entry),
      openWindow: entry => this._openPlaceableInfoWindow(entry),
      refreshWindows: () => this.renderer.refreshContextWindows?.(),
    });
  }

  /** Read-only model consumed by the mixed-category context panel. */
  selectionPanelState() {
    const candidates = [...this._selectionCandidatesByKey.values()]
      .map(target => this._selectionTarget(target.key) || target);
    return {
      candidates,
      entries: this._selectionTargets(),
      clipboardCount: selectionPayloadCount(this._selectionClipboard),
      slots: Object.fromEntries(Object.entries(this._selectionSlots || {})
        .map(([slot, payload]) => [slot, selectionPayloadCount(payload)])),
    };
  }

  /** Category defaults used by direct clicks and each newly drawn marquee. */
  mouseSelectionCategories() {
    return new Set(this._mouseSelectionCategories);
  }

  setMouseSelectionCategory(category, enabled) {
    if (!isSelectionCategory(category)) return false;
    if (enabled) this._mouseSelectionCategories.add(category);
    else this._mouseSelectionCategories.delete(category);
    saveMouseSelectionCategories(this._mouseSelectionCategories);
    return true;
  }

  /** Public command seam for SelectionWindow; UI code never reaches internals. */
  dispatchSelectionPanelAction(action, value = null) {
    const formationSelection = kind => this._selectionIdsForPanelAction(kind);
    if (action === 'move') {
      const selection = formationSelection('move');
      return this._beginSelectionPlacement('move', selection.anchorId, selection.ids);
    }
    if (action === 'copy') {
      const selection = formationSelection('copy');
      return this._copySelectionToClipboard(selection.anchorId, selection.ids);
    }
    if (action === 'paste') return this._pasteSelectionClipboard();
    if (action === 'saveSlot') {
      const selection = formationSelection('copy');
      return this._saveSelectionSlot(value, selection.anchorId, selection.ids);
    }
    if (action === 'rotate' || action === 'mirror') {
      const selection = formationSelection('move');
      return this._beginSelectionTransform(action, selection.anchorId, selection.ids);
    }
    if (action === 'demolish') return this._demolishSelected();
    if (action === 'toggleCategory') return this._toggleSelectionCategory(value);
    return false;
  }

  _selectionIdsForPanelAction(kind) {
    const targets = this._selectionTargets();
    const compatible = targets.filter(target => (
      target.selectionCategory !== 'beamline'
      && (kind !== 'move' || target.targetKind === 'placeable')
    ));
    const ids = compatible.map(target => target.key);
    return {
      ids,
      anchorId: ids.includes(this.selectedPlaceableId)
        ? this.selectedPlaceableId
        : ids.at(-1) || null,
    };
  }

  _toggleSelectionCategory(category) {
    const candidates = [...(this._selectionCandidatesByKey?.values?.() || [])]
      .filter(target => target.selectionCategory === category);
    if (!candidates.length) return false;
    const previous = [...this.selectedPlaceableIds];
    const enabled = candidates.some(target => this.selectedPlaceableIds.has(target.key));
    for (const target of candidates) {
      if (enabled) {
        this.selectedPlaceableIds.delete(target.key);
        this._selectedRootsById.delete(target.key);
      } else {
        this.selectedPlaceableIds.add(target.key);
        if (target.rootObj) this._selectedRootsById.set(target.key, target.rootObj);
      }
    }
    const selected = [...this.selectedPlaceableIds];
    this.selectedPlaceableId = selected.at(-1) || null;
    const primary = this._selectionTarget(this.selectedPlaceableId);
    this.selectedNodeId = primary?.selectionCategory === 'beamline'
      && primary.targetKind === 'placeable' ? primary.id : null;
    this._renderSelectionOutlines();
    this._reconcileSelectionWindow(previous);
    return true;
  }

  _beginMarquee(e) {
    this._marquee = {
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
      additive: !!e.shiftKey,
      dragging: false,
    };
  }

  _updateMarquee(e) {
    const marquee = this._marquee;
    if (!marquee) return false;
    marquee.endX = e.clientX;
    marquee.endY = e.clientY;
    marquee.dragging = marquee.dragging || Math.hypot(
      marquee.endX - marquee.startX,
      marquee.endY - marquee.startY,
    ) >= MARQUEE_DRAG_THRESHOLD_PX;
    if (!marquee.dragging) return false;
    if (!this._marqueeEl) {
      const el = document.createElement('div');
      el.className = 'selection-marquee';
      document.body.appendChild(el);
      this._marqueeEl = el;
    }
    const left = Math.min(marquee.startX, marquee.endX);
    const top = Math.min(marquee.startY, marquee.endY);
    this._marqueeEl.style.left = left + 'px';
    this._marqueeEl.style.top = top + 'px';
    this._marqueeEl.style.width = Math.abs(marquee.endX - marquee.startX) + 'px';
    this._marqueeEl.style.height = Math.abs(marquee.endY - marquee.startY) + 'px';
    return true;
  }

  _clearMarquee() {
    this._marqueeEl?.remove?.();
    this._marqueeEl = null;
    this._marquee = null;
  }

  _finishMarquee(e) {
    const marquee = this._marquee;
    if (!marquee) return false;
    const previousSelection = [...this.selectedPlaceableIds];
    this._updateMarquee(e);
    if (!marquee.dragging) {
      this._clearMarquee();
      return false;
    }
    const rect = {
      left: Math.min(marquee.startX, marquee.endX),
      right: Math.max(marquee.startX, marquee.endX),
      top: Math.min(marquee.startY, marquee.endY),
      bottom: Math.max(marquee.startY, marquee.endY),
    };
    const logicalMatches = this.renderer.selectionTargetsInScreenRect?.(rect);
    const matches = logicalMatches || (this.renderer.placeablesInScreenRect?.(rect) || [])
      .map(match => ({
        ...match,
        target: selectionTargetForPlaceable(match.entry, match.rootObj),
      }));
    if (!marquee.additive) {
      this.selectedPlaceableIds.clear();
      this._selectedRootsById.clear();
      this._selectionCandidatesByKey?.clear?.();
    }
    for (const match of matches) {
      const target = match?.target;
      if (!target?.key) continue;
      const candidate = { ...target, rootObj: match.rootObj || target.rootObj || null };
      this._selectionCandidatesByKey?.set?.(target.key, candidate);
      if (!mouseSelectionCategoryEnabled(
        this._mouseSelectionCategories, target.selectionCategory,
      )) continue;
      this.selectedPlaceableIds.add(target.key);
      if (candidate.rootObj) this._selectedRootsById.set(target.key, candidate.rootObj);
    }
    const selected = [...this.selectedPlaceableIds];
    this.selectedPlaceableId = selected[selected.length - 1] || null;
    const primary = this.selectedPlaceableId && (typeof this._selectionTarget === 'function'
      ? this._selectionTarget(this.selectedPlaceableId)
      : InputHandler.prototype._selectionTarget.call(this, this.selectedPlaceableId));
    this.selectedNodeId = primary?.selectionCategory === 'beamline'
      && primary.targetKind === 'placeable' ? primary.id : null;
    this._renderSelectionOutlines();
    this._reconcileSelectionWindow(previousSelection);
    this._clearMarquee();
    this._showToast(selected.length
      ? `Selected ${selected.length} item${selected.length === 1 ? '' : 's'}`
      : 'Nothing selected');
    return true;
  }

  /** Current paid line plan for a utility device's context action. */
  _panelAutoConnectPlan(panelId) {
    const revision = this.game.solveRunner?.topologyRevision;
    if (Number.isFinite(revision)) {
      if (this._panelAutoConnectPlanCacheRevision !== revision) {
        this._panelAutoConnectPlanCache?.clear();
        this._panelAutoConnectPlanCacheRevision = revision;
      }
      const cached = this._panelAutoConnectPlanCache?.get(panelId);
      if (cached) return cached;
    }

    const plan = planPanelAutoConnect(this.game.state, panelId, {
      // Match ordinary interactive wiring to the connector actually visible
      // on the model, falling back to logical footprint geometry headlessly.
      portPosition: (endpoint, def, portName) => {
        const anchor = portAnchor3D(endpoint, def, portName);
        return anchor
          ? { x: anchor.x, z: anchor.z }
          : portWorldPosition(endpoint, def, portName);
      },
    });
    if (Number.isFinite(revision)) {
      (this._panelAutoConnectPlanCache ||= new Map()).set(panelId, plan);
    }
    return plan;
  }

  /** Dynamic world-hover copy for utility devices; ordinary loads stay catalogue-only. */
  _componentHoverInfo(entry, def) {
    const autoConnectPlan = entry?.id && utilityAutoConnectProfile(def)
      ? this._panelAutoConnectPlan(entry.id)
      : null;
    return componentHoverInfo(def, { autoConnectPlan });
  }

  /** Resolve an auto-connect utility device from the current world-hover tooltip. */
  _hoveredAutoConnectPanelId() {
    const match = /^(?:placeable|equip):(.+)$/.exec(this._hoverTooltipTarget || '');
    if (!match) return null;
    const panel = this.game.getPlaceable?.(match[1])
      || this.game.state?.placeables?.find?.(entry => entry.id === match[1]);
    const def = panel && (COMPONENTS[panel.type] || PLACEABLES[panel.type]);
    return utilityAutoConnectProfile(def) ? panel.id : null;
  }

  /** A single selected utility device is the fallback Tab target. */
  _selectedAutoConnectPanelId() {
    const ids = this._selectionIdsForAnchor(this.selectedPlaceableId);
    if (ids.length !== 1) return null;
    const panel = this.game.getPlaceable?.(ids[0])
      || this.game.state?.placeables?.find?.(entry => entry.id === ids[0]);
    const def = panel && (COMPONENTS[panel.type] || PLACEABLES[panel.type]);
    return utilityAutoConnectProfile(def) ? panel.id : null;
  }

  /** Auto-connect-capable endpoints represented by the current selection. */
  _selectedAutoConnectPanelIds() {
    return this._selectionTargets()
      .map(target => target.id)
      .filter((id, index, ids) => id && ids.indexOf(id) === index)
      .filter(id => {
        const endpoint = findUtilityEndpoint(this.game.state, id);
        const def = endpoint && (COMPONENTS[endpoint.type] || PLACEABLES[endpoint.type]);
        return !!utilityAutoConnectProfile(def);
      });
  }

  /** The hovered panel wins; selection preserves the existing keyboard path. */
  panelAutoConnectTargetId() {
    return this._hoveredAutoConnectPanelId() || this._selectedAutoConnectPanelId();
  }

  /** Public keyboard coordinator for device connections versus palette Tab. */
  handlePanelAutoConnectKey(event) {
    if (event?.key !== 'Tab' || event.shiftKey || event.metaKey || event.altKey) {
      return false;
    }
    const panelId = this.panelAutoConnectTargetId();
    if (!panelId) return false;
    event.preventDefault();
    if (!event.repeat) {
      if (event.ctrlKey) this._disconnectAutoConnectPanel(panelId);
      else this._autoConnectPanel(panelId);
    }
    return true;
  }

  /** T removes utility runs from selected assisted-wiring devices. */
  handleDisconnectSelectedUtilitiesKey(event) {
    if ((event?.key !== 't' && event?.key !== 'T')
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const panelIds = this._selectedAutoConnectPanelIds();
    if (panelIds.length === 0) return false;
    event.preventDefault?.();
    if (!event.repeat) this._disconnectSelectedAutoConnectPanels(panelIds);
    return true;
  }

  _disconnectSelectedAutoConnectPanels(panelIds) {
    const removed = disconnectAutoConnectDevices(this.game, panelIds);
    if (removed.length === 0) this._showToast('No utility connections to remove');
    else {
      this._showToast(
        `Removed ${removed.length} utility connection${removed.length === 1 ? '' : 's'}`,
      );
    }
    this.renderer.refreshContextWindows?.();
    this._renderSelectionOutlines();
    return removed;
  }

  /** Destroy every utility line terminating on this auto-connect device. */
  _disconnectAutoConnectPanel(panelId) {
    const removed = disconnectAutoConnectDevice(this.game, panelId);
    if (removed.length === 0) this._showToast('No utility connections to remove');
    else {
      this._showToast(
        `Removed ${removed.length} utility connection${removed.length === 1 ? '' : 's'}`,
      );
    }
    this.renderer.refreshContextWindows?.();
    this._renderSelectionOutlines();
    return removed;
  }

  /** Re-plan at click time, then land all valid cables in one undo gesture. */
  _autoConnectPanel(panelId) {
    const plan = this._panelAutoConnectPlan(panelId);
    if (!plan.stubs.length) {
      const label = UTILITY_TYPES[plan.utilityType]?.displayName || 'utility';
      if (plan.outlets === 0) this._showToast(`No free ${label} connectors`);
      else if (plan.candidates === 0) {
        this._showToast(`No unconnected ${label} devices within ${plan.radius} tiles`);
      } else this._showToast(`No clear ${label} routes to nearby devices`);
      return [];
    }
    const committed = commitPanelAutoConnect(this.game, plan);
    this.renderer.refreshContextWindows?.();
    this._renderSelectionOutlines();
    return committed;
  }

  /** Select a world object, persist its outline, and open its info menu. */
  _selectPlaceable(entry, rootObj = null, { additive = false } = {}) {
    if (!entry) return false;
    const target = selectionTargetForPlaceable(entry, rootObj);
    const previousSelection = [...this.selectedPlaceableIds];
    if (!additive) {
      this.selectedPlaceableIds.clear();
      this._selectedRootsById.clear();
      this._selectionCandidatesByKey?.clear?.();
    } else if (this.selectedPlaceableIds.has(entry.id)) {
      this.selectedPlaceableIds.delete(entry.id);
      this._selectedRootsById.delete(entry.id);
      const remaining = [...this.selectedPlaceableIds];
      this.selectedPlaceableId = remaining[remaining.length - 1] || null;
      const primary = this.selectedPlaceableId && this.game.getPlaceable(this.selectedPlaceableId);
      this.selectedNodeId = primary?.category === 'beamline' ? primary.id : null;
      this._renderSelectionOutlines();
      this._reconcileSelectionWindow(previousSelection);
      return true;
    }

    this.selectedPlaceableIds.add(entry.id);
    if (target) this._selectionCandidatesByKey?.set?.(entry.id, target);
    if (rootObj) this._selectedRootsById.set(entry.id, rootObj);
    this.selectedPlaceableId = entry.id;
    this.selectedNodeId = entry.category === 'beamline' ? entry.id : null;
    this._renderSelectionOutlines();

    if (additive) {
      this._reconcileSelectionWindow(previousSelection);
    } else {
      this._openPlaceableInfoWindow(entry);
      this.renderer.refreshContextWindows?.();
    }
    return true;
  }

  _selectLogicalTarget(target, rootObj = null, { additive = false } = {}) {
    if (!target?.key) return false;
    if (target.targetKind === 'placeable') {
      return this._selectPlaceable(target.entry, rootObj, { additive });
    }
    const previousSelection = [...this.selectedPlaceableIds];
    if (!additive) {
      this.selectedPlaceableIds.clear();
      this._selectedRootsById.clear();
      this._selectionCandidatesByKey?.clear?.();
    } else if (this.selectedPlaceableIds.has(target.key)) {
      this.selectedPlaceableIds.delete(target.key);
      this._selectedRootsById.delete(target.key);
      const remaining = [...this.selectedPlaceableIds];
      this.selectedPlaceableId = remaining.at(-1) || null;
      this._renderSelectionOutlines();
      this._reconcileSelectionWindow(previousSelection);
      return true;
    }
    const candidate = { ...target, rootObj: rootObj || target.rootObj || null };
    this._selectionCandidatesByKey?.set?.(target.key, candidate);
    this.selectedPlaceableIds.add(target.key);
    if (candidate.rootObj) this._selectedRootsById.set(target.key, candidate.rootObj);
    this.selectedPlaceableId = target.key;
    this.selectedNodeId = target.selectionCategory === 'beamline'
      && target.targetKind === 'placeable' ? target.id : null;
    this._renderSelectionOutlines();
    this._reconcileSelectionWindow(previousSelection);
    return true;
  }

  /** Resolve the visible placeable under a normal canvas click. */
  _selectPlaceableAt(
    _world, grid, screenX, screenY,
    { additive = false, refillReservoir = true } = {},
  ) {
    const hit = this.renderer.raycastScreen?.(screenX, screenY, OBJECT_PICK_TOLERANCE_PX);
    const info = hit ? this.renderer.identifyHit?.(hit) : null;
    // Rendered placeable wrappers carry their stable state id. Deliberately do
    // not infer an owner from root position or ground occupancy here: those
    // substitutions are not perspective-aware and can select a nearby object
    // whose mesh the cursor never touched.
    const entry = info?.nodeId != null
      ? this.game.getPlaceable(info.nodeId)
      : null;
    if (entry) {
      const target = selectionTargetForPlaceable(entry, info.rootObj || null);
      if (!mouseSelectionCategoryEnabled(
        this._mouseSelectionCategories, target?.selectionCategory,
      )) return true;
      // A normal click on physical storage is also the emergency dry-loop
      // action: if its solved network is at exactly zero, buy a full refill
      // before opening the equipment window. Shift-click remains selection-
      // only so adding a tank to a group can never spend money unexpectedly.
      if (!additive && refillReservoir) this.game.refillEmptyReservoirForPlaceable?.(entry.id);
      return this._selectPlaceable(entry, info.rootObj || null, { additive });
    }

    if (info?.group === 'attachment' && info.attachmentId) {
      const target = selectionTargetByKey(
        this.game.state, `attachment:${info.attachmentId}`,
      );
      if (target && !mouseSelectionCategoryEnabled(
        this._mouseSelectionCategories, target.selectionCategory,
      )) return true;
      if (target) return this._selectLogicalTarget(target, info.rootObj || null, { additive });
    }
    if (info?.group === 'wall') {
      const edge = this._getNearestWallEdge(screenX, screenY);
      const key = physicalEdgeSelectionKey(
        edge.col, edge.row, edge.edge, this.game.activeLevel,
      );
      const target = selectionTargetByKey(this.game.state, key);
      if (target && !mouseSelectionCategoryEnabled(
        this._mouseSelectionCategories, target.selectionCategory,
      )) return true;
      if (target) return this._selectLogicalTarget(target, null, { additive });
    }

    // A rendered non-selectable object (for example a utility line or beam
    // pipe) keeps its existing inspector/click behavior. Only a true terrain
    // hit may fall through to the logical floor beneath the cursor.
    if (info) return false;

    const floorKey = floorSelectionKey(grid.col, grid.row, this.game.activeLevel);
    const floor = selectionTargetByKey(this.game.state, floorKey);
    if (floor && !mouseSelectionCategoryEnabled(
      this._mouseSelectionCategories, floor.selectionCategory,
    )) return true;
    return floor ? this._selectLogicalTarget(floor, null, { additive }) : false;
  }

  _getActiveBeamlineNodes() {
    // Return all beamline placeables, optionally filtered by editingBeamlineId
    const blId = this.game.editingBeamlineId;
    return this.game.state.placeables.filter(p => {
      const def = COMPONENTS[p.type];
      if (!def || def.category !== 'beamline') return false;
      if (blId && p.beamlineId !== blId) return false;
      return true;
    });
  }

  _getNearestEdge(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const gf = isoToGridFloat(world.x, world.y);
    const col = Math.floor(gf.col);
    const row = Math.floor(gf.row);
    const fx = gf.col - col;
    const fy = gf.row - row;

    // Distance to each edge of THIS tile (no canonicalization)
    const dN = fy;        // north (NE edge)
    const dS = 1 - fy;    // south (SW edge)
    const dE = 1 - fx;    // east (SE edge)
    const dW = fx;         // west (NW edge)

    const min = Math.min(dN, dS, dE, dW);
    if (min === dN) return { col, row, edge: 'n' };
    if (min === dS) return { col, row, edge: 's' };
    if (min === dE) return { col, row, edge: 'e' };
    return { col, row, edge: 'w' };
  }

  /** Resolve an opening at either spelling of a physical edge. */
  _findOpeningAtEdge(edge, kind) {
    const occupied = kind === 'door'
      ? this.game.state.doorOccupied
      : this.game.state.windowOccupied;
    for (const e of [edge, this._edgeAlias(edge)]) {
      const type = occupied?.[edgeKey(e.col, e.row, e.edge, this.game.activeLevel)];
      if (!type) continue;
      return {
        edge: e,
        overlayType: null,
        wallType: null,
        doorType: kind === 'door' ? type : null,
        windowType: kind === 'window' ? type : null,
      };
    }
    return null;
  }

  /**
   * Resolve the building edge visibly under the cursor. Door and window
   * geometry wins through a dedicated 3D pick path; the ground-edge lookup is
   * retained as the fallback for ordinary wall faces.
   */
  findDemolishableEdgeAtScreen(screenX, screenY) {
    const openingHit = this.renderer.raycastOpeningScreen?.(
      screenX, screenY, OBJECT_PICK_TOLERANCE_PX,
    ) || this.renderer.raycastDoorScreen?.(
      screenX, screenY, OBJECT_PICK_TOLERANCE_PX,
    );
    const doorEdge = openingHit?.object?.userData?.doorEdge;
    if (doorEdge) {
      const found = this._findOpeningAtEdge(doorEdge, 'door');
      if (found) return found;
    }
    const windowEdge = openingHit?.object?.userData?.windowEdge;
    if (windowEdge) {
      const found = this._findOpeningAtEdge(windowEdge, 'window');
      if (found) return found;
    }
    return this._findWallOrDoorAtEdge(this._getNearestEdge(screenX, screenY));
  }

  /**
   * The same physical tile edge has two key representations (e.g. the 's'
   * edge of (c,r) is the 'n' edge of (c,r+1)). Walls/doors are stored under
   * whichever representation the cursor produced at placement time, so
   * demolish lookups must check both.
   */
  _edgeAlias(pt) {
    return mirrorEdge(pt.col, pt.row, pt.edge, this?.game?.activeLevel ?? 0);
  }

  /**
   * Resolve a wall layer/wall/door/window segment at an edge, checking both
   * representations. Surface layers win so one demolish click peels copper
   * without also destroying its host wall.
   * normalized to the representation the segment is actually stored under,
   * or null when no alias holds a wall, a door, or a window.
   */
  _findWallOrDoorAtEdge(edge) {
    for (const e of [edge, this._edgeAlias(edge)]) {
      const k = edgeKey(e.col, e.row, e.edge, this.game.activeLevel);
      const overlayType = this.game.state.wallOverlayOccupied?.[k] || null;
      if (overlayType) return { edge: e, overlayType, wallType: null, doorType: null, windowType: null };
    }
    for (const e of [edge, this._edgeAlias(edge)]) {
      const k = edgeKey(e.col, e.row, e.edge, this.game.activeLevel);
      const wallType = this.game.state.wallOccupied?.[k] || null;
      const doorType = this.game.state.doorOccupied?.[k] || null;
      const windowType = this.game.state.windowOccupied?.[k] || null;
      if (wallType || doorType || windowType) return { edge: e, overlayType: null, wallType, doorType, windowType };
    }
    return null;
  }

  /**
   * The variant of the wall / door / window actually placed at this edge
   * triple, for pricing a demolish preview. Entries only carry `variant`
   * when it is non-zero (see Game.placeWall), so a missing field means 0.
   * `edge` is expected to be the representation _findWallOrDoorAtEdge
   * normalized to — the one the segment is stored under.
   * @param {'wall'|'door'|'window'} kind
   */
  _placedEdgeVariant(kind, edge) {
    const s = this.game.state;
    const list = kind === 'overlay' ? s.wallOverlays : kind === 'wall' ? s.walls : kind === 'door' ? s.doors : s.windows;
    const found = kind === 'door'
      ? (list || []).find(x => doorRecordCoversEdge(
        x, DOOR_TYPES[x.type], edge.col, edge.row, edge.edge,
      ) && sameLevel(x, this.game.activeLevel))
      : (list || []).find(
        x => sameLevel(x, this.game.activeLevel)
          && x.col === edge.col && x.row === edge.row && x.edge === edge.edge
      );
    return found?.variant ?? 0;
  }

  /**
   * Remove wall + door + window segments at an edge under either
   * representation. Windows are checked at both aliases explicitly (not
   * just left to removeWall's cascade) because Game.placeWindow accepts a
   * wall found under either edge representation, so a window's own storage
   * key can differ from the wall's.
   */
  _removeWallAndDoorAtEdge(pt) {
    // Every game mutator is alias-aware. Calling each side used to be a
    // harmless compatibility belt-and-suspenders, but layered walls turn it
    // into two destructive actions (peel copper, then delete its host).
    this.game.removeWall(pt.col, pt.row, pt.edge, this.game.activeLevel);
    this.game.removeDoor(pt.col, pt.row, pt.edge, this.game.activeLevel);
    this.game.removeWindow(pt.col, pt.row, pt.edge, this.game.activeLevel);
  }

  /** Return the full exposed perimeter of the contiguous floor region. */
  _buildFloorBoundaryRegion(origin) {
    return buildFloorRegionPerimeter(this.game.state.infraOccupied, origin);
  }

  /**
   * Choose between a mixed-floor interface run and a whole-region perimeter,
   * based on how close the cursor is to the shared edge.
   */
  _buildSmartFloorWallPath(origin) {
    return buildSmartFloorWallPath(this.game.state.infraOccupied, origin);
  }

  // Compatibility wrapper for demolish/tools that only need the old array.
  _buildFloorBoundaryPath(origin) {
    return this._buildFloorBoundaryRegion(origin).path;
  }

  /**
   * Build a straight line of wall edges from start to the cursor edge.
   * Walls lock to the start edge type and extend along the appropriate axis:
   *   'e'/'w' edges: same col, vary row (wall runs SE ↔ NW)
   *   'n'/'s' edges: same row, vary col (wall runs NE ↔ SW)
   */
  _buildWallLine(start, end) {
    const path = [];
    if (start.edge === 'e' || start.edge === 'w') {
      const col = start.col;
      const minR = Math.min(start.row, end.row);
      const maxR = Math.max(start.row, end.row);
      for (let r = minR; r <= maxR; r++) {
        path.push({ col, row: r, edge: start.edge });
      }
    } else {
      const row = start.row;
      const minC = Math.min(start.col, end.col);
      const maxC = Math.max(start.col, end.col);
      for (let c = minC; c <= maxC; c++) {
        path.push({ col: c, row, edge: start.edge });
      }
    }
    return path;
  }

  /**
   * Extend from an origin edge in both directions along the edge's axis,
   * collecting every consecutive edge that has a wall (of any type). Used
   * for shift+click demolish so the whole connected run deletes at once.
   * Returns [] if the origin edge itself has no wall.
   */
  _buildWallSegmentPath(origin) {
    return this._buildEdgeSegmentPath(this.game.state.wallOccupied, origin);
  }

  _buildWallOverlaySegmentPath(origin) {
    return this._buildEdgeSegmentPath(this.game.state.wallOverlayOccupied || {}, origin);
  }

  /**
   * Mirror of _buildWallSegmentPath for door segments (doorOccupied).
   */
  _buildDoorSegmentPath(origin) {
    return this._buildEdgeSegmentPath(this.game.state.doorOccupied, origin);
  }

  /**
   * Walk an occupancy map along the origin edge's axis, collecting every
   * consecutive occupied edge. Each step resolves BOTH spellings of the edge
   * (findEdgeKey) — a run drawn in two drags from opposite sides of the same
   * line is stored under mixed spellings, and a direct-key-only walk used to
   * stop dead at the changeover. Returns [] if the origin edge is empty.
   */
  _buildEdgeSegmentPath(occupied, origin) {
    const { edge } = origin;
    const occupiedAt = (col, row) => !!findEdgeKey(occupied, col, row, edge);
    if (!occupiedAt(origin.col, origin.row)) return [];
    const horizontal = edge === 'n' || edge === 's';
    const path = [{ col: origin.col, row: origin.row, edge }];
    for (const dir of [-1, 1]) {
      let col = origin.col;
      let row = origin.row;
      for (;;) {
        if (horizontal) col += dir; else row += dir;
        if (!occupiedAt(col, row)) break;
        const pt = { col, row, edge };
        if (dir === -1) path.unshift(pt); else path.push(pt);
      }
    }
    return path;
  }

  /**
   * Mirror of _buildDoorSegmentPath for window segments (windowOccupied).
   */
  _buildWindowSegmentPath(origin) {
    const win = this.game.state.windowOccupied;
    const { edge } = origin;
    const keyAt = (col, row) => `${col},${row},${edge}`;
    if (!win[keyAt(origin.col, origin.row)]) return [];
    const horizontal = edge === 'n' || edge === 's';
    const path = [{ col: origin.col, row: origin.row, edge }];
    for (const dir of [-1, 1]) {
      let col = origin.col;
      let row = origin.row;
      for (;;) {
        if (horizontal) col += dir; else row += dir;
        if (!win[keyAt(col, row)]) break;
        const pt = { col, row, edge };
        if (dir === -1) path.unshift(pt); else path.push(pt);
      }
    }
    return path;
  }

  /**
   * Find a beamline placeable occupying the given tile.
   */
  _findBeamlineComponentAt(col, row) {
    // Check placeables
    const placeables = this.game.state.placeables;
    for (const p of placeables) {
      if (p.category !== 'beamline') continue;
      if (p.cells && p.cells.some(c => c.col === col && c.row === row)) {
        return p;
      }
      if (p.col === col && p.row === row) return p;
    }
    return null;
  }

  /**
   * Find a beamline component at a half-tile endpoint by checking the
   * floor/ceil candidates of the coordinate (up to 4 adjacent tiles).
   * Returns `{ comp, cell }` where `cell.col/row` is the component's
   * *actual visual centre* expressed in pipe.col/row coordinates (i.e.
   * the inverse of the `col*2+1` renderer formula). This ensures pipe
   * paths terminate at the module's true centre rather than the tile
   * centre, which matters for subgrid-placed modules whose footprint is
   * smaller than a full tile.
   */
  _findBeamlineComponentNearEndpoint(col, row) {
    // Search nearby tiles (up to 2-tile radius) for a beamline module.
    // The wider search ensures pipe endpoints connect to modules even when
    // the user starts/ends drawing slightly off the module's exact tile.
    const centerCol = Math.round(col);
    const centerRow = Math.round(row);
    let bestComp = null;
    let bestDist = Infinity;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const comp = this._findBeamlineComponentAt(centerCol + dc, centerRow + dr);
        if (!comp) continue;
        const dist = Math.abs(dc) + Math.abs(dr);
        if (dist < bestDist) {
          bestDist = dist;
          bestComp = comp;
        }
      }
    }
    if (!bestComp) return null;
    const def = COMPONENTS[bestComp.type];
    const gwSub = def?.gridW || def?.subW || 4;
    const ghSub = def?.gridH || def?.subL || def?.subH || 4;
    const sc = bestComp.subCol || 0;
    const sr = bestComp.subRow || 0;
    // World-centre of the module (same formula ComponentBuilder.build
    // uses for subgrid-placed components):
    //   x = col*2 + (subCol + gwSub/2) * 0.5
    // Converted to pipe.col coordinates via `pipe_col = (world_x - 1) / 2`.
    const worldX = bestComp.col * 2 + (sc + gwSub / 2) * 0.5;
    const worldZ = bestComp.row * 2 + (sr + ghSub / 2) * 0.5;
    const pipeCol = (worldX - 1) / 2;
    const pipeRow = (worldZ - 1) / 2;
    return { comp: bestComp, cell: { col: pipeCol, row: pipeRow } };
  }

  /**
   * Find the nearest beamline component within a search radius.
   */
  _findNearestBeamlineComponent(col, row, radius = 3) {
    let best = null;
    let bestDist = Infinity;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const comp = this._findBeamlineComponentAt(col + dc, row + dr);
        if (comp) {
          const dist = Math.abs(dc) + Math.abs(dr);
          if (dist < bestDist) {
            bestDist = dist;
            best = comp;
          }
        }
      }
    }
    return best;
  }

  /**
   * Check if a beam pipe approaching from (approachDc, approachDr) is aligned
   * with a component's beam axis. Returns true if the pipe arrives along the
   * component's axis (either end), false if perpendicular.
   */
  _isPipeAlignedWithComponent(comp, approachDc, approachDr) {
    const dir = comp.dir;
    if (dir === undefined || dir === null) return true; // no direction info, allow
    const axis = DIR_DELTA[dir]; // e.g. NE={dc:0,dr:-1}
    // Pipe is aligned if its approach vector is parallel to the component axis
    // (same or opposite direction). Check via cross product = 0.
    return (approachDc * axis.dr - approachDr * axis.dc) === 0;
  }

  /**
   * Build an L-shaped path from one point to another in 0.25-tile (single
   * sub-tile) steps so pipes snap to the sub-tile grid.
   */
  // Build an L-shaped tile path from `from` to `to` on integer tile
  // coordinates. Goes along the dominant axis first, then bends once to
  // reach the target — giving a clean straight line when the drag is axis-
  // aligned, and a single-bend L otherwise. Used for hallway placement.
  _buildLPath(from, to) {
    const fc = Math.round(from.col), fr = Math.round(from.row);
    const tc = Math.round(to.col),   tr = Math.round(to.row);
    const dCol = tc - fc;
    const dRow = tr - fr;
    const horizontalFirst = Math.abs(dCol) >= Math.abs(dRow);
    const path = [{ col: fc, row: fr }];
    let c = fc, r = fr;
    if (horizontalFirst) {
      const sc = Math.sign(dCol);
      while (c !== tc) { c += sc; path.push({ col: c, row: r }); }
      const sr = Math.sign(dRow);
      while (r !== tr) { r += sr; path.push({ col: c, row: r }); }
    } else {
      const sr = Math.sign(dRow);
      while (r !== tr) { r += sr; path.push({ col: c, row: r }); }
      const sc = Math.sign(dCol);
      while (c !== tc) { c += sc; path.push({ col: c, row: r }); }
    }
    return path;
  }

  /**
   * Find an available (unconnected) port on a module.
   * @param {string} placeableId
   * @param {'entry'|'exit'} direction - 'exit' for source-side ports, 'entry' for dest-side ports
   * @returns {string|null} port name or null if all matching ports are taken
   */
  _findAvailablePort(placeableId, direction) {
    const placeable = this.game.getPlaceable(placeableId);
    if (!placeable) return null;
    const def = COMPONENTS[placeable.type];
    if (!def || !def.ports) return null;

    const connectedPorts = new Set();
    for (const pipe of this.game.state.beamPipes) {
      if (pipe.start?.junctionId === placeableId) connectedPorts.add(pipe.start.portName);
      if (pipe.end?.junctionId   === placeableId) connectedPorts.add(pipe.end.portName);
    }

    for (const [portName, portDef] of Object.entries(def.ports)) {
      if (connectedPorts.has(portName)) continue;
      if (direction === 'exit') {
        // Exit ports: name starts with 'exit', or side is 'front' / 'left' / 'right'
        if (portName.startsWith('exit') || portDef.side === 'front' || portDef.side === 'left' || portDef.side === 'right') return portName;
      } else {
        // Entry ports: name is 'entry', or side is 'back'
        if (portName === 'entry' || portDef.side === 'back') return portName;
      }
    }
    return null;
  }

  /**
   * Find the beam pipe closest to the given grid position.
   * Returns null if no pipe is within 1 tile of the position.
   */
  _findNearestPipe(col, row) {
    let bestPipe = null;
    let bestDist = Infinity;

    for (const pipe of this.game.state.beamPipes) {
      for (const pt of pipe.path) {
        const dist = Math.abs(pt.col - col) + Math.abs(pt.row - row);
        if (dist < bestDist) {
          bestDist = dist;
          bestPipe = pipe;
        }
      }
    }

    return bestDist <= 1 ? bestPipe : null;
  }

  // Delegates to pipe-geometry.projectOntoPipe — kept as an instance method
  // only for call-site compatibility. New callers should import the module
  // function directly.
  _projectOntoPipe(pipe, worldX, worldZ) {
    return projectOntoPipe(pipe, worldX, worldZ);
  }

  /**
   * Given an armed attachment component key and a cursor world position
   * (iso-pixel — i.e. the output of `screenToWorld`), snap the attachment
   * footprint to the subgrid using the unified placement system, then
   * project the snap center onto the nearest pipe. Returns
   * `{ snap, pipe, proj }` or null if no pipe is within reach.
   */
  _snapAttachmentToPipe(compKey, worldX, worldY) {
    const compDef = COMPONENTS[compKey];
    if (!compDef) return null;
    const snap = snapForPlaceable(worldX, worldY, compDef, this.placementDir || 0);
    const swap = (this.placementDir || 0) === 1 || (this.placementDir || 0) === 3;
    const subW = swap ? (compDef.subL || 2) : (compDef.subW || 2);
    const subH = swap ? (compDef.subW || 2) : (compDef.subL || 2);
    // Footprint center in 3D world coordinates (matches placeable formula)
    const wx = snap.col * 2 + (snap.subCol + subW / 2) * 0.5;
    const wz = snap.row * 2 + (snap.subRow + subH / 2) * 0.5;
    // Find nearest pipe. _findNearestPipe uses integer tile col/row as a
    // rough Manhattan filter, so pass the tile containing the footprint
    // center.
    const intCol = Math.floor(wx / 2);
    const intRow = Math.floor(wz / 2);
    const pipe = this._findNearestPipe(intCol, intRow);
    if (!pipe) return null;
    const proj = this._projectOntoPipe(pipe, wx, wz);
    if (!proj) return null;
    // Compute the subtile cells the attachment will actually occupy at its
    // projected on-pipe position, then test against subgridOccupied so
    // attachments can't sit on top of placed modules / equipment.
    const cells = this._attachmentCellsAtProj(proj, compDef);
    let collidesWithModule = false;
    const occ = this.game.state.subgridOccupied || {};
    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      if (occ[k]) {
        collidesWithModule = true;
        break;
      }
    }
    return { snap, pipe, proj, cells, collidesWithModule };
  }

  /** Snap a compatible instrument to the nearest point on its utility run. */
  _snapAttachmentToUtilityLine(compKey, worldX, worldY) {
    const def = COMPONENTS[compKey];
    if (!def?.utilityMount) return null;
    const gf = isoToGridFloat(worldX, worldY);
    const lines = this.game.state.utilityLines;
    const iter = lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
    let best = null;
    for (const line of iter) {
      if (!line || line.utilityType !== def.utilityMount) continue;
      const proj = projectOntoUtilityLine(line, gf.col, gf.row);
      if (!proj || proj.distance > 0.45) continue;
      if (!best || proj.distance < best.proj.distance) best = { line, proj };
    }
    if (!best) return null;
    best.collidesWithAttachment = (best.line.attachments || []).some(att => {
      const pose = utilityAttachmentPose(best.line, att);
      return pose && Math.hypot(
        pose.worldX - best.proj.worldX,
        pose.worldZ - best.proj.worldZ,
      ) < 0.5;
    });
    return { kind: 'utilityLine', ...best };
  }

  /** Prefer a declared utility mount, while preserving beam-pipe mounting. */
  _resolveAttachmentTarget(compKey, worldX, worldY) {
    const lineHit = this._snapAttachmentToUtilityLine(compKey, worldX, worldY);
    if (lineHit) return lineHit;
    const pipeHit = this._snapAttachmentToPipe(compKey, worldX, worldY);
    return pipeHit ? { kind: 'beamPipe', ...pipeHit } : null;
  }

  /**
   * Compute the subtile cells an attachment occupies when placed at a
   * projected on-pipe position. Mirrors the renderer's centering rule
   * (`col*2+1` world center) and rotates the footprint by `proj.dir`.
   */
  _attachmentCellsAtProj(proj, compDef) {
    const dir = proj.dir || 0;
    const swap = dir === 1 || dir === 3;
    // After accounting for orientation: footW is the col-axis extent in
    // subtiles, footH is the row-axis extent. subL is along the beam.
    const footW = swap ? (compDef.subL || 1) : (compDef.subW || 1);
    const footH = swap ? (compDef.subW || 1) : (compDef.subL || 1);
    // Absolute subtile center: world is (proj.col*2+1, proj.row*2+1) and
    // 1 subtile = 0.5 world units.
    const absCenterC = proj.col * 4 + 2;
    const absCenterR = proj.row * 4 + 2;
    const absOriginC = Math.round(absCenterC - footW / 2);
    const absOriginR = Math.round(absCenterR - footH / 2);
    const cells = [];
    for (let dr = 0; dr < footH; dr++) {
      for (let dc = 0; dc < footW; dc++) {
        const sc = absOriginC + dc;
        const sr = absOriginR + dr;
        cells.push({
          col: Math.floor(sc / 4),
          row: Math.floor(sr / 4),
          subCol: ((sc % 4) + 4) % 4,
          subRow: ((sr % 4) + 4) % 4,
        });
      }
    }
    return cells;
  }

  /**
   * Update the transparent hover ghost for an armed attachment tool. Uses
   * the unified subgrid snap for the footprint and the pipe projection for
   * pipe-alignment.
   */
  _updateAttachmentPreview(compKey, worldX, worldY) {
    const hit = this._resolveAttachmentTarget(compKey, worldX, worldY);
    if (!hit) {
      // No pipe under the cursor: drop the ghost mesh but keep the placement
      // grid every other placement tool shows (a full _clearPreview stripped
      // it, so gauges/valves flickered the grid away between pipes).
      const gf = isoToGridFloat(worldX, worldY);
      if (typeof this.renderer.renderPlacementGridOnly === 'function') {
        // 'needs-pipe' tints the cursor tile so the player sees the
        // requirement before the click logs it.
        this.renderer.renderPlacementGridOnly(Math.floor(gf.col), Math.floor(gf.row), 'needs-pipe');
      } else {
        this.renderer._clearPreview?.();
      }
      return;
    }
    // Game.addAttachmentToPipe charges the component's cost (plus spares,
    // fix round 1 — routes through BeamlineSystem.placeOnPipe), so an
    // unaffordable attachment must not preview green. Fix round 3:
    // componentCostFor(def), not the bare def.cost, or a spares-short
    // on-pipe part still previewed green here and then refused on click.
    const affordable = canAffordCost(this.game, componentCostFor(COMPONENTS[compKey]));
    const blocked = hit.kind === 'utilityLine'
      ? hit.collidesWithAttachment
      : hit.collidesWithModule;
    const valid = !blocked && affordable;
    const mount = hit.kind === 'utilityLine' ? {
      worldX: hit.proj.worldX,
      worldZ: hit.proj.worldZ,
      yOffset: utilityLineHeight(
        hit.line.utilityType, hit.line.routeHeightMeters) - 1.0,
    } : null;
    this.renderer.renderAttachmentGhost(
      hit.proj.col, hit.proj.row,
      compKey,
      hit.proj.dir,
      valid,
      (!blocked && !affordable) ? PLACE_UNAFFORDABLE : null,
      false,
      mount,
    );
  }

  /**
   * Return the nearest edge of the cursor's tile, preferring edges that sit
   * on a flooring boundary (the material differs across the edge, including
   * floor-to-empty boundaries).
   */
  _getNearestFloorEdge(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const gf = isoToGridFloat(world.x, world.y);
    const col = Math.floor(gf.col);
    const row = Math.floor(gf.row);
    const fx = gf.col - col;
    const fy = gf.row - row;

    // All 4 edges of this tile with distances (no canonicalization)
    const candidates = [
      { col, row, edge: 'n', dist: fy },
      { col, row, edge: 's', dist: 1 - fy },
      { col, row, edge: 'e', dist: 1 - fx },
      { col, row, edge: 'w', dist: fx },
    ];

    const occ = this.game.state.infraOccupied;

    // Neighbor tile across each edge
    const neighbor = (e) => {
      if (e.edge === 'n') return `${e.col},${e.row - 1}`;
      if (e.edge === 's') return `${e.col},${e.row + 1}`;
      if (e.edge === 'e') return `${e.col + 1},${e.row}`;
      return `${e.col - 1},${e.row}`;
    };

    const isFloorBoundary = (e) => {
      const a = occ[`${e.col},${e.row}`] || null;
      const b = occ[neighbor(e)] || null;
      return (a || b) && a !== b;
    };

    candidates.sort((a, b) => {
      const aScore = a.dist - (isFloorBoundary(a) ? 0.15 : 0);
      const bScore = b.dist - (isFloorBoundary(b) ? 0.15 : 0);
      return aScore - bScore;
    });

    return candidates[0];
  }

  /**
   * Return the nearest edge that has a wall on it. Falls back to the
   * nearest floor-boundary edge if no walls are within reach.
   *
   * The returned edge also carries `frac`: where along that edge the cursor
   * sits, 0 at the edge's FIRST-listed corner and 1 at the second, in
   * buildWalls' corner order (n: NW->NE, e: NE->SE, s: SE->SW, w: SW->NW).
   * Quantizing that into a door's subtile offset needs the door's width, so
   * it's left to the caller — DoorTool runs it through doorOffFromFrac().
   */
  _getNearestWallEdge(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const gf = isoToGridFloat(world.x, world.y);
    const col = Math.floor(gf.col);
    const row = Math.floor(gf.row);
    const fx = gf.col - col;
    const fy = gf.row - row;

    const candidates = [
      { col, row, edge: 'n', dist: fy, frac: fx },
      { col, row, edge: 's', dist: 1 - fy, frac: 1 - fx },
      { col, row, edge: 'e', dist: 1 - fx, frac: fy },
      { col, row, edge: 'w', dist: fx, frac: 1 - fy },
    ];

    // A wall lives under either spelling of its edge, so the preference bias
    // has to resolve both — checking only the hovered tile's key made the
    // bias miss on every wall drawn from the neighbouring tile, which is what
    // made doors feel like they refused to land on walls.
    const wo = this.game.state.wallOccupied;
    const hasWall = (e) => !!findWallKey(wo, e.col, e.row, e.edge);

    // A wall-mounted tool should feel magnetic to an existing wall rather
    // than merely *biased* toward one. If this tile touches a wall, choose
    // the nearest such edge; only fall back to an empty edge to show the
    // useful red "requires a wall" preview.
    const wallCandidates = candidates.filter(hasWall);
    const pool = wallCandidates.length ? wallCandidates : candidates;
    pool.sort((a, b) => a.dist - b.dist);
    return pool[0];
  }

  // --- Keyboard bindings ---

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this._shiftDown = e.shiftKey;
      if (e.key === 'Shift') {
        // Tools with shift-modified previews (wall boundary fill, demolish
        // whole-run) refresh even with a stationary cursor.
        this.activeTool?.onShiftChange?.(true, this._toolCtx);
      }
      // Cmd is the Mac spelling of Ctrl throughout this handler (undo,
      // selection slots), so the erase modifier reads both. Tracked before
      // the shortcut ladder below so a tool that repaints on the change sees
      // the same state the ladder does.
      this._ctrlDown = e.ctrlKey || e.metaKey;
      if (e.key === 'Control' || e.key === 'Meta') {
        this.activeTool?.onCtrlChange?.(true, this._toolCtx);
      }
      // Escape never routes through here — the esc-stack (ui/esc-stack.js)
      // owns it; our default ladder is this handler's fallback entry
      // (_handleEscape). While the beamline designer is open it swallows
      // every other key at capture phase, so no designer guard is needed.
      if (e.key === 'Escape') {
        // Esc may be claimed by a context window above our fallback handler,
        // but it still ends the one-shot connection-guide visit.
        this.renderer.ui?._dismissConnectionGuide?.();
        return;
      }
      // Skip if focused on text input
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Ctrl/Cmd+Z → undo, Ctrl/Cmd+Shift+Z → redo. The active tool gets to
      // abandon any mid-gesture carry first: undo replaces game state
      // wholesale, so a tool still holding a lifted object would duplicate
      // it on the next drop.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        this.activeTool?.cancelGesture?.(this._toolCtx, 'stateReplaced');
        if (e.shiftKey) this.game.redo();
        else this.game.undo();
        return;
      }

      // Formation clipboard and numbered blueprints. `event.code` keeps
      // Shift+1 readable as slot 1 even though `event.key` is "!".
      const digitMatch = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
      const selectionSlot = digitMatch
        ? digitMatch[1]
        : (/^[1-9]$/.test(e.key) ? e.key : null);
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && selectionSlot) {
        e.preventDefault();
        if (!e.repeat) this._saveSelectionSlot(selectionSlot);
        return;
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && selectionSlot) {
        e.preventDefault();
        if (!e.repeat) this._recallSelectionSlot(selectionSlot);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
          && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        if (!e.repeat) this._copySelectionToClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
          && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (!e.repeat) this._pasteSelectionClipboard();
        return;
      }

      // ` → toggle hotkey hint bar above the build UI
      if (e.key === '`') {
        e.preventDefault();
        document.getElementById('hotkey-hint')?.classList.toggle('hidden');
        return;
      }

      // Active tool gets first claim on keys (e.g. Shift+Z/X spacing while
      // line-placing decorations). Legacy branches below cover unconverted
      // families.
      if (this._toolConsumed('onKey', e)) return;

      // Handle DesignPlacer keys
      if (this.game._designPlacer && this.game._designPlacer.active) {
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          this.game._designPlacer.rotate();
          this.renderer._renderCursors();
          return;
        }
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          this.game._designPlacer.reflect();
          this.renderer._renderCursors();
          return;
        }
        return; // block other keys while placing (Esc cancel lives in _handleEscape)
      }

      // M mirrors selected beamline ports in place, or the utility-port
      // layout of an armed placeable. This runs before palette-slot hotkeys
      // because M is also slot 7: transform the active target instead of
      // silently selecting a different palette entry.
      const selectedMirrorHandled = typeof this._handleMirrorSelectedBeamlinePortsKey === 'function'
        ? this._handleMirrorSelectedBeamlinePortsKey(e)
        : InputHandler.prototype._handleMirrorSelectedBeamlinePortsKey.call(this, e);
      if (selectedMirrorHandled) return;
      const mirrorHandled = typeof this._handleMirrorPortsKey === 'function'
        ? this._handleMirrorPortsKey(e)
        : InputHandler.prototype._handleMirrorPortsKey.call(this, e);
      if (mirrorHandled) return;

      // Contextual selection shortcuts. With a selection they immediately
      // act on it; without one, Copy and Mirror become click-to-target modes.
      // D remains camera pan-right; Delete owns selection deletion and
      // Backspace owns the reversible selected-placeable explosion.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
          && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const ids = this._selectionIdsForAnchor(this.selectedPlaceableId);
        if (ids.length) this._beginSelectedCopy(this.selectedPlaceableId);
        else this._toggleSelectionActionMode('copy');
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
          && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        const ids = this._selectionIdsForAnchor(this.selectedPlaceableId);
        if (ids.length) this._beginSelectedMirror(this.selectedPlaceableId);
        else this._toggleSelectionActionMode('mirror');
        return;
      }
      // Arrow keys → palette navigation
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this._handlePaletteNav(e.key);
        return;
      }

      // Track pan keys for continuous movement (WASD only).
      // Normalize to lowercase so Shift toggling mid-press doesn't strand
      // an uppercase entry in the set.
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
        this.keysDown.add(k);
        this._startPanLoop?.();
        e.preventDefault();
        return;
      }

      // Mode hotkeys: 1..6 activate the top-row build menus.
      // Skip when modifiers are held so browser shortcuts pass through.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
          && e.key >= '1' && e.key <= '6') {
        const modeOrder = ['beamline', 'infra', 'facility', 'structure', 'grounds', 'demolish'];
        const mode = modeOrder[parseInt(e.key, 10) - 1];
        const btn = mode && document.querySelector(`.mode-btn[data-mode="${mode}"]`);
        if (btn) {
          e.preventDefault();
          btn.click();
        }
        return;
      }

      // Remaining palette hotkeys preserve their original slot positions;
      // C and M now belong to contextual Copy and Mirror everywhere.
      const paletteHotkeySlots = { z: 0, x: 1, v: 3, b: 4, n: 5 };
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
          && Object.hasOwn(paletteHotkeySlots, k)) {
        const slot = paletteHotkeySlots[k];
        const items = document.querySelectorAll('#component-palette .palette-item');
        if (items.length > slot) {
          e.preventDefault();
          this.paletteIndex = slot;
          this._applyPaletteFocus(items);
          return;
        }
        // Fall through: no item in that slot, let switch handle rebound keys.
      }

      switch (e.key) {
        case ' ':
          // (BeamlineTool consumes Space for junction/placement roles in
          // its onKey, delegating to the controller at the last cursor
          // position.)
          e.preventDefault();
          this.game._withUndo(() => {
            if (this.hoverPlaceable) {
              // Unified placement — handles beamline / equipment / furnishing / decoration.
              const placedId = this.game.placePlaceable({
                type: this.hoverPlaceable.id,
                col: this.hoverPlaceable.col,
                row: this.hoverPlaceable.row,
                subCol: this.hoverPlaceable.subCol,
                subRow: this.hoverPlaceable.subRow,
                dir: this.hoverPlaceable.dir,
                portsFlipped: this.hoverPlaceable.portsFlipped === true,
                wallMount: this.hoverPlaceable.wallMount,
                params: this.selectedParamOverrides,
                variant: this.selectedPlaceableVariant,
              });
              // Auto-switch to beam pipe tool after placing a source.
              const comp = COMPONENTS[this.hoverPlaceable.id];
              if (placedId && comp?.isSource) {
                const guided = this.game._guidedSetup?.onSourcePlaced?.(placedId);
                if (!guided) this.beginBeamPipeFromSource(placedId);
              }
            } else {
              this.game.toggleBeam();
            }
          });
          break;
        case 'r': case 'R': {
          // The active tool gets first refusal: a gesture with an orientation
          // of its own (the utility line's bend order) is what the player
          // means by "rotate" while they are mid-drag.
          if (this.activeTool?.onRotateKey?.(this._toolCtx)) return;
          // Placement-role tools (attachments on pipes) use R to toggle
          // placement mode rather than rotating — their direction is
          // determined by the pipe's axis, so rotation is a no-op.
          if (this._handlePlacementModeKey('replace')) return;
          // Unified rotation: R always advances placementDir when a placeable
          // is armed (including while MoveTool carries an item, since the
          // carried type arms the unified preview).
          if (this.armedPlaceableId) {
            this.placementDir = (this.placementDir + 1) % 4;
            this.renderer.updatePlacementDir?.(this.placementDir);
            this._updatePlaceablePreview();
            return;
          }
          const overlay = document.getElementById('research-overlay');
          if (overlay) overlay.classList.toggle('hidden');
          break;
        }
        case 'i': case 'I': {
          // Placement-role tools consume I as the insert-mode toggle; with
          // no such tool armed, I cycles the 3D label detail level.
          if (this._handlePlacementModeKey('insert')) return;
          const levelName = this.renderer.cycleLabelLevel();
          this._showToast(`Labels: ${levelName}`);
          break;
        }
        case 'g': case 'G': {
          this.game._guidedSetup?.toggle?.();
          break;
        }
        case 'k': case 'K': {
          // K, not E/F/B/M: every mnemonic for "economy" is already a mode,
          // palette slot or camera key. Toggles like the Research/Build Forward keys.
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          EconomyWindow.toggle(this.game);
          break;
        }
        case 'q': case 'Q': {
          e.preventDefault();
          if (!this.isFreeOrbiting && !this.renderer._snapping) {
            this.renderer.rotateView(-1);
          }
          break;
        }
        case 'e': case 'E': {
          e.preventDefault();
          if (!this.isFreeOrbiting && !this.renderer._snapping) {
            this.renderer.rotateView(+1);
          }
          break;
        }
        case 'Tab': {
          if (this.handlePanelAutoConnectKey(e)) break;
          e.preventDefault();
          const mode = MODES[this.activeMode];
          if (!mode || mode.disabled) break;
          const catKeys = Object.keys(mode.categories);
          const tabs = document.querySelectorAll('.cat-tab');
          const tabCats = Array.from(tabs).map(t => t.dataset.category);
          const curIdx = tabCats.indexOf(this.selectedCategory);
          const nextIdx = (curIdx + 1) % tabCats.length;
          this.selectedCategory = tabCats[nextIdx];
          tabs.forEach(t => t.classList.remove('active'));
          tabs[nextIdx].classList.add('active');
          this.renderer.updatePalette(this.selectedCategory, { freshTab: true });
          this.paletteIndex = -1;
          this._hidePreview();
          break;
        }
        case 'f': case 'F': {
          // (FloorTool consumes F for orientable floors in its onKey.) F is
          // the primary placement rotation key for every free-place object,
          // including beamline components. R remains a compatibility alias.
          e.preventDefault();
          this.placementDir = (this.placementDir + 1) % 4;
          this.renderer.updatePlacementDir(this.placementDir);
          // Re-render unified ghost so the preview rotates immediately.
          // (No legacy ghost for drawn connections: the beam-pipe tool draws
          // its own preview and never took a placementDir — the old
          // renderEquipmentGhost call here only painted a stray full-tile
          // module ghost over the hover tile.)
          this._updatePlaceablePreview();
          // Also toggle dipole bend direction
          this.dipoleBendDir = this.dipoleBendDir === 'right' ? 'left' : 'right';
          this.renderer.updateCursorBendDir(this.dipoleBendDir);
          break;
        }
        case 't': case 'T':
          // T is reserved for the contextual assisted-wiring disconnect.
          // The Beamline Designer is intentionally available only through
          // its explicit UI actions, so an ineligible selection cannot turn
          // the same key into an unrelated full-screen navigation command.
          this.handleDisconnectSelectedUtilitiesKey(e);
          break;
        case 'u': case 'U':
          // Toggle probe mode. setTool handles the exclusivity sweep.
          if (this.activeTool?.kind === 'probe') {
            this.clearTool();
          } else {
            this.setTool(new ProbeTool());
          }
          break;
        case 'o': case 'O': {
          if (e.ctrlKey || e.metaKey) break;
          const visible = this.renderer.toggleZoneOverlay();
          this._showToast(`Zones: ${visible ? 'On' : 'Off'}`);
          break;
        }
        case 'l': case 'L': {
          if (e.ctrlKey || e.metaKey) break;
          const visible = this.renderer.toggleZoneLabels?.();
          this._showToast(`Zone labels: ${visible ? 'On' : 'Off'}`);
          this.game.log(`Zone labels ${visible ? 'shown' : 'hidden'}`, 'info');
          break;
        }
        // P owns movement. With a selected placeable it immediately picks up
        // that item; otherwise it toggles the general click-to-pick-up mode.
        // Pause remains available from the top-bar button.
        case 'p': case 'P': {
          if (e.ctrlKey || e.metaKey || e.altKey) break; // keep Cmd/Ctrl+P (print)
          e.preventDefault();
          if (this._beginSelectedMove()) break;
          this._toggleMoveMode();
          break;
        }
        case '7': case '8': case '9': {
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          e.preventDefault();
          const mult = { '7': 1, '8': 2, '9': 4 }[e.key];
          this.game.setSpeed(mult);
          this._showToast(`Speed: ${mult}x`);
          break;
        }
        case 'Backspace':
          e.preventDefault();
          this._explodeSelectedFromKeyboard();
          break;
        case 'Delete':
          e.preventDefault();
          // Delete the current ordinary selection immediately. A selected
          // beamline is deliberately protected: removing one of its anchor
          // modules can tear down the connected machine, and whole-beamline
          // deletion is no longer offered as a context-window action.
          if (!this._deleteSelectedFromKeyboard()) {
            // With no selection, retain the context-aware demolish shortcut.
            this._toggleContextDemolish();
          }
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      this._shiftDown = e.shiftKey;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keysDown.delete(k);
      this.keysDown.delete(e.key);
      if (e.key === 'Shift') {
        // WallTool cancels a pending boundary fill; DemolishTool drops the
        // whole-run preview back to the single-edge highlight.
        this.activeTool?.onShiftChange?.(false, this._toolCtx);
      }
      this._ctrlDown = e.ctrlKey || e.metaKey;
      if (e.key === 'Control' || e.key === 'Meta') {
        // Structure tools drop the red erase preview back to their normal
        // placement ghost.
        this.activeTool?.onCtrlChange?.(false, this._toolCtx);
      }
    });

    // Clear all held keys when the window loses focus so pan doesn't stick
    // if the user alt-tabs, opens devtools, or a modal steals focus.
    const clearHeldKeys = () => {
      this.keysDown.clear();
      this._shiftDown = false;
      // Cmd-tab in particular swallows the Meta keyup, so a stale _ctrlDown
      // would leave every later click erasing.
      if (this._ctrlDown) {
        this._ctrlDown = false;
        this.activeTool?.onCtrlChange?.(false, this._toolCtx);
      }
      if (this._panFrameId !== null) {
        cancelAnimationFrame(this._panFrameId);
        this._panFrameId = null;
      }
    };
    window.addEventListener('blur', clearHeldKeys);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearHeldKeys();
        this._abortPointerGesture();
      }
    });
  }

  _startPanLoop() {
    if (this._panFrameId !== null) return;
    const PAN_SPEED_BASE = 0.5; // world-pan units per frame at zoom=1
    const loop = () => {
      this._panFrameId = null;
      const panning = this.keysDown.has('w') || this.keysDown.has('a')
        || this.keysDown.has('s') || this.keysDown.has('d');
      if (!panning) return;
      // Scale inversely with zoom so screen-space pan speed stays consistent
      // (at high zoom, world-space motion is slower).
      const shiftMul = this._shiftDown ? 2.5 : 1;
      const speed = (PAN_SPEED_BASE * shiftMul) / (this.renderer.zoom || 1);
      let dxRight = 0, dyUp = 0;
      if (this.keysDown.has('w') || this.keysDown.has('W')) dyUp += speed;
      if (this.keysDown.has('s') || this.keysDown.has('S')) dyUp -= speed;
      if (this.keysDown.has('d') || this.keysDown.has('D')) dxRight += speed;
      if (this.keysDown.has('a') || this.keysDown.has('A')) dxRight -= speed;
      if (dxRight !== 0 || dyUp !== 0) {
        this.renderer.panScreenAligned(dxRight, dyUp);
      }
      this._panFrameId = requestAnimationFrame(loop);
    };
    this._panFrameId = requestAnimationFrame(loop);
  }

  // --- Mouse bindings ---

  _bindMouse() {
    const canvas = this.renderer.app.canvas;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Multiplicative step: each tick changes zoom by a constant ratio so the
      // perceived zoom rate is the same at any zoom level.
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const delta = (this.renderer.zoom || 1) * (factor - 1);
      this.renderer.zoomAt(e.clientX, e.clientY, delta);
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      // Any world interaction ends the fresh-tab orientation moment. This is
      // before tool/camera dispatch so selections, placements, empty-ground
      // clicks, pans, and connector grabs all behave alike.
      this.renderer.ui?._dismissConnectionGuide?.();

      // Middle mouse: a click cycles the preferred elevations at the same
      // heading; movement
      // beyond the jitter threshold becomes the existing free-orbit drag.
      if (e.button === 1) {
        this.isFreeOrbiting = true;
        this.freeOrbitStart = { x: e.clientX, y: e.clientY };
        this.freeOrbitLast = { x: e.clientX, y: e.clientY };
        this.freeOrbitDragged = false;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // Alt + left drag: pan (unchanged).
      if (e.button === 0 && e.altKey) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.panStartPan = { x: this.renderer._panX, y: this.renderer._panY };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // The map-corner land arrows are direct world controls, not build tools.
      // Claim the whole press/release before an armed drag tool can turn the
      // click into a wall, pipe, or placement outside the current site.
      if (e.button === 0
          && this.renderer.isLandPurchaseMarkerAtScreen?.(e.clientX, e.clientY)) {
        this._landPurchasePress = true;
        canvas.style.cursor = 'pointer';
        e.preventDefault();
        return;
      }

      // Active tool gets first claim on the press (after camera controls,
      // which are built-in input handling, not tools).
      if (this._toolConsumed('onMouseDown', e)) return;

      // A source's output flange is itself the natural beam-pipe handle. With
      // no tool armed, grabbing that visible open end arms the drift tool and
      // begins the very same gesture the palette would. Beam ports win before
      // utility fittings because a source can carry both in a small footprint,
      // while the output flange is the only one sitting on the beam axis.
      if (e.button === 0 && !this.activeTool && !this.game._designPlacer?.active) {
        const r = this.renderer;
        const world = r.screenToWorldAtHeight
          ? r.screenToWorldAtHeight(e.clientX, e.clientY, BEAM_PIPE_Y)
          : r.screenToWorld(e.clientX, e.clientY);
        const port = this.beamlineController.findSourcePortAt(
          world.x, world.y, { x: e.clientX, y: e.clientY },
        );
        if (port) {
          this.setTool(new BeamlineTool('drift'));
          this._toolConsumed('onMouseDown', e);
          return;
        }
      }

      // With no build tool active, a direct press on a visible connector stays
      // ambiguous until the pointer actually drags. A plain release must reach
      // normal equipment selection even inside the generous port hit radius;
      // only dragging outward arms the matching utility tool.
      if (e.button === 0 && !this.activeTool) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const port = this.utilityLineController.findPortAt(
          world.x, world.y, { x: e.clientX, y: e.clientY },
        );
        if (port?.utilityType) {
          this._deferredUtilityPortDrag.begin(port, e);
          return;
        }
      }

      // With no tool armed, a left press starts as an ordinary click and
      // becomes a marquee only after the pointer clears a small threshold.
      // This preserves single-click selection while making empty-ground drag
      // select available without another mode toggle.
      if (e.button === 0 && !this.activeTool && !this.game._designPlacer?.active) {
        this._beginMarquee(e);
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isFreeOrbiting) {
        if (!this.freeOrbitDragged) {
          const current = { x: e.clientX, y: e.clientY };
          if (!isMiddleCameraDrag(this.freeOrbitStart, current)) return;
          this.freeOrbitDragged = true;
          this.renderer.startFreeOrbit();
          this.renderer.orbitBy(
            e.clientX - this.freeOrbitStart.x,
            e.clientY - this.freeOrbitStart.y,
          );
          this.freeOrbitLast = current;
          return;
        }
        const dx = e.clientX - this.freeOrbitLast.x;
        const dy = e.clientY - this.freeOrbitLast.y;
        this.freeOrbitLast = { x: e.clientX, y: e.clientY };
        this.renderer.orbitBy(dx, dy);
        return;
      }
      if (this.isPanning) {
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        this.renderer.setPanFromDragDelta(this.panStartPan.x, this.panStartPan.y, dx, dy);
        return;
      }
      if (this.renderer.updateLandPurchaseHover?.(e.clientX, e.clientY)) {
        canvas.style.cursor = 'pointer';
        this._hideTooltip();
        return;
      }
      if (!this._landPurchasePress) canvas.style.cursor = this.activeTool?.cursor || '';
      this._lastScreenX = e.clientX;
      this._lastScreenY = e.clientY;
      this._updatePlacementKeyHint(e.clientX, e.clientY);
      const deferredPortDrag = this._deferredUtilityPortDrag.update(e);
      if (deferredPortDrag) {
        this.setTool(new UtilityLineTool(deferredPortDrag.port.utilityType));
        // Replay the original press so the line stays anchored on the port,
        // then advance the newly armed tool to the current cursor in the same
        // event. This makes the threshold invisible in the preview geometry.
        this._toolConsumed('onMouseDown', deferredPortDrag.press);
        this._toolConsumed('onMouseMove', e);
        return;
      }
      if (this._updateMarquee(e)) {
        this._hideTooltip();
        return;
      }
      // Active tool gets first claim on the move (hover previews, drag
      // previews). The generic branch below only runs with no tool armed
      // (or with a tool, like ProbeTool, that leaves hover untouched).
      if (this._toolConsumed('onMouseMove', e)) return;
      const world = this.renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      this.renderer.updateHover(grid.col, grid.row);
      this.lastMouseWorldX = world.x;
      this.lastMouseWorldY = world.y;
      this._lastScreenX = e.clientX;
      this._lastScreenY = e.clientY;
      // Update design placer position
      if (this.game._designPlacer && this.game._designPlacer.active) {
        this.game._designPlacer.setPosition(grid.col, grid.row);
        this.renderer._renderCursors();
      }
      // Hover tooltip for furnishings/equipment.
      this._checkHoverTooltip(world, grid, e.clientX, e.clientY);
    });

    canvas.addEventListener('mouseleave', () => {
      this.renderer.clearLandPurchaseHover?.();
      this._landPurchasePress = false;
      this._hideTooltip();
      this._hidePlacementKeyHint();
    });

    canvas.addEventListener('mouseup', (e) => {
      this._hideDragCostTooltip();
      if (e.button === 0) this._deferredUtilityPortDrag.release();
      if (e.button === 1 && this._finishMiddleCameraGesture({ toggleClick: true })) return;
      if (e.button === 0 && this._landPurchasePress) {
        this._landPurchasePress = false;
        canvas.style.cursor = this.activeTool?.cursor || '';
        this.renderer.purchaseLandAtScreen?.(e.clientX, e.clientY);
        return;
      }
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = '';
        return;
      }
      if (e.button === 0 && this._finishMarquee(e)) return;

      // Active tool gets first claim on the release (drag commits). A
      // plain click falls through to _handleClick, which dispatches the
      // tool's onClick.
      if (this._toolConsumed('onMouseUp', e)) return;

      if (e.button === 0) {
        // Left click
        this._handleClick(e.clientX, e.clientY, { shiftKey: e.shiftKey });
      } else if (e.button === 2) {
        // Right click — the active tool decides whether it erases, cancels,
        // or deselects. ZonePaintTool erases the hovered zone while staying
        // armed; PlaceableTool keeps the legacy behavior of ignoring it.
        //
        // ...except while Ctrl/Cmd is held. macOS reports a Ctrl+left-click
        // as a right-click (WebKit rewrites the button; Chrome keeps button 0
        // but still fires contextmenu), so the erase drag would arrive here
        // as a right release — WallTool.onRightClick would remove one extra
        // wall and FloorTool.onRightClick would disarm the tool mid-gesture.
        // Ctrl already means "erase along the drawn path", so swallow it.
        if (e.ctrlKey || e.metaKey || this._ctrlDown) return;
        this._toolConsumed('onRightClick', e);
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Same macOS collision as above: the Ctrl+left-click that starts an
      // erase drag also fires contextmenu. Stop it here so nothing further
      // up can read it as a real right-click on the world.
      if (e.ctrlKey || e.metaKey || this._ctrlDown) e.stopPropagation();
    });

    // Double-click: enter edit mode for the clicked beamline and open its window
    canvas.addEventListener('dblclick', (e) => {
      const world = this.renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      const clickedNode = this._getNodeAtScreenOrGrid(e.clientX, e.clientY, grid.col, grid.row);
      if (clickedNode) {
        const blId = clickedNode.beamlineId;
        if (blId) {
          this.game.editingBeamlineId = blId;
          this.game.selectedBeamlineId = blId;
          this.renderer._openBeamlineWindow(blId, clickedNode);
          this.game.emit('editModeChanged', blId);
        }
      }
    });

    // Window-level fallback: if the user releases the middle mouse
    // button while the cursor is off the canvas, end the orbit cleanly
    // so the snap animation still runs.
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1 && this.isFreeOrbiting) {
        // Releasing off-world completes a real orbit, but does not turn a
        // pending press into a view-toggle click.
        this._finishMiddleCameraGesture();
        return;
      }
      // The canvas is a full-screen overlay with the HUD, build bar, popups
      // and context windows painted on top of it, so a release over any
      // chrome never reaches the canvas listener above. Without this fallback
      // the gesture stays armed and commits at the *next* canvas mouseup —
      // a stale decoration line places 20 trees at an unrelated click, a
      // stale remove-sweep deletes every pipe between the old origin and the
      // new click, and Alt+drag leaves the camera panning with no button
      // held. Abort rather than commit: the release happened off-world, so
      // there is no meaningful commit position.
      if (e.target === canvas) return;
      this._abortPointerGesture();
    });

    // Same teardown when focus is lost mid-drag (alt-tab, devtools, a modal
    // stealing focus) or the browser cancels the pointer stream.
    window.addEventListener('blur', () => this._abortPointerGesture());
    window.addEventListener('pointercancel', () => this._abortPointerGesture());
  }

  /**
   * Finish the pending middle-button camera gesture. A drag owns a live
   * renderer orbit and must snap it; an on-canvas click owns no orbit yet and
   * toggles only the camera elevation. Off-canvas/abort callers pass false.
   */
  _finishMiddleCameraGesture({ toggleClick = false } = {}) {
    if (!this.isFreeOrbiting) return false;
    const dragged = this.freeOrbitDragged;
    this.isFreeOrbiting = false;
    this.freeOrbitDragged = false;
    if (dragged) this.renderer.endFreeOrbit?.();
    else if (toggleClick) this.renderer.toggleViewMode?.();
    const canvas = this.renderer?.app?.canvas || this.renderer?.canvas;
    if (canvas) canvas.style.cursor = '';
    return true;
  }

  /**
   * Drop every in-flight pointer gesture without committing it: camera
   * orbit/pan and the active tool's drag state. Safe to call repeatedly.
   */
  _abortPointerGesture() {
    this._hideDragCostTooltip?.();
    this._finishMiddleCameraGesture();
    this.isPanning = false;
    this._deferredUtilityPortDrag?.cancel?.();
    this._clearMarquee?.();
    this._hidePlacementKeyHint?.();
    const canvas = this.renderer?.canvas;
    if (canvas) canvas.style.cursor = this.activeTool?.cursor || '';
    // 'abort', not 'stateReplaced': nothing restores the world here, so a
    // tool carrying a lifted object has to put it back itself.
    this.activeTool?.cancelGesture?.(this._toolCtx, 'abort');
  }

  // --- Click handling ---

  _handleClick(screenX, screenY, { shiftKey = false } = {}) {
    if (this._suppressNextClick) {
      this._suppressNextClick = false;
      return;
    }
    const world = this.renderer.screenToWorld(screenX, screenY);
    const grid = isoToGrid(world.x, world.y);
    const col = grid.col;
    const row = grid.row;

    // DesignPlacer confirmation
    if (this.game._designPlacer && this.game._designPlacer.active) {
      // requestConfirm owns preview → revalidation → undoable commit. Keeping
      // that multi-step workflow on DesignPlacer leaves InputHandler as event
      // routing and gives every surface that places a design the same gate.
      Promise.resolve(this.game._designPlacer.requestConfirm()).catch((err) => {
        console.error('[design placer] confirmation crashed', err);
        this.game.log('Design placement failed unexpectedly — nothing was changed', 'bad');
      });
      return;
    }

    // Active tool gets first claim on the click (placement commits).
    if (this._toolConsumed('onClick', {
      clientX: screenX,
      clientY: screenY,
      button: 0,
      shiftKey,
    })) {
      return;
    }

    // Staff are rendered as animated figures rather than placeables. Give
    // them first-class click priority so a person can be opened even while
    // standing on top of a facility object.
    const staffHit = this.renderer.raycastStaffScreen?.(
      screenX, screenY, OBJECT_PICK_TOLERANCE_PX,
    );
    if (staffHit?.staffId) {
      this.renderer._openStaffInspector?.(staffHit.staffId);
      return;
    }

    // Click-to-select: all placeable objects get a persistent white outline
    // and their info menu. Equipment wins before utility-line inspection so a
    // cable ending on (or crossing in front of) its mesh cannot steal the
    // click. Tools still own their placement clicks above; escape/disarm
    // returns the canvas to this direct selection behavior.
    if (this._selectPlaceableAt(
      world, grid, screenX, screenY,
      { additive: shiftKey },
    )) return;

    // Utility-line click-to-inspect is the fallback after the placeable pick.
    // An armed beamline tool suppresses it; tools that consume clicks never
    // reach this point. Opens a UtilityInspector for the clicked line's net.
    if (this.activeTool?.kind !== 'beamline'
        && typeof this.renderer.raycastUtilityLine === 'function') {
      const hit = this.renderer.raycastUtilityLine(
        screenX, screenY, OBJECT_PICK_TOLERANCE_PX,
      );
      if (hit && hit.lineId) {
        if (this.openUtilityInspectorForLine(hit.lineId)) return;
      }
    }

    {
      // Phase 6: rack-segment click-to-inspect removed. Utility inspection
      // now flows through UtilityInspector (opened via the utility-line
      // raycast earlier in _handleClick).
      // Check for facility equipment click
      const facKey = col + ',' + row;
      const facId = this.game.state.facilityGrid[facKey];
      if (facId) {
        const equip = this.game.state.facilityEquipment.find(e => e.id === facId);
        if (equip) {
          const comp = COMPONENTS[equip.type];
          if (comp) {
            if (!shiftKey) this.game.refillEmptyReservoirForPlaceable?.(equip.id);
            this.renderer.showNetworkOverlay(facId);
            this.renderer.openEquipmentWindow(equip);
            return;
          }
        }
      }
      // Clicked empty space — exit edit mode if active
      if (this.game.editingBeamlineId) {
        this.game.editingBeamlineId = null;
        this.game.emit('editModeChanged', null);
      }
      this.selectedNodeId = null;
      // Shift-clicking empty ground should not throw away a selection the
      // player is still building.
      if (!shiftKey) this._clearSelection();
      this.renderer.hidePopup();
      this.renderer.clearNetworkOverlay();
    }
  }

  // --- Tool abstraction (Phase 4) ---

  /**
   * Arm a Tool object as the single active tool. Runs the previous tool's
   * onExit — this is where mutual exclusivity now lives — then runs the
   * new tool's onEnter. Palette/HUD sync that generalizes across families
   * (popup, node selection, hover ghost, tooltip, shift hint) happens
   * here; family-specific arming lives in the tool's onEnter.
   */
  setTool(tool) {
    this._deferredUtilityPortDrag?.cancel?.();
    const prev = this.activeTool;
    this.activeTool = null;
    if (prev) {
      prev.onExit?.(this._toolCtx);
      if (prev.cursor) this.renderer.canvas.style.cursor = '';
    }
    this.hoverPlaceable = null;
    this.renderer._clearPreview?.();
    this.renderer.hidePopup();
    this.selectedNodeId = null;
    this.selectedPlaceableId = null;
    this.selectedPlaceableIds?.clear?.();
    this._selectedRootsById?.clear?.();
    this._selectionCandidatesByKey?.clear?.();
    this.renderer.clearSelectionOutline?.();
    this.renderer.closeSelectionWindow?.();
    this._hideTooltip();
    // Variant is per-armed-tool state: whatever the previous tool chose must
    // not survive into the next one (a decoration swatch leaking into a
    // facility item commits that item with a variant it never offered).
    // Tools that own a variant write it back in onEnter.
    this.selectedPlaceableVariant = 0;
    this.activeTool = tool || null;
    this.renderer.ui?._setConnectionGuidePlacementActive?.(Boolean(this.activeTool));
    if (this.activeTool) {
      this.activeTool.onEnter?.(this._toolCtx);
      if (this.activeTool.cursor) {
        this.renderer.canvas.style.cursor = this.activeTool.cursor;
      }
      // Keyboard arming (palette hotkeys, arrow nav, context demolish, mode
      // switches) never produces a mousemove, and the _clearPreview above
      // wiped whatever ghost was up — repaint at the last cursor position so
      // the armed tool is visible before the mouse moves. The mousemove path
      // repaints on its own, and nothing calls setTool from inside it, so
      // this cannot double-render.
      this._repaintArmedPreview();
    }
    this._updateShiftHint();
    this._updatePlacementKeyHint?.();
  }

  /**
   * Repaint the armed tool's hover ghost at the last known cursor position.
   * Attachment-kind beamline tools (gauges/valves) route to the pipe-projected
   * ghost: the unified placeable ghost would be drawn and immediately
   * overwritten by it.
   */
  _repaintArmedPreview() {
    const armedId = this.armedPlaceableId;
    if (!armedId) return;
    if (this.lastMouseWorldX == null || this.lastMouseWorldY == null) return;
    const def = COMPONENTS[armedId];
    if (def?.placement === 'attachment' && !def.role) {
      this._updateAttachmentPreview(armedId, this.lastMouseWorldX, this.lastMouseWorldY);
      return;
    }
    this._updatePlaceablePreview();
  }

  /**
   * Default Escape behavior — the esc-stack fallback entry, reached only
   * when no dialog/overlay/context-window above us claimed the key.
   * Ladder: blueprint-place cancel → the active tool's own onKey
   * (DemolishTool consumes Esc there to restore the pre-demolish menu) →
   * plain tool disarm → selection/overlay sweep. First Esc drops an armed
   * tool; the next Esc does the sweep.
   */
  _handleEscape(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return false;
    // Blueprint placement cancels first (matches the legacy dispatch order —
    // _toolConsumed suppresses tools while the placer is active anyway).
    if (this.game._designPlacer && this.game._designPlacer.active) {
      this.game._designPlacer.cancel();
      return true;
    }
    // Active tool gets first claim on the key.
    if (this._toolConsumed('onKey', e)) return true;
    if (this.activeTool) {
      this.clearTool();
      this._hidePreview();
      return true;
    }
    // Exit edit mode if active
    if (this.game.editingBeamlineId) {
      this.game.editingBeamlineId = null;
      this.game.emit('editModeChanged', null);
    }
    // Close network overlay if active
    if (this.renderer.activeNetworkType) {
      this.renderer.clearNetworkOverlay();
    }
    // Close all overlays and clear selection / palette keyboard focus.
    document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
    this.selectedNodeId = null;
    this._clearSelection();
    this.renderer.hidePopup();
    this.paletteIndex = -1;
    this._hidePreview();
    document.querySelectorAll('.palette-item').forEach(el => el.classList.remove('kb-focus'));
    return true;
  }

  /** Disarm the active tool (if any), running its onExit. */
  clearTool() {
    if (!this.activeTool) return;
    const prev = this.activeTool;
    this.activeTool = null;
    prev.onExit?.(this._toolCtx);
    if (prev.cursor) this.renderer.canvas.style.cursor = '';
    this.hoverPlaceable = null;
    this.renderer._clearPreview?.();
    this.renderer.ui?._setConnectionGuidePlacementActive?.(false);
    this._updateShiftHint();
    this._hidePlacementKeyHint?.();
  }

  /**
   * Dispatch an event to the active tool. Returns true when the tool
   * consumed it (callers stop; legacy chains run otherwise). Suppressed
   * while the DesignPlacer overlay is active so blueprint placement keeps
   * first claim on the cursor, matching the legacy dispatch order.
   */
  _toolConsumed(method, e) {
    const t = this.activeTool;
    if (!t || typeof t[method] !== 'function') return false;
    if (this.game._designPlacer && this.game._designPlacer.active) return false;
    return !!t[method](e, this._toolCtx);
  }

  // --- Tool selection ---

  /**
   * The single palette → tool path. Every palette item (mouse click via
   * hud.js and keyboard nav via _applyPaletteFocus) carries a
   * {paletteKind, paletteKey} pair in its dataset and routes here; this is
   * the only place palette identity maps to Tool construction.
   */
  selectPaletteTool(kind, key, variant = 0) {
    switch (kind) {
      case 'component':  this.selectComponentTool(key); break;
      case 'utilityBus': this.setTool(new UniversalUtilityBusTool(key)); break;
      case 'facility':   this.setTool(new PlaceableTool('facility', key, variant)); break;
      case 'floor':      this.setTool(new FloorTool(key, variant)); break;
      case 'wall':       this.setTool(new WallTool(key, variant)); break;
      case 'wallPaint':  this.setTool(new WallPaintTool(key)); break;
      case 'door':       this.setTool(new DoorTool(key, variant)); break;
      case 'window':     this.setTool(new WindowTool(key, variant)); break;
      case 'zone':       this.setTool(new ZonePaintTool(key)); break;
      case 'furnishing': this.setTool(new PlaceableTool('furnishing', key, variant)); break;
      case 'decoration': this.setTool(new PlaceableTool('decoration', key, variant)); break;
      case 'demolish':   this.setTool(new DemolishTool('demolishFiltered', this.demolishFilters)); break;
      case 'utility':    this.setTool(new UtilityLineTool(key)); break;
      default:
        console.warn('[InputHandler] unknown palette kind:', kind, key);
    }
  }

  getDemolishFilters() {
    return new Set(this.demolishFilters);
  }

  setDemolishFilter(key, enabled) {
    const next = normalizeDemolishFilters(this.demolishFilters);
    if (enabled) next.add(key);
    else next.delete(key);
    this.demolishFilters = normalizeDemolishFilters(next);
    if (this.activeTool?.kind === 'demolish' && this.activeTool.filtered) {
      this.activeTool.setFilters(this.demolishFilters);
      this.renderer.clearDragPreview();
      this._hideDemolishTooltip();
      this._updateShiftHint();
    }
    return this.demolishFilters.has(key);
  }

  /**
   * Arm a beamline COMPONENTS tool. The open BeamlineDesigner intercepts
   * palette clicks (adds the component to the draft instead); otherwise
   * this arms a BeamlineTool with any param-flyout overrides the HUD
   * stashed for this component.
   */
  selectComponentTool(key) {
    if (this.game._designer?.isOpen && this.game._designer.handlePaletteClick?.(key)) {
      return;
    }
    const placeable = PLACEABLES[key] || COMPONENTS[key];
    if (placeable?.universalUtilityBus) {
      this.setTool(new UniversalUtilityBusTool(key));
      return;
    }
    if (placeable?.linearManifold) {
      this.setTool(new LinearManifoldTool(key));
      return;
    }
    // Param-flyout overrides live on the UIHost (renderer.ui); fall back to
    // the renderer for harnesses that stub it flat.
    const overrideMap = this.renderer.ui?._selectedParamOverrides
      ?? this.renderer._selectedParamOverrides;
    const overrides = overrideMap?.[key] || null;
    this.setTool(new BeamlineTool(key, overrides));
  }

  /** Arm a live beam-pipe ghost at a source's exit after source placement. */
  beginBeamPipeFromSource(sourceId) {
    this.selectComponentTool('drift');
    return this.beamlineController.showGuidedPipeStart(sourceId, 'exit');
  }

  /**
   * Locate a deletable placeable under the cursor, honoring the demolish
   * mode's kind scope. Returns { kind, placeable, entry?, node?, rootObj? }
   * or null. Strategy:
   *   1. Raycast. If it hits a beamline component and 'beamline' is in
   *      scope, return the registry node + root mesh for outlining.
   *   2. If raycast hits equipment / decoration, derive the world (x,z)
   *      from the root mesh position and probe subgridOccupied.
   *   3. If raycast missed, fall back to probing the subgrid cell under
   *      the cursor world position.
   * Never returns an entry whose kind isn't in the scope set. Click callers
   * get the standard screen-space margin; high-frequency hover callers can
   * pass zero to request a single exact ray.
   */
  _findDeletablePlaceable(
    world, grid, screenX, screenY, scope,
    tolerancePx = OBJECT_PICK_TOLERANCE_PX,
  ) {
    if (!scope) return null;
    const allowsEntry = entry => scope.has(entry?.kind || entry?.category)
      && (!scope.allowsPlaceable || scope.allowsPlaceable(entry));

    // --- 1. Raycast for precise 3D hit detection ---
    const hit = this.renderer.raycastScreen(screenX, screenY, tolerancePx);
    if (hit) {
      const info = this.renderer.identifyHit(hit);
      if (info) {
        // Beamline components go through the legacy beam-graph registry
        // because their lifecycle is tracked there, not only in state.placeables.
        // Infrastructure modules share the same componentBuilder render path,
        // so they hit info.group === 'component' too — but they live only in
        // state.placeables (no registry node), so fall through to the unified
        // probe below if no node is found.
        if (info.group === 'component' && (scope.has('beamline') || scope.has('infrastructure'))) {
          let node = null;
          if (info.nodeId) {
            node = this.game.state.placeables.find(p => p.id === info.nodeId);
          }
          if (!node) {
            const p = info.rootObj.position;
            node = this._getNodeAtGrid(Math.floor(p.x / 2), Math.floor(p.z / 2));
          }
          if (!node) node = this._getNodeAtGrid(grid.col, grid.row);
          if (node && scope.has('beamline') && allowsEntry(node)) {
            const placeable = PLACEABLES[node.type] || COMPONENTS[node.type];
            return { kind: 'beamline', node, placeable, rootObj: info.rootObj };
          }
          // No registry node — likely an infrastructure module. Resolve via
          // the unified subgridOccupied probe using the hit world position.
          const p = info.rootObj.position;
          const entry = this._placeableAtWorldPos(p.x, p.z);
          if (entry && allowsEntry(entry)) {
            return {
              kind: entry.kind,
              entry,
              placeable: PLACEABLES[entry.type],
              rootObj: info.rootObj,
            };
          }
        }
        // Beam pipes are handled separately from kind-based scope — still
        // reachable from any mode that allows beamline.
        if (info.group === 'beampipe' && scope.has('beamline')) {
          return { kind: 'beampipe', pipeId: info.pipeId, rootObj: info.rootObj };
        }
        // Beam-pipe placements piggyback on 'beamline' scope.
        if (info.group === 'attachment' && scope.has('beamline')) {
          const pipe = (this.game.state.beamPipes || []).find(p => p.id === info.pipeId);
          const att = pipe?.placements?.find(a => a.id === info.attachmentId) || null;
          return {
            kind: 'placement',
            pipeId: info.pipeId,
            attachmentId: info.attachmentId,
            attachment: att,
            placeable: att ? COMPONENTS[att.type] : null,
            rootObj: info.rootObj,
          };
        }
        if (info.group === 'utilityAttachment' && scope.has('infrastructure')) {
          const line = this.game.state.utilityLines?.get(info.lineId);
          const att = line?.attachments?.find(a => a.id === info.attachmentId) || null;
          return {
            kind: 'utilityAttachment',
            lineId: info.lineId,
            attachmentId: info.attachmentId,
            attachment: att,
            placeable: att ? COMPONENTS[att.type] : null,
            rootObj: info.rootObj,
          };
        }
        // Prefer the id stamped on the rendered wrapper. Floating overhead
        // fixtures intentionally have no floor-occupancy entry to probe.
        if (info.group === 'equipment' || info.group === 'decoration') {
          const p = info.rootObj.position;
          const entry = (info.nodeId && this.game.getPlaceable(info.nodeId))
            || this._placeableAtWorldPos(p.x, p.z);
          if (entry && allowsEntry(entry)) {
            return {
              kind: entry.kind,
              entry,
              placeable: PLACEABLES[entry.type],
              rootObj: info.rootObj,
            };
          }
        }
      }
    }

    // --- 2. Fallback: probe the subgrid cell under the cursor ---
    // Used when the raycast missed the mesh (e.g. hovering over a hollow
    // region of a multi-tile beamline module that's on legs). Resolve the
    // rootObj from the component builder so the outline can still render.
    if (grid && grid.col !== undefined && grid.row !== undefined) {
      const tilePos = gridToIso(grid.col, grid.row);
      const sub = isoToSubGrid(world.x - tilePos.x, world.y - tilePos.y);
      const sc = Math.floor(sub.subCol);
      const sr = Math.floor(sub.subRow);
      if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
        const k = subtileKey(grid.col, grid.row, sc, sr, this.game.activeLevel);
        const occ = this.game.state.subgridOccupied[k];
        if (occ && scope.has(occ.kind)) {
          const entry = this.game.getPlaceable(occ.id);
          if (entry && allowsEntry(entry)) {
            // Decorations live in the decoration builder's own registry, not
            // the component mesh map — check both or they highlight nothing.
            const rootObj = this.renderer.componentBuilder?.getGroup?.(entry.id)
              || this.renderer.decorationBuilder?.getGroup?.(entry.id)
              || null;
            return {
              kind: occ.kind,
              entry,
              placeable: PLACEABLES[entry.type],
              rootObj,
            };
          }
        }
      }
    }

    // --- 3. Tile-level fallback for beamline + infrastructure modules ---
    // If the cursor is over a major tile occupied by a beamline or infra
    // placeable (checked via p.cells, not just subgrid), highlight it. This
    // covers the case where a large module spans a tile the raycast/subgrid
    // probe didn't resolve (e.g. hollow leg regions not registered to subgrid).
    if (grid && grid.col !== undefined && grid.row !== undefined) {
      for (const p of this.game.state.placeables) {
        if (p.category !== 'beamline' && p.category !== 'infrastructure') continue;
        if (!sameLevel(p, this.game.activeLevel)) continue;
        if (!allowsEntry(p)) continue;
        if (!p.cells) continue;
        if (p.cells.some(c => c.col === grid.col && c.row === grid.row)) {
          const rootObj = this.renderer.componentBuilder?.getGroup?.(p.id) || null;
          return {
            kind: p.category,
            entry: p,
            placeable: PLACEABLES[p.type] || COMPONENTS[p.type],
            rootObj,
          };
        }
      }
    }

    // --- 4. Generous beam-pipe fallback ---
    // Beam pipes are long and narrow; if nothing else matched but the cursor
    // is close to a pipe segment, prefer that pipe. Only when 'beamline' is in scope.
    // world.x and world.y are isometric screen-space coords (pixels).
    if (scope.has('beamline') && world && typeof world.x === 'number') {
      const pipe = this._beamPipeNearWorldPos(world.x, world.y, 0.5);
      if (pipe) {
        return { kind: 'beampipe', pipeId: pipe.id, rootObj: null };
      }
    }

    return null;
  }

  /**
   * Generous beam-pipe hit test. Beam pipes are narrow, so the raycast may
   * miss them when the cursor is just to the side. Returns the first pipe
   * whose path has any segment within `pad` tile units of the cursor.
   *
   * @param {number} isoX  - isometric screen-space X (world.x)
   * @param {number} isoY  - isometric screen-space Y (world.y)
   * @param {number} pad   - perpendicular tolerance in tile units (default 0.5 = half tile)
   * @returns {object|null} the pipe entry, or null
   */
  _beamPipeNearWorldPos(isoX, isoY, pad = 0.5) {
    const pipes = this.game.state.beamPipes || [];
    // Convert isometric screen coords to fractional tile coords.
    const fc = isoToGridFloat(isoX, isoY);
    // isoToGridFloat returns col/row of the cursor in tile space.
    const cx = fc.col;
    const cz = fc.row;
    for (const pipe of pipes) {
      if (!pipe.path || pipe.path.length === 0) continue;
      // Single-point pipes (tiny remnants after splitting): treat as a point hit
      if (pipe.path.length === 1) {
        const a = pipe.path[0];
        const dx = cx - (a.col + 0.5), dz = cz - (a.row + 0.5);
        if (dx * dx + dz * dz <= pad * pad) return pipe;
        continue;
      }
      for (let i = 0; i < pipe.path.length - 1; i++) {
        const a = pipe.path[i];
        const b = pipe.path[i + 1];
        // Segment endpoints in tile space (tile centers at col+0.5, row+0.5).
        const ax = a.col + 0.5, az = a.row + 0.5;
        const bx = b.col + 0.5, bz = b.row + 0.5;
        // Distance from cursor tile point to segment (a, b).
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz;
        if (len2 === 0) {
          // Zero-length segment: treat as point hit
          const ddx2 = cx - ax, ddz2 = cz - az;
          if (ddx2 * ddx2 + ddz2 * ddz2 <= pad * pad) return pipe;
          continue;
        }
        let t = ((cx - ax) * dx + (cz - az) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx, pz = az + t * dz;
        const ddx = cx - px, ddz = cz - pz;
        if (ddx * ddx + ddz * ddz <= pad * pad) {
          return pipe;
        }
      }
    }
    return null;
  }

  /**
   * Look up a placed instance whose footprint contains the given
   * world-space (x, z) point. Used by _findDeletablePlaceable to map a
   * raycast hit's rootObj.position back to the placeable that owns it.
   */
  _placeableAtWorldPos(worldX, worldZ) {
    const col = Math.floor(worldX / 2);
    const row = Math.floor(worldZ / 2);
    const subCol = Math.max(0, Math.min(3, Math.floor((worldX - col * 2) / 0.5)));
    const subRow = Math.max(0, Math.min(3, Math.floor((worldZ - row * 2) / 0.5)));
    const k = subtileKey(col, row, subCol, subRow, this.game.activeLevel);
    const occ = this.game.state.subgridOccupied[k];
    if (occ) return this.game.getPlaceable(occ.id);
    return null;
  }

  /**
   * If a placement-role tool is armed, update the game's placement mode and
   * refresh the preview. Returns true when the key was consumed so the
   * caller can skip fallthrough handlers (e.g. R's rotation path).
   */
  _handlePlacementModeKey(mode) {
    if (!this.armedPlaceableId) return false;
    const def = COMPONENTS[this.armedPlaceableId];
    if (!def || def.role !== 'placement') return false;
    this.game.setPlacementMode?.(mode);
    this._showToast?.(`Placement mode: ${mode}`);
    this._updatePlaceablePreview();
    return true;
  }

  /**
   * Mirror utility ports on the currently armed object without rotating its
   * body or beam entry/exit ports. Returns true only when M had an applicable
   * placement to transform, leaving unarmed M to the contextual Mirror mode.
   */
  _handleMirrorPortsKey(e) {
    if (e.key !== 'm' && e.key !== 'M') return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const armedId = this.armedPlaceableId;
    if (!armedId) return false;
    const def = COMPONENTS[armedId];
    const hasUtilityPorts = Object.values(def?.ports || {})
      .some(port => port?.utility);
    if (!hasUtilityPorts) return false;

    e.preventDefault?.();
    this.placementPortsFlipped = !this.placementPortsFlipped;
    this._showToast?.(`Utility ports: ${this.placementPortsFlipped ? 'mirrored' : 'default side'}`);
    this._updatePlaceablePreview?.();
    // Candidate markers are cached separately from the placement ghost.
    this.renderer._portMarkersDirty = true;
    return true;
  }

  /** Mirror selected beamline utility ports in place; selection stays active. */
  _handleMirrorSelectedBeamlinePortsKey(e) {
    if (e.key !== 'm' && e.key !== 'M') return false;
    if (e.ctrlKey || e.metaKey || e.altKey || this.armedPlaceableId) return false;
    const ids = [...(this.selectedPlaceableIds || [])];
    if (!ids.length) return false;
    const hasBeamlineTarget = ids.some(id => (
      selectionTargetByKey(this.game.state, id)?.selectionCategory === 'beamline'
    ));
    if (!hasBeamlineTarget) return false;
    e.preventDefault?.();
    if (typeof this._beginSelectedMirror === 'function') {
      this._beginSelectedMirror(this.selectedPlaceableId);
    } else {
      InputHandler.prototype._beginSelectedMirror.call(this, this.selectedPlaceableId);
    }
    return true;
  }

  /**
   * Recompute the unified placeable ghost from the last known cursor
   * world position. Called from the mousemove handler and from the
   * rotation key so rotating refreshes the preview immediately.
   */
  _updatePlaceablePreview() {
    const armedId = this.armedPlaceableId;
    if (!armedId) {
      this.hoverPlaceable = null;
      this.renderer.clearPlaceableUtilityDragPreview?.();
      return;
    }
    // A carried placeable remains in world state so its stable ID keeps pipe
    // and utility references intact. Its own occupied cells must therefore be
    // transparent to the move preview, and moving never re-charges its cost.
    const movePayload = this.activeTool?.kind === 'move' ? this.activeTool.payload : null;
    const ignorePlaceableId = movePayload?.kind === 'selectedPlaceable'
      ? movePayload.placeableId
      : (movePayload?.kind === 'component' ? movePayload.nodeId : null);
    const previewOptions = ignorePlaceableId
      ? { ignorePlaceableId, free: true, level: this.game.activeLevel }
      : { level: this.game.activeLevel };

    // Beamline junction/placement hover is handled by BeamlineInputController.
    const selDef = COMPONENTS[armedId];
    if (selDef?.role === 'junction' || selDef?.role === 'placement') {
      const wx = this.lastMouseWorldX ?? 0;
      const wy = this.lastMouseWorldY ?? 0;
      const hover = this.beamlineController.onHover(wx, wy, armedId, previewOptions);
      // Junction moves need the snapped pose at drop time. On-pipe placement
      // tools keep their separate controller-owned slot record.
      this.hoverPlaceable = selDef.role === 'junction' ? (hover || null) : null;
      if (ignorePlaceableId && this.hoverPlaceable) {
        this.renderer.previewPlaceableUtilityDrag?.(ignorePlaceableId, this.hoverPlaceable);
      } else {
        this.renderer.clearPlaceableUtilityDragPreview?.();
      }
      return;
    }
    // Drawn connections (beam pipes) have their own preview system; skip the
    // full-tile ghost/grid overlay so hovering with the pipe tool stays clean.
    if (selDef?.isDrawnConnection) {
      this.hoverPlaceable = null;
      this.renderer.clearPlaceableUtilityDragPreview?.();
      return;
    }
    const placeable = PLACEABLES[armedId];
    if (!placeable) {
      // No unified def for the armed id — nothing can be committed, so the
      // ghost left over from the previous tool must not stay on screen.
      this.hoverPlaceable = null;
      this.renderer._clearPreview?.();
      this.renderer.clearPlaceableUtilityDragPreview?.();
      return;
    }
    // Selected and beamline move payloads remain in state so their stable IDs
    // keep pipes, wall mounts, and utility lines attached. Their current
    // occupancy therefore has to be transparent to their own move ghost while
    // every foreign floor cell or wall-face slot remains a blocker.
    if (placeable.mount === 'wall') {
      const hasScreenPoint = Number.isFinite(this._lastScreenX) && Number.isFinite(this._lastScreenY);
      const edge = hasScreenPoint
        ? this._getNearestWallEdge(this._lastScreenX, this._lastScreenY)
        : null;
      const wallMount = edge ? {
        col: edge.col,
        row: edge.row,
        edge: edge.edge,
        off: wallFixtureOffFromFrac(edge.frac, placeable.wallSpan),
        level: this.game.activeLevel,
      } : null;
      const geometric = canPlaceWallFixture(
        this.game, placeable, wallMount, ignorePlaceableId,
      );
      const affordable = ignorePlaceableId
        ? true
        : canAffordCost(this.game, componentCostFor(placeable));
      const ok = geometric.ok && affordable;
      const reason = !geometric.hasWall
        ? PLACE_WALL
        : (geometric.occupied ? PLACE_BLOCKED : (affordable ? null : PLACE_UNAFFORDABLE));
      this.hoverPlaceable = {
        id: armedId,
        col: wallMount?.col ?? 0,
        row: wallMount?.row ?? 0,
        subCol: 0,
        subRow: 0,
        dir: wallFixtureDir(geometric.wallMount),
        portsFlipped: this.placementPortsFlipped === true,
        placeY: 0,
        stackTargetId: null,
        wallMount: geometric.wallMount,
        level: this.game.activeLevel,
        variant: this.selectedPlaceableVariant,
        valid: ok,
        reason,
      };
      this.renderer.renderPlaceableGhost(this.hoverPlaceable, ok, reason);
      if (ignorePlaceableId) {
        this.renderer.previewPlaceableUtilityDrag?.(ignorePlaceableId, this.hoverPlaceable);
      }
      return;
    }
    const wx = this.lastMouseWorldX ?? 0;
    const wy = this.lastMouseWorldY ?? 0;
    const snap = snapForPlaceable(wx, wy, placeable, this.placementDir);
    let placeY = 0;
    let stackTargetId = null;
    let ok = false;
    let reason = null;
    let mapEdgeConnection = null;

    if (placeable.stackable) {
      const getEntry = (id) => {
        const idx = this.game.state.placeableIndex[id];
        return idx !== undefined ? this.game.state.placeables[idx] : null;
      };
      const getDef = (t) => PLACEABLES[t] || null;
      const st = findStackTarget(
        placeable, snap.col, snap.row, snap.subCol, snap.subRow, this.placementDir,
        this.game.state.subgridOccupied, getEntry, getDef,
        {
          ignoreEntryId: ignorePlaceableId,
          keyForCell: c => subtileKey(
            c.col, c.row, c.subCol, c.subRow, this.game.activeLevel,
          ),
        },
      );
      if (st) {
        placeY = st.placeY;
        stackTargetId = st.targetEntry.id;
        // Stacking bypasses the footprint check, not the ledger — Game still
        // charges for the stacked item. componentCostFor (fix round 3),
        // not the bare placeable.cost: harmless today (beamline junctions
        // don't stack, so this never actually hits the spares branch), but
        // the same "green ghost, red click" shape as every other call site
        // this round fixed, and free to close now.
        ok = canAffordCost(this.game, componentCostFor(placeable));
        reason = ok ? null : PLACE_UNAFFORDABLE;
      } else {
        const result = previewPlacement(
          this.game, placeable,
          snap.col, snap.row, snap.subCol, snap.subRow,
          this.placementDir,
          previewOptions,
        );
        ok = result.ok;
        reason = result.reason;
        mapEdgeConnection = result.mapEdgeConnection;
      }
    } else {
      const result = previewPlacement(
        this.game, placeable,
        snap.col, snap.row, snap.subCol, snap.subRow,
        this.placementDir,
        previewOptions,
      );
      ok = result.ok;
      reason = result.reason;
      mapEdgeConnection = result.mapEdgeConnection;
    }

    this.hoverPlaceable = {
      id: armedId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir: this.placementDir,
      portsFlipped: this.placementPortsFlipped === true,
      placeY,
      stackTargetId,
      variant: this.selectedPlaceableVariant,
      mapEdgeConnection,
      valid: ok,
      reason,
      level: this.game.activeLevel,
    };
    this.renderer.renderPlaceableGhost(this.hoverPlaceable, ok, reason);
    if (ignorePlaceableId) {
      this.renderer.previewPlaceableUtilityDrag?.(ignorePlaceableId, this.hoverPlaceable);
    }
  }

  /**
   * Commit the unified placeable ghost at the hovered snap position.
   * Shared by _handleClick (legacy beamline family) and
   * PlaceableTool.onClick. Returns true when the click was consumed —
   * either by placing, or by opening the window of an existing node the
   * click landed on. Returns false when no ghost is armed.
   */
  _commitHoverPlaceable(screenX, screenY) {
    if (!this.hoverPlaceable) return false;
    const world = this.renderer.screenToWorld(screenX, screenY);
    const grid = isoToGrid(world.x, world.y);
    const placeable = PLACEABLES[this.hoverPlaceable.id];
    // A refused build click must explain the red ghost before any existing
    // object underneath gets selected. Previously this branch opened the
    // blocker and silently skipped the attempted placement, which read as a
    // broken click rather than an actionable collision.
    if (this.hoverPlaceable.valid === false) {
      this._showPlacementFailure(
        this._placementFailureMessage(placeable, this.hoverPlaceable),
      );
      return true;
    }
    // For beamline modules, check if the click landed on an existing node
    // (opens its beamline window instead of placing).
    const comp = COMPONENTS[this.hoverPlaceable.id];
    if (comp && comp.placement !== 'attachment') {
      const existingNode = this._getNodeAtScreenOrGrid(screenX, screenY, grid.col, grid.row);
      if (existingNode) {
        this.selectedNodeId = existingNode.id;
        this._selectPlaceable(existingNode, this._selectionRootAt(screenX, screenY));
        return true;
      }
    }
    let placedId = false;
    this.game._withUndo(() => {
      placedId = this.game.placePlaceable({
        type: this.hoverPlaceable.id,
        col: this.hoverPlaceable.col,
        row: this.hoverPlaceable.row,
        subCol: this.hoverPlaceable.subCol,
        subRow: this.hoverPlaceable.subRow,
        dir: this.hoverPlaceable.dir,
        portsFlipped: this.hoverPlaceable.portsFlipped === true,
        wallMount: this.hoverPlaceable.wallMount,
        params: this.selectedParamOverrides,
        variant: this.selectedPlaceableVariant,
        level: this.game.activeLevel,
      });
      // Auto-switch to beam pipe tool after placing a source.
      if (placedId && comp?.isSource) {
        const guided = this.game._guidedSetup?.onSourcePlaced?.(placedId);
        if (!guided) this.beginBeamPipeFromSource(placedId);
      }
    });
    if (placedId) this.renderer.dropPortablePlaceable?.(placedId);
    // Re-preview at the same cursor position: the tile the ghost sits on is
    // now occupied, so leaving the stale green ghost up made a second click
    // without moving report "Space occupied!" under a valid-looking preview.
    // (BeamlineInputController._commitPlacement and
    // _finishLinePlaceDecoration refresh the same way.)
    this._repaintArmedPreview();
    return true;
  }

  _placementFailureMessage(placeable, hover) {
    const name = placeable?.name || hover?.id || 'item';
    if (placeable?.mount === 'wall' && hover?.reason === PLACE_BLOCKED) {
      return `Can't place ${name}: that wall face is occupied.`;
    }
    if (hover?.reason === PLACE_WALL) {
      return placeable?.mount === 'wall'
        ? `Can't place ${name}: it needs a free wall face.`
        : `Can't place ${name}: its footprint crosses a wall.`;
    }
    if (hover?.reason === PLACE_MAP_EDGE) {
      const distance = placeable?.mapEdgeConnection?.maxDistanceTiles || 4;
      return `Can't place ${name}: it must be fully on the map and within ${distance} tiles of the map edge.`;
    }
    if (hover?.reason === PLACE_UNAFFORDABLE) {
      const cost = componentCostFor(placeable);
      const missing = this.game?._missingResourceLabel?.(cost);
      return `Can't afford ${name}${missing ? ` (${missing})` : ''}.`;
    }
    if (hover?.reason === PLACE_BLOCKED && placeable?.footprintCells) {
      const cells = placeable.footprintCells(
        hover.col, hover.row, hover.subCol || 0, hover.subRow || 0, hover.dir || 0,
      );
      const blockerNames = new Set();
      for (const cell of cells) {
        const key = subtileKey(
          cell.col, cell.row, cell.subCol, cell.subRow, this.game.activeLevel,
        );
        const occupant = this.game?.state?.subgridOccupied?.[key];
        const entry = occupant?.id ? this.game.getPlaceable?.(occupant.id) : null;
        const def = entry ? (PLACEABLES[entry.type] || COMPONENTS[entry.type]) : null;
        if (def?.name) blockerNames.add(def.name);
      }
      const blockers = [...blockerNames];
      if (blockers.length) {
        return `Can't place ${name}: blocked by ${blockers.slice(0, 2).join(' and ')}.`;
      }
    }
    return `Can't place ${name}: that space is occupied.`;
  }

  _showPlacementFailure(message) {
    if (!message) return;
    this.game?.log?.(message, 'bad');
    this._showToast?.(message);
  }

  /**
   * Build ghosts along the shift+drag line and render them as a batch.
   * Walks in fractional tile space so screen spacing stays uniform;
   * spacing = max(subW, subL) in subtiles (center-to-center footprint).
   * Each ghost passes canPlace and doesn't overlap an earlier ghost in
   * the same line to avoid committing into itself on mouseup.
   */
  _updateLinePlacePreview(wx, wy) {
    if (!this.linePlaceStartWorld) return;
    const armedId = this.armedPlaceableId;
    const pl = PLACEABLES[armedId];
    if (!pl) return;

    const start = isoToGridFloat(this.linePlaceStartWorld.x, this.linePlaceStartWorld.y);
    const end = isoToGridFloat(wx, wy);
    const dCol = end.col - start.col;
    const dRow = end.row - start.row;
    const distTile = Math.hypot(dCol, dRow);

    this._linePlaceLastWorld = { x: wx, y: wy };
    const defaultSpacingSub = Math.max(pl.subW || 1, pl.subL || 1);
    const spacingSub = this.linePlaceSpacingSub.has(armedId)
      ? this.linePlaceSpacingSub.get(armedId)
      : defaultSpacingSub;
    const spacingTile = spacingSub / 4;
    const steps = Math.max(0, Math.floor(distTile / spacingTile));
    const count = steps + 1;

    const hovers = [];
    const usedCells = new Set();
    // Affordability is cumulative along the line: _finishLinePlaceDecoration
    // commits every valid ghost in one gesture, so the Nth item is only
    // payable if the N-1 before it were. Ghosts past the budget preview as
    // unaffordable, which also keeps the commit from attempting them.
    const unitCost = pl.cost || null;
    const runningCost = {};
    for (let i = 0; i < count; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const fcCol = start.col + dCol * t;
      const fcRow = start.row + dRow * t;
      const wp = gridToIso(fcCol, fcRow);
      const snap = snapForPlaceable(wp.x, wp.y, pl, this.placementDir);
      const key = `${snap.col},${snap.row},${snap.subCol},${snap.subRow}`;
      if (usedCells.has(key)) continue;
      usedCells.add(key);

      const result = canPlace(
        this.game, pl,
        snap.col, snap.row, snap.subCol, snap.subRow,
        this.placementDir,
        { level: this.game.activeLevel },
      );

      let overlapsEarlier = false;
      if (result.ok && usesFloorOccupancy(pl)) {
        const myKeys = new Set(result.cells.map(c => `${c.col},${c.row},${c.subCol},${c.subRow}`));
        for (const earlier of hovers) {
          if (!earlier.valid) continue;
          const ep = PLACEABLES[earlier.hover.id];
          const eCells = ep.footprintCells(
            earlier.hover.col, earlier.hover.row,
            earlier.hover.subCol, earlier.hover.subRow,
            earlier.hover.dir,
          );
          if (eCells.some(c => myKeys.has(`${c.col},${c.row},${c.subCol},${c.subRow}`))) {
            overlapsEarlier = true;
            break;
          }
        }
      }

      const fits = result.ok && !overlapsEarlier;
      let affordable = true;
      if (fits && unitCost) {
        for (const [r, a] of Object.entries(unitCost)) runningCost[r] = (runningCost[r] || 0) + a;
        affordable = canAffordCost(this.game, runningCost);
        // Don't bank the unpayable item's cost — a cheaper resource mix later
        // in the line would otherwise be charged against it too.
        if (!affordable) {
          for (const [r, a] of Object.entries(unitCost)) runningCost[r] -= a;
        }
      }

      hovers.push({
        hover: {
          id: armedId,
          col: snap.col, row: snap.row,
          subCol: snap.subCol, subRow: snap.subRow,
          dir: this.placementDir,
          // _finishLinePlaceDecoration commits selectedPlaceableVariant, so
          // the ghosts have to carry it or the drag previews the wrong swatch.
          variant: this.selectedPlaceableVariant,
          level: this.game.activeLevel,
        },
        valid: fits && affordable,
        reason: fits ? (affordable ? null : PLACE_UNAFFORDABLE) : null,
      });
    }

    this.linePlaceHovers = hovers;
    this.renderer.renderPlaceableGhosts(hovers);
  }

  /**
   * Adjust the per-placeable line-placement spacing by delta sub-units
   * (Shift+Z/X while shift-dragging) and re-preview at the last cursor
   * position. Persists per-placeable for the session.
   */
  _adjustLinePlaceSpacing(delta) {
    const armedId = this.armedPlaceableId;
    const pl = PLACEABLES[armedId];
    if (!pl) return;
    const defaultSub = Math.max(pl.subW || 1, pl.subL || 1);
    const minSub = Math.max(1, Math.min(pl.subW || 1, pl.subL || 1));
    const cur = this.linePlaceSpacingSub.has(armedId)
      ? this.linePlaceSpacingSub.get(armedId)
      : defaultSub;
    const next = Math.max(minSub, Math.min(64, cur + delta));
    if (next !== cur) {
      this.linePlaceSpacingSub.set(armedId, next);
      this._showToast(`Spacing: ${next} sub${next === 1 ? '' : 's'}`);
      if (this._linePlaceLastWorld) {
        this._updateLinePlacePreview(
          this._linePlaceLastWorld.x,
          this._linePlaceLastWorld.y,
        );
      }
    }
  }

  /**
   * Commit the shift+drag decoration line: place every valid ghost (one
   * undo push and one event dispatch for the whole gesture), then reset
   * line-placement state. Without _batchEvents each placePlaceable's own
   * 'placeableChanged' costs a full decoration/equipment/component rebuild.
   */
  _finishLinePlaceDecoration() {
    const toPlace = this.linePlaceHovers.filter(h => h.valid);
    if (toPlace.length > 0) {
      this.game._withUndo(() => this.game._batchEvents(() => {
        for (const h of toPlace) {
          this.game.placePlaceable({
            type: h.hover.id,
            col: h.hover.col,
            row: h.hover.row,
            subCol: h.hover.subCol,
            subRow: h.hover.subRow,
            dir: h.hover.dir,
            params: this.selectedParamOverrides,
            variant: this.selectedPlaceableVariant,
            level: this.game.activeLevel,
          });
        }
      }));
    }
    this.isLinePlacingDecoration = false;
    this.linePlaceStartWorld = null;
    this.linePlaceHovers = [];
    // No _suppressNextClick here. Both callers (PlaceableTool.onMouseUp,
    // MoveTool.onMouseUp) return true, so the canvas mouseup listener bails
    // before _handleClick — the flag's only reader. Setting it left it armed
    // until the player's NEXT canvas left click, which was then silently
    // swallowed (one lost click after every shift-drag line place, and not
    // just a placement click: whatever that click would have done).
    this.renderer.clearDragPreview();
    this._updatePlaceablePreview();
  }

  _demolishEverythingAt(col, row, policy = createDemolishPolicy([
    'structure', 'beamline', 'infra', 'facility', 'grounds',
  ])) {
    const level = this.game.activeLevel;
    const key = tileKey(col, row, level);
    // Remove beamline components
    const node = this._getNodeAtGrid(col, row);
    if (node && policy.allowsPlaceable(node)) this.game.removePlaceable(node.id);
    // Remove unified placeables (equipment / furnishings / decorations /
    // infrastructure modules) occupying any subcell of this tile.
    const idsOnTile = new Set();
    for (let sr = 0; sr < 4; sr++) {
      for (let sc = 0; sc < 4; sc++) {
        const occ = this.game.state.subgridOccupied[subtileKey(col, row, sc, sr, level)];
        if (occ && occ.id) idsOnTile.add(occ.id);
      }
    }
    // Floating placeables are deliberately absent from subgridOccupied, but
    // the area bulldozer should still remove them when their anchor is here.
    for (const entry of this.game.state.placeables) {
      const def = PLACEABLES[entry.type];
      if (usesFloorOccupancy(def)) continue;
      if (sameLevel(entry, level)
          && (entry.cells || []).some(c => c.col === col && c.row === row)) {
        idsOnTile.add(entry.id);
      }
    }
    for (const id of idsOnTile) {
      const entry = this.game.getPlaceable(id);
      if (entry && policy.allowsPlaceable(entry)) this.game.removePlaceable(id);
    }
    // Phase 6: rack segments removed from state; nothing to demolish here.
    // Remove furnishings
    const subgrid = this.game.state.zoneFurnishingSubgrids[key];
    if (subgrid && policy.allowsCategory('facility')) {
      for (let sr = 0; sr < 4; sr++) {
        for (let sc = 0; sc < 4; sc++) {
          const furnIdx = subgrid[sr][sc];
          if (furnIdx > 0) {
            const entry = this.game.state.zoneFurnishings[furnIdx - 1];
            if (entry) this.game.removeZoneFurnishing(entry.id);
          }
        }
      }
    }
    // Remove zones
    if (policy.allowsCategory('facility') && this.game.state.zoneOccupied[key]) {
      this.game.removeZoneTile(col, row, level);
    }
    // Remove walls and doors on every edge of this tile (segments may be
    // stored under either alias of any of the four edge keys)
    if (policy.allowsCategory('structure') || policy.allowsCategory('grounds')) {
      for (const edge of ['n', 's', 'e', 'w']) {
        const hit = this._findWallOrDoorAtEdge({ col, row, edge });
        if (hit && policy.allowsEdge(hit)) this._removeWallAndDoorAtEdge({ col, row, edge });
      }
    }
    // Remove floor last
    const floorType = this.game.state.infraOccupied[key];
    if (floorType && policy.allowsFloor(floorType)) this.game.removeInfraTile(col, row, level);
  }

  // --- Move mode (MoveTool) ---

  _loadSelectionSlots() {
    try {
      const raw = localStorage.getItem(SELECTION_SLOT_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  _persistSelectionSlots() {
    try {
      localStorage.setItem(SELECTION_SLOT_STORAGE_KEY, JSON.stringify(this._selectionSlots || {}));
    } catch (_) { /* storage is optional in headless/private sessions */ }
  }

  _cloneSelectionPayload(payload) {
    return payload == null ? payload : JSON.parse(JSON.stringify(payload));
  }

  _captureSelectedCopy(anchorId = this.selectedPlaceableId, ids = null) {
    return captureSelectionGroup(this.game, ids || this._selectionIdsForAnchor(anchorId), {
      operation: 'copy',
      primaryId: anchorId,
    });
  }

  _saveSelectionSlot(slot, anchorId = this.selectedPlaceableId, ids = null) {
    const captured = this._captureSelectedCopy(anchorId, ids);
    if (!captured.ok) {
      this._showToast(captured.reason);
      return false;
    }
    captured.payload.operation = 'copy';
    this._selectionSlots[slot] = this._cloneSelectionPayload(captured.payload);
    this._persistSelectionSlots();
    const count = selectionPayloadCount(captured.payload);
    this._showToast(`Saved ${count} item${count === 1 ? '' : 's'} to slot ${slot}`);
    return true;
  }

  _copySelectionToClipboard(anchorId = this.selectedPlaceableId, ids = null) {
    const captured = this._captureSelectedCopy(anchorId, ids);
    if (!captured.ok) {
      this._showToast(captured.reason);
      return false;
    }
    captured.payload.operation = 'copy';
    this._selectionClipboard = this._cloneSelectionPayload(captured.payload);
    const count = selectionPayloadCount(captured.payload);
    this._showToast(`Copied ${count} item${count === 1 ? '' : 's'}`);
    return true;
  }

  _armSelectionPayload(payload, message) {
    if (selectionPayloadCount(payload) === 0) return false;
    const tool = new MoveTool();
    this.setTool(tool);
    tool.payload = this._cloneSelectionPayload(payload);
    this.placementDir = tool.payload.anchor?.dir || 0;
    this.renderer.updatePlacementDir?.(this.placementDir);
    this.renderer.canvas.style.cursor = 'grabbing';
    this._updateSelectionGroupPreview(tool.payload);
    this._updateShiftHint();
    this._updatePlacementKeyHint();
    if (message) this._showToast(message);
    return true;
  }

  _recallSelectionSlot(slot) {
    const payload = this._selectionSlots?.[slot];
    if (!payload) {
      this._showToast(`Selection slot ${slot} is empty`);
      return false;
    }
    const count = selectionPayloadCount(payload);
    return this._armSelectionPayload(
      { ...this._cloneSelectionPayload(payload), operation: 'copy' },
      `Slot ${slot}: placing ${count} item${count === 1 ? '' : 's'}`,
    );
  }

  _pasteSelectionClipboard() {
    if (!this._selectionClipboard) {
      this._showToast('Selection clipboard is empty');
      return false;
    }
    const count = selectionPayloadCount(this._selectionClipboard);
    return this._armSelectionPayload(
      { ...this._cloneSelectionPayload(this._selectionClipboard), operation: 'copy' },
      `Pasting ${count} item${count === 1 ? '' : 's'}`,
    );
  }

  _toggleMoveMode() {
    // setTool handles the exclusivity sweep; MoveTool.onExit restores a
    // still-carried item to its origin.
    if (this.activeTool?.kind === 'move') {
      this.clearTool();
    } else {
      this.setTool(new MoveTool());
    }
  }

  _toggleSelectionActionMode(action) {
    if (this.activeTool?.kind === 'selectionAction'
        && this.activeTool.action === action) {
      this.clearTool();
      return false;
    }
    this.setTool(new SelectionActionTool(action));
    return true;
  }

  _selectionIdsForAnchor(anchorId = this.selectedPlaceableId) {
    if (anchorId && this.selectedPlaceableIds?.has?.(anchorId)) {
      return [...this.selectedPlaceableIds];
    }
    return anchorId ? [anchorId] : [];
  }

  /** Arm a translated group for a move (Place) or a paid copy. */
  _beginSelectionPlacement(operation, anchorId = this.selectedPlaceableId, selectedIds = null) {
    const ids = selectedIds || this._selectionIdsForAnchor(anchorId);
    const captured = captureSelectionGroup(this.game, ids, {
      operation,
      primaryId: anchorId,
    });
    if (!captured.ok) {
      this._showToast(captured.reason);
      return false;
    }

    // Group moves can leave both the primary selection panel and older
    // per-item panels over the destination. Close every selected object's
    // anchored window before setTool clears the selection that identifies
    // them. Copies keep the inspection window open because nothing is being
    // carried away from its current location.
    if (operation === 'move') {
      for (const id of ids) {
        const entry = selectionTargetByKey(this.game.state, id)?.entry;
        if (entry) this.renderer.closePlaceableInfoWindow?.(entry);
      }
    }

    const count = selectionPayloadCount(captured.payload);
    return this._armSelectionPayload(
      captured.payload,
      `${operation === 'copy' ? 'Copying' : 'Placing'} ${count} item${count === 1 ? '' : 's'}`,
    );
  }

  _beginSelectedCopy(anchorId = this.selectedPlaceableId) {
    return this._beginSelectionPlacement('copy', anchorId);
  }

  /** Mirror beamline ports in place, or spatially mirror movable selections. */
  _beginSelectedMirror(anchorId = this.selectedPlaceableId) {
    const resolvedAnchor = anchorId || [...(this.selectedPlaceableIds || [])].at(-1) || null;
    const ids = typeof this._selectionIdsForAnchor === 'function'
      ? this._selectionIdsForAnchor(resolvedAnchor)
      : InputHandler.prototype._selectionIdsForAnchor.call(this, resolvedAnchor);
    const portResult = mirrorSelectionPorts(this.game, ids);
    if (portResult.ok) {
      this.renderer._portMarkersDirty = true;
      this.renderer.refreshContextWindows?.();
      const suffix = portResult.dangled
        ? ` — ${portResult.dangled} utility ${portResult.dangled === 1 ? 'line needs' : 'lines need'} rewiring`
        : '';
      this._showToast(
        `Mirrored ports on ${portResult.mirrored} beamline component${portResult.mirrored === 1 ? '' : 's'}${suffix}`,
      );
      return true;
    }

    const selection = typeof this._selectionIdsForPanelAction === 'function'
      ? this._selectionIdsForPanelAction('move')
      : InputHandler.prototype._selectionIdsForPanelAction.call(this, 'move');
    if (!selection.ids.length) {
      this._showToast('Nothing selected can be mirrored');
      return false;
    }
    return this._beginSelectionTransform('mirror', selection.anchorId, selection.ids);
  }

  _transformActiveSelectionGroup(kind) {
    const tool = this.activeTool;
    if (tool?.kind !== 'move' || tool.payload?.kind !== 'selectionGroup') return false;
    tool.payload = transformSelectionGroup(tool.payload, kind === 'mirror'
      ? { mirror: true }
      : { quarterTurns: 1 });
    this.placementDir = tool.payload.anchor?.dir || 0;
    this.renderer.updatePlacementDir?.(this.placementDir);
    this._updateSelectionGroupPreview(tool.payload);
    this._updatePlacementKeyHint();
    this._showToast(kind === 'mirror' ? 'Selection mirrored' : 'Selection rotated');
    return true;
  }

  _beginSelectionTransform(kind, anchorId = this.selectedPlaceableId, ids = null) {
    if (!this._beginSelectionPlacement('move', anchorId, ids)) return false;
    return this._transformActiveSelectionGroup(kind);
  }

  _beginSelectedMove(anchorId = this.selectedPlaceableId) {
    // Keep this callable by the lightweight input facades used by the tool
    // regression tests as well as by a fully constructed InputHandler.
    const ids = typeof this._selectionIdsForAnchor === 'function'
      ? this._selectionIdsForAnchor(anchorId)
      : InputHandler.prototype._selectionIdsForAnchor.call(this, anchorId);
    if (ids.length > 1) return this._beginSelectionPlacement('move', anchorId);
    const entry = anchorId && this.game.getPlaceable(anchorId);
    if (!entry) return false;
    // A context window is useful while inspecting, but obscures the destination
    // while carrying. Close exactly the selected item's window before setTool
    // clears the selection ids needed to identify it.
    this.renderer.closePlaceableInfoWindow?.(entry);
    const tool = new MoveTool();
    this.setTool(tool);
    tool.payload = {
      kind: 'selectedPlaceable',
      placeableId: entry.id,
      type: entry.type,
      dir: entry.dir || 0,
      portsFlipped: entry.portsFlipped === true,
    };
    this._armMovePreview(entry.type, entry.dir || 0, entry.portsFlipped);
    this.renderer.canvas.style.cursor = 'grabbing';
    this._showToast(`Moving ${PLACEABLES[entry.type]?.name || COMPONENTS[entry.type]?.name || entry.type}`);
    return true;
  }

  _updateSelectionGroupPreview(payload) {
    if (selectionPayloadCount(payload) === 0) {
      this.selectionGroupPreview = null;
      return;
    }
    const hasStructure = (payload.floors?.length || 0) + (payload.edges?.length || 0) > 0;
    const primary = payload.items.find(item => item.id === payload.primaryId)
      || payload.items[0]
      || payload.anchor;
    let snap;
    if (hasStructure) {
      const cursor = isoToGridFloat(this.lastMouseWorldX ?? 0, this.lastMouseWorldY ?? 0);
      snap = {
        col: Math.round(cursor.col - (payload.anchor.subCol || 0) / 4),
        row: Math.round(cursor.row - (payload.anchor.subRow || 0) / 4),
        subCol: payload.anchor.subCol || 0,
        subRow: payload.anchor.subRow || 0,
      };
    } else {
      const def = PLACEABLES[primary?.type];
      if (!def) {
        this.selectionGroupPreview = null;
        return;
      }
      snap = snapForPlaceable(
        this.lastMouseWorldX ?? 0,
        this.lastMouseWorldY ?? 0,
        def,
        primary.dir,
      );
    }
    const preview = previewSelectionGroup(this.game, payload, {
      ...snap,
      dir: primary?.dir || 0,
    });
    this.selectionGroupPreview = preview;
    const renderReason = typeof preview.reason === 'string' && preview.reason.startsWith('utility:')
      ? 'blocked'
      : preview.reason;
    const ghosts = preview.targets.map(target => ({
      hover: {
        id: target.type,
        col: target.col,
        row: target.row,
        subCol: target.subCol,
        subRow: target.subRow,
        dir: target.dir,
        variant: target.variant,
      },
      valid: preview.ok,
      reason: renderReason,
    }));
    if (this.renderer.renderSelectionGroupGhosts) {
      this.renderer.renderSelectionGroupGhosts(preview, ghosts);
    } else this.renderer.renderPlaceableGhosts(ghosts);
  }

  _selectionPlacementFailure(reason) {
    if (reason === 'unaffordable') return 'Cannot afford this copy';
    if (reason === 'alignment') return 'Structures must stay aligned to whole tiles';
    if (typeof reason === 'string' && reason.startsWith('utility:')) {
      return 'Utility connections would overlap here';
    }
    if (reason === 'wall') return 'Selection intersects a wall';
    if (reason === PLACE_MAP_EDGE) {
      return 'Utility service points must remain within four tiles of the map edge';
    }
    return 'Selection does not fit here';
  }

  /** Commit the currently previewed group, preserving internal utility links. */
  _placeSelectionGroup(payload) {
    // Revalidate at click time: the simulation and other tools may have
    // changed occupancy or funding since the last mousemove.
    this._updateSelectionGroupPreview(payload);
    const preview = this.selectionGroupPreview;
    if (!preview?.ok) {
      this._showToast(this._selectionPlacementFailure(preview?.reason));
      return false;
    }
    return payload.operation === 'copy'
      ? this._copySelectionGroup(payload, preview)
      : this._moveSelectionGroup(payload, preview);
  }

  _copySelectionGroup(payload, preview) {
    const result = copySelectionGroup(this.game, payload, preview);
    if (!result.ok) return false;
    const count = selectionPayloadCount(payload);
    this._showToast(`Copied ${count} item${count === 1 ? '' : 's'}`);
    return true;
  }

  _moveSelectionGroup(payload, preview) {
    const result = moveSelectionGroup(this.game, payload, preview);
    if (!result.ok) return false;
    this._showToast(result.dangled
      ? `Placed — ${result.dangled} external utility ${result.dangled === 1 ? 'line needs' : 'lines need'} rewiring`
      : `Placed ${payload.items.length} items`);
    return true;
  }

  _demolishSelected(anchorId = this.selectedPlaceableId) {
    const ids = demolishSelection(this.game, this._selectionIdsForAnchor(anchorId));
    if (!ids.length) return [];
    this._clearSelection();
    return ids;
  }

  /** Trigger the reversible renderer incident for the primary selection. */
  _explodeSelectedFromKeyboard(anchorId = this.selectedPlaceableId) {
    const target = anchorId ? this._selectionTarget(anchorId) : null;
    if (!target || target.targetKind !== 'placeable') {
      this._showToast('Select a placeable to blow up');
      return false;
    }
    if (!this.renderer.explodeSelectionTarget?.(target)) {
      this._showToast('That selection has no explosion target');
      return false;
    }
    this._showToast(`Boom: ${target.name}`);
    return true;
  }

  /**
   * Handle Delete when one or more world items are selected.
   * Returns false only when there is no selection, allowing the key to keep
   * its legacy "toggle demolish tool" behavior in that case.
   *
   * Beamline nodes are protected as a group. The selected source/module opens
   * a window for the entire beamline, so treating Delete as a single-item
   * action there is both ambiguous and dangerously destructive.
   */
  _deleteSelectedFromKeyboard() {
    const ids = this._selectionIdsForAnchor(this.selectedPlaceableId)
      .filter(id => selectionTargetByKey(this.game.state, id));
    if (!ids.length) return false;

    const targets = ids.map(id => selectionTargetByKey(this.game.state, id)).filter(Boolean);
    const includesBeamline = targets.some(target => target.selectionCategory === 'beamline');
    if (includesBeamline) {
      this._showToast('Beamline deletion is disabled');
      return true;
    }

    for (const target of targets) {
      if (target.entry) this.renderer.closePlaceableInfoWindow?.(target.entry);
    }
    this._demolishSelected(this.selectedPlaceableId);
    return true;
  }

  // Refreshes the unified placeable preview for a just-picked-up carried
  // item (the carried type arms the preview via MoveTool.armedPlaceableId).
  _armMovePreview(_type, dir, portsFlipped = false) {
    this.placementDir = dir || 0;
    this.placementPortsFlipped = portsFlipped === true;
    this.renderer.updatePlacementDir?.(this.placementDir);
    this.hoverPlaceable = null;
    this.renderer._clearPreview?.();
    this._updatePlaceablePreview();
  }

  _pickUpAt(col, row, screenX, screenY) {
    // Resolve the visible mesh first. With a real renderer, a ray miss is an
    // intentional ground click and must stay a miss even when that ground is
    // inside a large component's tile/subtile footprint.
    let hitEntry = null;
    if (typeof this.renderer.raycastScreen === 'function') {
      const hit = this.renderer.raycastScreen(screenX, screenY, OBJECT_PICK_TOLERANCE_PX);
      const info = hit ? this.renderer.identifyHit?.(hit) : null;
      if (info?.nodeId != null) hitEntry = this.game.getPlaceable(info.nodeId);
      if (!hitEntry) return null;
    } else {
      // Compatibility for non-rendering harnesses: use the old footprint
      // lookup only when no projected picking API exists at all.
      hitEntry = this._getNodeAtGrid(col, row);
      for (let sr = 0; sr < 4 && !hitEntry; sr++) {
        for (let sc = 0; sc < 4 && !hitEntry; sc++) {
          const k = subtileKey(col, row, sc, sr, this.game.activeLevel);
          const occ = this.game.state.subgridOccupied[k];
          if (occ) hitEntry = this.game.getPlaceable(occ.id);
        }
      }
    }

    const component = COMPONENTS[hitEntry.type];
    const isBeamline = hitEntry.kind === 'beamline'
      || hitEntry.category === 'beamline'
      || component?.category === 'beamline';
    if (isBeamline) {
      this._showToast(`Moving ${component ? component.name : hitEntry.type}`);
      return {
        kind: 'component',
        nodeId: hitEntry.id,
        type: hitEntry.type,
        dir: hitEntry.dir || 0,
        originCol: hitEntry.col,
        originRow: hitEntry.row,
        portsFlipped: hitEntry.portsFlipped === true,
        level: levelOf(hitEntry),
      };
    }

    if (hitEntry) {
      // Ordinary equipment now follows the same stable-ID move path as a
      // selected object. Lifting used to remove it from state and dangle all
      // utility endpoints before the cursor moved a pixel, which made a live
      // attached-hose preview impossible and minted a replacement ID on drop.
      const def = PLACEABLES[hitEntry.type];
      this._showToast(`Moving ${def?.name || hitEntry.type}`);
      return {
        kind: 'selectedPlaceable',
        placeableId: hitEntry.id,
        type: hitEntry.type,
        variant: hitEntry.variant ?? 0,
        dir: hitEntry.dir || 0,
        portsFlipped: hitEntry.portsFlipped === true,
        level: levelOf(hitEntry),
      };
    }

    return null;
  }

  _updateMoveHover(grid, screenX, screenY) {
    // Only highlight what a click would actually lift, so this resolves the
    // hit the same way _pickUpAt does: registry node first (beamline
    // components), then the unified subgrid probe at the hit mesh's world
    // position. The old equipment branch keyed off the tile-granular legacy
    // mirrors (facilityGrid / zoneFurnishingSubgrids), so only one of several
    // sub-tile items on a tile ever resolved and decorations never did.
    const hit = this.renderer.raycastScreen(screenX, screenY);
    const info = hit ? this.renderer.identifyHit(hit) : null;
    if (info?.rootObj
        && (info.group === 'component' || info.group === 'equipment' || info.group === 'decoration')) {
      if (info.group === 'component') {
        const node = info.nodeId
          ? this.game.state.placeables.find(p => p.id === info.nodeId)
          : this._getNodeAtGrid(grid.col, grid.row);
        if (node) {
          const comp = COMPONENTS[node.type];
          this.renderer._clearPreview();
          this.renderer._outlineObject(info.rootObj, comp ? _categoryColor(comp.category) : 0x88aaff);
          return;
        }
        // No registry node — an infrastructure module; fall through to the
        // unified probe below.
      }
      const p = info.rootObj.position;
      const entry = (info.nodeId && this.game.getPlaceable(info.nodeId))
        || this._placeableAtWorldPos(p.x, p.z);
      if (entry && entry.kind !== 'beamline') {
        const comp = COMPONENTS[entry.type];
        this.renderer._clearPreview();
        this.renderer._outlineObject(info.rootObj, comp ? _categoryColor(comp.category) : 0x88ccff);
        return;
      }
    }
    this.renderer._clearPreview();
  }

  /** Drop MoveTool's carried payload `p` at the clicked tile. */
  _placeMovedObject(p, col, row) {
    if (!p) return false;

    if (p.kind === 'component') {
      const placeable = this.game.getPlaceable(p.nodeId);
      if (!placeable) return false;
      const hp = this.hoverPlaceable;
      if (!hp || hp.valid === false) return false;
      return this.game._withUndo(() => {
        const moved = this.game.movePlaceable(p.nodeId, {
          col: hp.col,
          row: hp.row,
          subCol: hp.subCol,
          subRow: hp.subRow,
          dir: hp.dir ?? this.placementDir ?? placeable.dir ?? 0,
          portsFlipped: hp.portsFlipped === true,
          level: this.game.activeLevel,
        });
        if (!moved) return false;
        this.game._deriveBeamGraph();
        this.game.recalcAllBeamlines();
        this.game.reanchorUtilityLinesForPlaceable(p.nodeId);
        this.game.emit('placeableChanged', placeableMutationEvent(
          placeable, 'moved', { terrainChanged: true },
        ));
        return true;
      });
    }

    if (p.kind === 'placeable') {
      // Drive target snap from the unified preview. `hoverPlaceable` is
      // kept in sync by `_updatePlaceablePreview` on every mousemove and
      // on rotation, so it already reflects the current cursor + dir.
      const hp = this.hoverPlaceable;
      if (!hp) return false;
      const placedId = this.game.placePlaceable({
        type: p.type,
        col: hp.col,
        row: hp.row,
        subCol: hp.subCol,
        subRow: hp.subRow,
        dir: hp.dir ?? this.placementDir ?? 0,
        portsFlipped: hp.portsFlipped === true,
        wallMount: hp.wallMount,
        params: p.params,
        variant: p.variant,
        free: true,
        silent: true,
        level: this.game.activeLevel,
      });
      if (placedId) this.renderer.dropPortablePlaceable?.(placedId);
      return placedId !== false;
    }

    if (p.kind === 'selectedPlaceable') {
      const hp = this.hoverPlaceable;
      if (!hp) return false;
      const entry = this.game.getPlaceable(p.placeableId);
      if (!entry) return false;
      return this.game._withUndo(() => {
        const moved = this.game.movePlaceable(p.placeableId, {
          col: hp.col, row: hp.row, subCol: hp.subCol, subRow: hp.subRow,
          dir: hp.dir ?? this.placementDir ?? entry.dir ?? 0,
          portsFlipped: hp.portsFlipped === true,
          wallMount: hp.wallMount,
          level: this.game.activeLevel,
        });
        if (!moved) return false;
        if (entry.category === 'beamline') {
          this.game._deriveBeamGraph();
          this.game.recalcAllBeamlines();
          this.game.emit('beamlineChanged');
        }
        const dangled = this.game.reanchorUtilityLinesForPlaceable(p.placeableId);
        this.game.computeSystemStats();
        const mutationEvent = placeableMutationEvent(
          entry, 'moved', { terrainChanged: true },
        );
        this.game.emit('placeableChanged', mutationEvent);
        if (entry.category === 'equipment') this.game.emit('facilityChanged', mutationEvent);
        if (entry.category === 'furnishing') this.game.emit('zonesChanged', mutationEvent);
        this.renderer.dropPortablePlaceable?.(p.placeableId);
        this._showToast(dangled
          ? `Moved — ${dangled} utility ${dangled === 1 ? 'line needs' : 'lines need'} rewiring`
          : 'Moved — connected utilities updated');
        return true;
      });
    }

    return false;
  }

  /**
   * Refresh the bottom-left shift-hint chip based on the active tool.
   * Shows contextual hints for the armed tool: rotate/cancel while a
   * rotatable placeable is selected, shift-modified actions (line place,
   * smart floor wall paths, demolish whole run), and floor orientation.
   * Hidden when no hint applies to the current selection.
   */
  _updateShiftHint() {
    const el = document.getElementById('shift-hint');
    if (!el) return;

    const sep = `<span class="sep">•</span>`;
    const tool = this.activeTool;
    let html = '';
    if (tool?.kind === 'demolish'
        && (tool.policy?.allowsCategory('structure') || tool.policy?.allowsCategory('grounds'))) {
      html = `<span class="k">SHIFT</span>+click: delete whole run`;
    } else if (tool?.kind === 'move' && tool.payload?.kind === 'selectionGroup') {
      html = (tool.payload.operation === 'copy' ? 'Click: paste selection' : 'Click: place selection')
        + sep + `<span class="k">F</span> Rotate`
        + sep + `<span class="k">M</span> Mirror`
        + sep + `<span class="k">ESC</span> Cancel`;
    } else if (tool?.kind === 'wall') {
      html = `<span class="k">SHIFT</span>: smart floor outline`
        + sep + `<span class="k">SHIFT</span>+drag: free wall run`;
    } else if (this.armedPlaceableId) {
      const comp = COMPONENTS[this.armedPlaceableId];
      const rotatable = !(comp && (comp.role === 'junction'
        || comp.role === 'placement' || comp.isDrawnConnection));
      const hasUtilityPorts = Object.values(comp?.ports || {}).some(port => port?.utility);
      if (rotatable || hasUtilityPorts) {
        const bits = [];
        if (rotatable) bits.push(`<span class="k">F</span> Rotate`);
        if (hasUtilityPorts) bits.push(`<span class="k">M</span> Mirror ports`);
        const pl = PLACEABLES[this.armedPlaceableId];
        if (pl && pl.kind === 'decoration') {
          bits.push(`<span class="k">SHIFT</span>+drag: line place`);
          bits.push(`<span class="k">Z</span>/<span class="k">X</span>: spacing`);
        }
        bits.push(`<span class="k">ESC</span> Cancel`);
        html = bits.join(sep);
      }
    } else if (tool?.kind === 'floor') {
      const infraDef = FLOORS[tool.floorType];
      if (infraDef?.orientable) {
        html = `<span class="k">F</span> Rotate`
          + sep + `<span class="k">ESC</span> Cancel`;
      }
    }

    if (html) {
      el.innerHTML = html;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  _showToast(msg) {
    let el = document.getElementById('key-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'key-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 1200);
  }

  _toggleContextDemolish() {
    // If already in demolish mode, toggle it off
    if (this.activeTool?.kind === 'demolish') {
      this.clearTool();
      this._hidePreview();
      return;
    }
    // Activate the same filtered cursor in-place without changing mode/menu.
    this.setTool(new DemolishTool('demolishFiltered', this.demolishFilters));
    this._renderPreview('Demolish', 'Uses the active Demolish-category filters', []);
  }

  /**
   * Assign the active mode on both this handler and the renderer, and emit
   * 'activeModeChanged'. main.js's sole subscriber mounts/destroys the
   * UtilityStatsPanel off that event, so any path that assigns the two
   * fields directly leaves the panel stranded in the wrong mode (or missing
   * in Infra). Callers still own palette/tab/tool bookkeeping.
   */
  _applyActiveMode(mode) {
    const prev = this.activeMode;
    this.activeMode = mode;
    this.renderer.activeMode = mode;
    if (prev !== mode && this.game && typeof this.game.emit === 'function') {
      this.game.emit('activeModeChanged', { prev, mode });
    }
  }

  _restorePreviousMode() {
    this.clearTool();
    const mode = this._prevMode || 'beamline';
    const category = this._prevCategory || Object.keys(MODES[mode]?.categories || {})[0] || '';
    this._applyActiveMode(mode);
    this.selectedCategory = category;
    // Update mode button UI
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    this.renderer._generateCategoryTabs();
    this.renderer.updatePalette(category, { freshTab: mode === 'infra' });
    // Activate the right tab
    document.querySelectorAll('.cat-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.category === category);
    });
    this.paletteIndex = -1;
    this._hidePreview();
    this._prevMode = null;
    this._prevCategory = null;
  }

  /**
   * Given a utility line id, find its network and open a UtilityInspector.
   * Returns true if a window was opened (or an existing one focused).
   */
  openUtilityInspectorForLine(lineId) {
    return openUtilityInspectorForLine(this.game, lineId);
  }

  setActiveMode(mode) {
    const prev = this.activeMode;
    // Record where the player came from so Esc out of demolish returns them
    // there. This used to live in _switchToDemolishMode(), which lost its last
    // caller before the branch — leaving _prevMode permanently undefined, so
    // Esc dumped everyone into the Beamline palette regardless of origin.
    // Must be read before selectedCategory is reset below.
    if (mode === 'demolish' && prev !== 'demolish') {
      this._prevMode = prev;
      this._prevCategory = this.selectedCategory;
    }
    this.activeMode = mode;
    // Every family disarms via clearTool. (The old per-family deselect web
    // missed the utility-line tool here — that exclusivity bug died with
    // the tool conversion.)
    this.clearTool();
    this.paletteIndex = -1;
    this._hidePreview();
    // Reset selected category to first in new mode
    const modeData = MODES[mode];
    if (modeData && !modeData.disabled) {
      const catKeys = Object.keys(modeData.categories);
      this.selectedCategory = catKeys[0] || '';
    }
    this.renderer.activeMode = mode;
    // Entering demolish mode arms the filtered cursor immediately so the
    // first click already demolishes. Checkboxes modify this live tool.
    if (mode === 'demolish') {
      this.setTool(new DemolishTool('demolishFiltered', this.demolishFilters));
    }
    // Emit so UI layers (stats panels, overlays) can react to mode transitions.
    if (prev !== mode && this.game && typeof this.game.emit === 'function') {
      this.game.emit('activeModeChanged', { prev, mode });
    }
  }

  // --- Palette click sync ---

  _syncPaletteClick(idx) {
    this.paletteIndex = idx;
    // Update kb-focus visual
    const items = document.querySelectorAll('#component-palette .palette-item');
    items.forEach(el => el.classList.remove('kb-focus'));
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add('kb-focus');
    }
    this._showPreviewForFocusedItem();
  }

  // --- Palette keyboard navigation ---

  _handlePaletteNav(key) {
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      this._handleVerticalNav(key === 'ArrowUp' ? -1 : 1);
      return;
    }

    const items = document.querySelectorAll('#component-palette .palette-item');
    if (items.length === 0) return;

    if (key === 'ArrowRight') {
      this.paletteIndex = Math.min(this.paletteIndex + 1, items.length - 1);
    } else if (key === 'ArrowLeft') {
      this.paletteIndex = Math.max(this.paletteIndex - 1, 0);
    }

    this._applyPaletteFocus(items);
  }

  _handleVerticalNav(dir) {
    // Build a flat list: all modes and their category tabs
    const modeKeys = Object.keys(MODES).filter(k => !MODES[k].disabled);
    const allEntries = []; // { mode, category }
    for (const mk of modeKeys) {
      const catKeys = Object.keys(MODES[mk].categories);
      for (const ck of catKeys) {
        allEntries.push({ mode: mk, category: ck });
      }
    }
    if (allEntries.length === 0) return;

    // Find current position
    let curIdx = allEntries.findIndex(
      e => e.mode === this.activeMode && e.category === this.selectedCategory
    );
    if (curIdx < 0) curIdx = 0;

    const nextIdx = (curIdx + dir + allEntries.length) % allEntries.length;
    const next = allEntries[nextIdx];

    // Switch mode if needed
    if (next.mode !== this.activeMode) {
      this.clearTool();
      this._applyActiveMode(next.mode);
      // Update mode buttons
      document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === next.mode);
      });
      this.renderer._generateCategoryTabs();
    }

    // Switch category tab
    this.selectedCategory = next.category;
    const tabs = document.querySelectorAll('.cat-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.category === next.category));
    this.renderer.updatePalette(next.category, { freshTab: next.mode === 'infra' });

    // Keep palette index position, clamped to new tab's item count
    const newItems = document.querySelectorAll('#component-palette .palette-item');
    if (this.paletteIndex < 0) this.paletteIndex = 0;
    if (newItems.length > 0 && this.paletteIndex >= newItems.length) {
      this.paletteIndex = newItems.length - 1;
    }
    this._applyPaletteFocus(newItems);
  }

  _applyPaletteFocus(items) {
    if (!items || items.length === 0) return;
    if (this.paletteIndex < 0) this.paletteIndex = 0;
    if (this.paletteIndex >= items.length) this.paletteIndex = items.length - 1;

    // Update visual focus
    items.forEach(el => el.classList.remove('kb-focus'));
    const focused = items[this.paletteIndex];
    focused.classList.add('kb-focus');

    // Scroll into view
    focused.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });

    // Arm the focused item's tool. Each palette item carries its own
    // {paletteKind, paletteKey} identity (stamped at render time in
    // hud.js), so keyboard nav uses the exact same construction path as a
    // mouse click — no category guessing.
    const kind = focused.dataset.paletteKind;
    const key = focused.dataset.paletteKey;
    if (kind && key) this.selectPaletteTool(kind, key, this._recallPaletteVariant(kind, key));

    // Show preview panel
    this._showPreviewForFocusedItem();
  }

  /**
   * Variant a palette item must arm with. Keyboard nav re-arms through the
   * same path as a mouse click, so it has to resolve the same variant the
   * click would — passing the 0 default silently reset the player's chosen
   * swatch every time focus moved. Re-focusing the already-armed item keeps
   * that tool's variant; anything else falls back to hud.js's per-key variant
   * memory (VARIANT_MEMORY_KEY), which is what a palette click reads.
   */
  _recallPaletteVariant(kind, key) {
    const t = this.activeTool;
    if (t?.id === `${kind}:${key}` && typeof t.variant === 'number') return t.variant;
    try {
      const raw = globalThis.localStorage?.getItem(VARIANT_MEMORY_KEY);
      const vi = raw ? JSON.parse(raw)[key] : null;
      return typeof vi === 'number' ? vi : 0;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Render the preview panel for the keyboard-focused palette item, keyed
   * by the item's own {paletteKind, paletteKey} dataset (stamped at render
   * time in hud.js). Replaces the old category-guessing chain — palette
   * identity lives on the item, so DOM section order no longer matters.
   */
  _showPreviewForFocusedItem() {
    const items = document.querySelectorAll('#component-palette .palette-item');
    const focused = (this.paletteIndex >= 0 && this.paletteIndex < items.length)
      ? items[this.paletteIndex]
      : null;
    const kind = focused?.dataset.paletteKind;
    const key = focused?.dataset.paletteKey;
    if (!kind || !key) {
      this._hidePreview();
      return;
    }

    switch (kind) {
      case 'wall': {
        const wt = WALL_TYPES[key];
        if (!wt) { this._hidePreview(); return; }
        // Variant-aware, because placeWall charges variantCosts[variant].
        // _recallPaletteVariant returns the armed tool's variant, else the
        // one the palette flyout remembers — the variant this card describes.
        this._renderPreview(wt.name, wt.desc || '', [
          ['Cost', `$${variantCost(wt, this._recallPaletteVariant('wall', key))}/segment`],
          ['Placement', 'Drag along edges'],
        ]);
        return;
      }
      case 'door': {
        const dt = DOOR_TYPES[key];
        if (!dt) { this._hidePreview(); return; }
        this._renderPreview(dt.name, dt.desc || '', [
          ['Cost', `$${typeof dt.cost === 'object' ? dt.cost.funding : dt.cost}/segment`],
          ['Placement', 'Drag along edges'],
        ]);
        return;
      }
      case 'window': {
        const wt = WINDOW_TYPES[key];
        if (!wt) { this._hidePreview(); return; }
        // Variant-aware — placeWindow charges variantCosts[variant]. See 'wall'.
        this._renderPreview(wt.name, wt.desc || '', [
          ['Cost', `$${variantCost(wt, this._recallPaletteVariant('window', key))}/segment`],
          ['Placement', 'Drag along a wall edge'],
        ]);
        return;
      }
      case 'floor': {
        const infra = FLOORS[key];
        if (!infra) { this._hidePreview(); return; }
        this._renderPreview(infra.name, infra.desc || '', [
          ['Cost', `$${typeof infra.cost === 'object' ? infra.cost.funding : infra.cost}/tile`],
          ['Placement', infra.isDragPlacement ? 'Drag area' : infra.isLinePlacement ? 'Draw line' : 'Click'],
        ]);
        return;
      }
      case 'zone': {
        const zone = ZONES[key];
        if (!zone) { this._hidePreview(); return; }
        this._renderPreview(zone.name, zone.desc || '', [
          ['Requires', floorRequirementLabel(zone.requiredFloor)],
          ['Placement', 'Drag area'],
        ]);
        return;
      }
      case 'furnishing': {
        const furn = ZONE_FURNISHINGS[key];
        if (!furn) { this._hidePreview(); return; }
        const furnStats = [
          ['Cost', `$${typeof furn.cost === 'object' ? furn.cost.funding : furn.cost}`],
          ['Size', `${furn.gridW || 1}×${furn.gridH || 1}`],
        ];
        if (furn.energyCost) furnStats.push(['Energy', `${furn.energyCost} kW`]);
        const zoneType = MODES.facility?.categories?.[this.selectedCategory]?.zoneType;
        if (zoneType) furnStats.push(['Bonus Zone', ZONES[zoneType]?.name || zoneType]);
        this._renderPreview(furn.name, furn.desc || '', furnStats);
        return;
      }
      case 'decoration': {
        const dec = DECORATIONS[key];
        if (!dec) { this._hidePreview(); return; }
        const decStats = [['Cost', `$${typeof dec.cost === 'object' ? dec.cost.funding : dec.cost}`]];
        if (dec.morale) decStats.push(['Morale', `+${dec.morale}`]);
        if (dec.mount === 'wall') decStats.push(['Placement', 'Snaps to either wall face']);
        else if (dec.mount === 'overhead') decStats.push(['Placement', 'Floats overhead']);
        else if (dec.mount === 'surface') decStats.push(['Placement', 'Stacks on desks and worktops']);
        else if (dec.placement === 'outdoor') decStats.push(['Placement', 'Outdoor only']);
        if (dec.blocksBuild) decStats.push(['Blocks building', 'Yes']);
        this._renderPreview(dec.name, dec.desc || '', decStats);
        return;
      }
      case 'utility': {
        const descriptor = UTILITY_TYPES[key];
        if (!descriptor) { this._hidePreview(); return; }
        const stats = this.selectedCategory === 'power'
          ? []
          : [['Placement', 'Drag port → port']];
        this._renderPreview(descriptor.displayName || key, descriptor.desc || '', stats);
        return;
      }
      case 'component':
      case 'facility': {
        const comp = COMPONENTS[key];
        if (!comp) { this._hidePreview(); return; }
        const costs = Object.entries(comp.cost).map(([r, a]) => `${a} ${r}`).join(', ');
        const statEntries = [
          ['Cost', costs],
          ['Energy Cost', `${comp.energyCost} kW`],
          ['Length', `${((comp.subL || 4) * 0.5).toFixed(1)} m`],
        ];
        if (comp.placement === 'attachment') {
          const utilityName = comp.utilityMount
            ? (UTILITY_TYPES[comp.utilityMount]?.displayName || comp.utilityMount)
            : null;
          statEntries.push([
            'Placement',
            comp.attachmentKind === 'inline'
              ? 'Tiny inline slot — subtile centre or edge'
              : utilityName
                ? `Anywhere along ${utilityName} runs or on beam pipe`
                : 'On beam pipe',
          ]);
        }
        if (comp.stats) {
          for (const [k, v] of Object.entries(comp.stats)) {
            const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
            if (k === 'energyGain') {
              const en = formatEnergy(v);
              statEntries.push([label, `${en.val} ${en.unit}`]);
            } else {
              const unit = typeof UNITS !== 'undefined' && UNITS[k] ? ` ${UNITS[k]}` : '';
              statEntries.push([label, `${v}${unit}`]);
            }
          }
        }
        if (comp.requires) {
          const reqs = Array.isArray(comp.requires) ? comp.requires : [comp.requires];
          statEntries.push(['Requires', reqs.join(', ')]);
        }
        this._renderPreview(comp.name, comp.desc || '', statEntries, comp.id, comp);
        return;
      }
      default:
        this._hidePreview();
    }
  }

  _renderPreview(name, desc, stats, componentId, comp = null) {
    const panel = document.getElementById('component-preview');
    const nameEl = document.getElementById('preview-name');
    const descEl = document.getElementById('preview-desc');
    const statsEl = document.getElementById('preview-stats');
    if (!panel) return;

    nameEl.textContent = name;
    descEl.textContent = desc;
    statsEl.innerHTML = '';
    for (const [label, val] of stats) {
      const row = document.createElement('div');
      row.className = 'prev-stat-row';
      row.innerHTML = `<span>${label}</span><span class="prev-stat-val">${val}</span>`;
      statsEl.appendChild(row);
    }
    appendRequiredPortRequirements(statsEl, comp);
    // Draw schematic if available
    const schematicCanvas = document.getElementById('preview-schematic');
    if (schematicCanvas && componentId && this.renderer._schematicDrawers[componentId]) {
      schematicCanvas.style.display = 'block';
      this.renderer.drawSchematic(schematicCanvas, componentId);
    } else if (schematicCanvas) {
      schematicCanvas.style.display = 'none';
    }

    panel.classList.remove('hidden');
  }

  _hidePreview() {
    const panel = document.getElementById('component-preview');
    if (panel) panel.classList.add('hidden');
  }

}
