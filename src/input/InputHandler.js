import { COMPONENTS } from '../data/components.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { ZONES, ZONE_FURNISHINGS } from '../data/facility.js';
import { DECORATIONS } from '../data/decorations.js';
import { MODES } from '../data/modes.js';
import { DIR, DIR_DELTA } from '../data/directions.js';
import { isoToGrid, isoToGridFloat, gridToIso, isoToSubGrid } from '../renderer/grid.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { UtilityInspector } from '../ui/UtilityInspector.js';
import { EconomyWindow } from '../ui/EconomyWindow.js';
import { discoverNetworks, makeDefaultPortLookup } from '../utility/network-discovery.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { PLACEABLES } from '../data/placeables/index.js';
import {
  snapForPlaceable, canPlace, previewPlacement, canAffordCost, PLACE_UNAFFORDABLE,
} from '../game/placement.js';
import { findStackTarget } from '../game/stacking.js';
import { mirrorEdge, findWallKey } from '../game/edge-keys.js';
import { BeamlineInputController } from './BeamlineInputController.js';
import { UtilityLineInputController } from './UtilityLineInputController.js';
import { PlaceableTool, ZonePaintTool } from './placement-tools.js';
import { FloorTool, WallTool, DoorTool } from './structure-tools.js';
import { DemolishTool } from './demolish-tool.js';
import { MoveTool, ProbeTool } from './mode-tools.js';
import { BeamlineTool } from './beamline-tool.js';
import { UtilityLineTool } from './utility-line-tool.js';
import {
  projectOntoPipe, pipeSubL, pipeSubUnitAt, pipeSubUnitPath, METRES_PER_SUB,
} from '../beamline/pipe-geometry.js';
import { pipeRefund } from '../beamline/BeamlineSystem.js';
import { pushEscHandler } from '../ui/esc-stack.js';
import {
  DEMOLISH_PLACEABLE_SCOPE,
  DEMOLISH_BUTTONS,
  demolishRefund,
} from './demolishScopes.js';

// === BEAMLINE TYCOON: INPUT HANDLER ===

// Per-key variant memory written by the HUD's variant flyouts (ui/hud.js).
// Read here so keyboard palette navigation arms with the same variant a
// mouse click on the item would.
const VARIANT_MEMORY_KEY = 'bt_lastVariantByKey';

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

function _effectLabel(key) {
  const labels = {
    zoneOutput: 'Zone Output', morale: 'Morale', research: 'Research',
    rfPower: 'RF Power', vacuumCapacity: 'Vacuum', coolingCapacity: 'Cooling',
    cryoCapacity: 'Cryo', powerCapacity: 'Power', dataCapacity: 'Data',
  };
  return labels[key] || key;
}

export class InputHandler {
  constructor(renderer, game) {
    this.renderer = renderer;
    this.game = game;
    this.selectedCategory = 'source';
    this.dipoleBendDir = 'right';
    this.placementDir = DIR.NE;     // direction for source/free placement
    this.selectedParamOverrides = null; // param flyout overrides (BeamlineTool)
    this.selectedNodeId = null;
    this.isPanning = false;
    this.isFreeOrbiting = false;
    this.freeOrbitLast = { x: 0, y: 0 };
    this.panStart = { x: 0, y: 0 };
    this.worldStart = { x: 0, y: 0 };
    this.activeMode = 'beamline';
    this.hoverSubCol = -1;              // sub-grid column under cursor
    this.hoverSubRow = -1;              // sub-grid row under cursor
    // Unified placeable preview state. Which placeable is armed derives
    // from the active tool (see the `armedPlaceableId` getter).
    this.selectedPlaceableVariant = 0; // decoration color variant etc.
    this.hoverPlaceable = null; // { id, col, row, subCol, subRow, dir } | null
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
    // Continuous panning
    this.keysDown = new Set();
    // Palette keyboard navigation
    this.paletteIndex = -1;  // -1 = no keyboard focus
    // Hover tooltip state
    this._hoverTooltipTimer = null;
    this._hoverTooltipTarget = null; // 'furn:id' or 'equip:id'
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
    this._startPanLoop();
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

  _showTooltip(text, screenX, screenY) {
    this._hideTooltip();
    const el = document.createElement('div');
    el.className = 'hover-tooltip';
    el.innerHTML = text;
    el.style.left = (screenX + 12) + 'px';
    el.style.top = (screenY - 8) + 'px';
    document.body.appendChild(el);
    this._tooltipEl = el;
  }

  _hideTooltip() {
    if (this._tooltipEl) {
      this._tooltipEl.remove();
      this._tooltipEl = null;
    }
    if (this._hoverTooltipTimer) {
      clearTimeout(this._hoverTooltipTimer);
      this._hoverTooltipTimer = null;
    }
    this._hoverTooltipTarget = null;
  }

  _checkHoverTooltip(world, grid, screenX, screenY) {
    const col = grid.col, row = grid.row;
    const key = col + ',' + row;

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
            if (this._hoverTooltipTarget !== targetId) {
              this._hideTooltip();
              this._hoverTooltipTarget = targetId;
              this._hoverTooltipTimer = setTimeout(() => {
                const def = ZONE_FURNISHINGS[entry.type];
                if (!def) return;
                let html = `<b>${def.name}</b>`;
                if (def.effects) {
                  for (const [ek, ev] of Object.entries(def.effects)) {
                    if (ev === 0) continue;
                    const sign = ev > 0 ? '+' : '';
                    const label = _effectLabel(ek);
                    const val = typeof ev === 'number' && Math.abs(ev) < 1
                      ? (ev * 100).toFixed(0) + '%'
                      : String(ev);
                    html += `<br><span style="color:#8f8">${label}: ${sign}${val}</span>`;
                  }
                }
                this._showTooltip(html, screenX, screenY);
              }, 500);
            }
            return;
          }
        }
      }
    }

    // Check facility equipment
    const equipId = this.game.state.facilityGrid[key];
    if (equipId) {
      const targetId = 'equip:' + equipId;
      if (this._hoverTooltipTarget !== targetId) {
        this._hideTooltip();
        this._hoverTooltipTarget = targetId;
        this._hoverTooltipTimer = setTimeout(() => {
          const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
          if (!equip) return;
          const comp = COMPONENTS[equip.type];
          if (!comp) return;
          let html = `<b>${comp.name}</b>`;
          if (comp.category) html += `<br><span style="color:#888">${comp.category}</span>`;
          if (comp.energyCost) html += `<br><span style="color:#cc8">${comp.energyCost} kW</span>`;
          this._showTooltip(html, screenX, screenY);
        }, 500);
      }
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
    const from = range.fromSub / subL, to = range.toSub / subL;
    const blocked = !wholePipe && (pipe.placements || []).some(pl => {
      const s = pl.position;
      const e = pl.position + pl.subL / subL;
      return s < to - 1e-9 && from < e - 1e-9;
    });
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
  _updateDemolishHover(world, grid, screenX, screenY, dt, pipeSweep = null) {
    const col = grid.col, row = grid.row;
    const key = col + ',' + row;

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
    const scope = DEMOLISH_PLACEABLE_SCOPE[dt];
    if (scope) {
      const found = this._findDeletablePlaceable(world, grid, screenX, screenY, scope);
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
          const section = dt === 'demolishBeamline'
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
    if (!found && (dt === 'demolishUtility' || dt === 'demolishAll')) {
      const hit = this.renderer.raycastUtilityLine?.(screenX, screenY);
      if (hit && hit.lineId) {
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
    if (!found && (dt === 'demolishBuilding' || dt === 'demolishAll')) {
      const nearest = this._getNearestEdge?.(screenX, screenY);
      const hit = nearest && this._findWallOrDoorAtEdge(nearest);
      if (hit) {
        const { edge, wallType, doorType } = hit;
        if (this._shiftDown && dt === 'demolishBuilding') {
          const seg = wallType
            ? this._buildWallSegmentPath(edge)
            : this._buildDoorSegmentPath(edge);
          if (seg.length > 1) this.renderer.renderDemolishPathPreview(seg);
          else this.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
        } else {
          this.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
        }
        const def = wallType ? WALL_TYPES[wallType] : DOOR_TYPES[doorType];
        this._showDemolishTooltip(def?.name || (wallType ? 'Wall' : 'Door'), demolishRefund(def), screenX, screenY);
        found = true;
      }
    }

    // Zones
    if (!found && (dt === 'demolishBuilding' || dt === 'demolishAll')) {
      const zoneType = this.game.state.zoneOccupied[key];
      if (zoneType) {
        const zone = ZONES[zoneType];
        this.renderer.renderDemolishTileOutline(col, row);
        this._showDemolishTooltip(zone ? zone.name : zoneType, 0, screenX, screenY);
        found = true;
      }
    }

    // Infrastructure / floor
    if (!found && (dt === 'demolishBuilding' || dt === 'demolishAll')) {
      const infraType = this.game.state.infraOccupied[key];
      if (infraType) {
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
    if (refund > 0) {
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
      if (!def || def.category !== 'beamline') continue;
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

  /**
   * Find a beamline node by raycasting the 3D scene first, then falling back to tile lookup.
   */
  _getNodeAtScreenOrGrid(screenX, screenY, col, row) {
    // Try 3D raycast first (picks the visible object under the cursor)
    if (this.renderer.raycastScreen) {
      const hit = this.renderer.raycastScreen(screenX, screenY);
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
    }
    // Fallback to tile-based lookup
    return this._getNodeAtGrid(col, row);
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

  /**
   * The same physical tile edge has two key representations (e.g. the 's'
   * edge of (c,r) is the 'n' edge of (c,r+1)). Walls/doors are stored under
   * whichever representation the cursor produced at placement time, so
   * demolish lookups must check both.
   */
  _edgeAlias(pt) {
    return mirrorEdge(pt.col, pt.row, pt.edge);
  }

  /**
   * Resolve a wall/door segment at an edge, checking both representations.
   * Returns { edge, wallType, doorType } normalized to the representation
   * the segment is actually stored under, or null when neither alias holds
   * a wall or a door.
   */
  _findWallOrDoorAtEdge(edge) {
    for (const e of [edge, this._edgeAlias(edge)]) {
      const k = `${e.col},${e.row},${e.edge}`;
      const wallType = this.game.state.wallOccupied?.[k] || null;
      const doorType = this.game.state.doorOccupied?.[k] || null;
      if (wallType || doorType) return { edge: e, wallType, doorType };
    }
    return null;
  }

  /** Remove wall + door segments at an edge under either representation. */
  _removeWallAndDoorAtEdge(pt) {
    const alias = this._edgeAlias(pt);
    this.game.removeWall(pt.col, pt.row, pt.edge);
    this.game.removeDoor(pt.col, pt.row, pt.edge);
    this.game.removeWall(alias.col, alias.row, alias.edge);
    this.game.removeDoor(alias.col, alias.row, alias.edge);
  }

  /**
   * Walk along a floor boundary from the clicked edge in both directions,
   * collecting every contiguous edge that sits on the same boundary.
   */
  _buildFloorBoundaryPath(origin) {
    const occ = this.game.state.infraOccupied;
    const { edge } = origin;

    const neighborKey = (col, row, e) => {
      if (e === 'n') return `${col},${row - 1}`;
      if (e === 's') return `${col},${row + 1}`;
      if (e === 'e') return `${col + 1},${row}`;
      return `${col - 1},${row}`;
    };

    const isBoundary = (col, row, e) => {
      const a = !!occ[`${col},${row}`];
      const b = !!occ[neighborKey(col, row, e)];
      return a !== b;
    };

    if (!isBoundary(origin.col, origin.row, edge)) return [origin];

    const horizontal = edge === 'n' || edge === 's';
    const path = [origin];

    for (const dir of [-1, 1]) {
      let col = origin.col;
      let row = origin.row;
      for (;;) {
        if (horizontal) col += dir; else row += dir;
        if (!isBoundary(col, row, edge)) break;
        const pt = { col, row, edge };
        if (dir === -1) path.unshift(pt); else path.push(pt);
      }
    }
    return path;
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
    const wo = this.game.state.wallOccupied;
    const { edge } = origin;
    const keyAt = (col, row) => `${col},${row},${edge}`;
    if (!wo[keyAt(origin.col, origin.row)]) return [];
    const horizontal = edge === 'n' || edge === 's';
    const path = [{ col: origin.col, row: origin.row, edge }];
    for (const dir of [-1, 1]) {
      let col = origin.col;
      let row = origin.row;
      for (;;) {
        if (horizontal) col += dir; else row += dir;
        if (!wo[keyAt(col, row)]) break;
        const pt = { col, row, edge };
        if (dir === -1) path.unshift(pt); else path.push(pt);
      }
    }
    return path;
  }

  /**
   * Mirror of _buildWallSegmentPath for door segments (doorOccupied).
   */
  _buildDoorSegmentPath(origin) {
    const door = this.game.state.doorOccupied;
    const { edge } = origin;
    const keyAt = (col, row) => `${col},${row},${edge}`;
    if (!door[keyAt(origin.col, origin.row)]) return [];
    const horizontal = edge === 'n' || edge === 's';
    const path = [{ col: origin.col, row: origin.row, edge }];
    for (const dir of [-1, 1]) {
      let col = origin.col;
      let row = origin.row;
      for (;;) {
        if (horizontal) col += dir; else row += dir;
        if (!door[keyAt(col, row)]) break;
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
    const hit = this._snapAttachmentToPipe(compKey, worldX, worldY);
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
    // Game.addAttachmentToPipe charges the component's cost, so an
    // unaffordable attachment must not preview green.
    const affordable = canAffordCost(this.game, COMPONENTS[compKey]?.cost);
    const valid = !hit.collidesWithModule && affordable;
    this.renderer.renderAttachmentGhost(
      hit.proj.col, hit.proj.row,
      compKey,
      hit.proj.dir,
      valid,
      (!hit.collidesWithModule && !affordable) ? PLACE_UNAFFORDABLE : null,
    );
  }

  /**
   * Return the nearest edge of the cursor's tile, preferring edges that sit
   * on a flooring boundary (one side has infrastructure, the other doesn't).
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
      const a = !!occ[`${e.col},${e.row}`];
      const b = !!occ[neighbor(e)];
      return a !== b;
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

    candidates.sort((a, b) => {
      const aScore = a.dist - (hasWall(a) ? 0.35 : 0);
      const bScore = b.dist - (hasWall(b) ? 0.35 : 0);
      return aScore - bScore;
    });

    return candidates[0];
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
      // Escape never routes through here — the esc-stack (ui/esc-stack.js)
      // owns it; our default ladder is this handler's fallback entry
      // (_handleEscape). While the beamline designer is open it swallows
      // every other key at capture phase, so no designer guard is needed.
      if (e.key === 'Escape') return;
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
        e.preventDefault();
        return;
      }

      // Mode hotkeys: 1..6 activate top-row mode buttons.
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

      // Palette hotkeys: z,x,c,v,b,n,m select palette slots 0..6.
      // Skip when modifiers are held so Shift+Z decoration-spacing and
      // Ctrl+Z undo keep working.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
          && 'zxcvbnm'.includes(k)) {
        const slot = 'zxcvbnm'.indexOf(k);
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
                params: this.selectedParamOverrides,
                variant: this.selectedPlaceableVariant,
              });
              // Auto-switch to beam pipe tool after placing a source.
              const comp = COMPONENTS[this.hoverPlaceable.id];
              if (placedId && comp?.isSource) {
                this.selectComponentTool('drift');
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
          const overlay = document.getElementById('goals-overlay');
          if (overlay) overlay.classList.toggle('hidden');
          break;
        }
        case 'k': case 'K': {
          // K, not E/F/B/M: every mnemonic for "economy" is already a mode,
          // palette slot or camera key. Toggles like the Research/Goals keys.
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
          this.renderer.updatePalette(this.selectedCategory);
          this.paletteIndex = -1;
          this._hidePreview();
          break;
        }
        case 'f': case 'F': {
          // (FloorTool consumes F for orientable floors in its onKey.)
          // Rotate placement direction (cycles NE→SE→SW→NW)
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
          if (this.game._designer && !this.game._designer.isOpen) {
            e.preventDefault();
            const blId = this.game.selectedBeamlineId || this.game.editingBeamlineId;
            if (blId) {
              this.game._openDesignerForBeamline(blId);
            } else {
              // Reopen last designer session or open blank
              const saved = this.game.state.designerState;
              if (saved && saved.mode === 'edit' && saved.editSourceId) {
                this.game._designer.openFromSource(saved.editSourceId, saved.editEndpointId);
              } else if (saved && saved.mode === 'design') {
                const design = saved.designId ? this.game.getDesign(saved.designId) : null;
                this.game._designer.openDesign(design);
              } else {
                this.game._designer.openDesign(null);
              }
            }
          }
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
        case 'y': case 'Y':
          this._toggleMoveMode();
          break;
        // Sim speed. Space is taken (place/toggle beam) and 1-6 are mode
        // hotkeys, so pause lives on P and speeds on 7/8/9.
        case 'p': case 'P': {
          if (e.ctrlKey || e.metaKey || e.altKey) break; // keep Cmd/Ctrl+P (print)
          e.preventDefault();
          this.game.togglePause();
          this._showToast(this.game.state.paused ? 'Paused' : 'Resumed');
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
        case 'Delete': case 'Backspace':
          e.preventDefault();
          // Toggle context-aware demolish without leaving current menu
          this._toggleContextDemolish();
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
    });

    // Clear all held keys when the window loses focus so pan doesn't stick
    // if the user alt-tabs, opens devtools, or a modal steals focus.
    const clearHeldKeys = () => {
      this.keysDown.clear();
      this._shiftDown = false;
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
    const PAN_SPEED_BASE = 0.5; // world-pan units per frame at zoom=1
    const loop = () => {
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
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
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
      // Middle mouse: free-orbit camera drag. Release snaps to nearest iso view.
      if (e.button === 1) {
        this.isFreeOrbiting = true;
        this.freeOrbitLast = { x: e.clientX, y: e.clientY };
        this.renderer.startFreeOrbit();
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

      // Active tool gets first claim on the press (after camera controls,
      // which are built-in input handling, not tools).
      if (this._toolConsumed('onMouseDown', e)) return;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isFreeOrbiting) {
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

    canvas.addEventListener('mouseup', (e) => {
      this._hideDragCostTooltip();
      if (this.isFreeOrbiting) {
        this.isFreeOrbiting = false;
        this.renderer.endFreeOrbit();
        canvas.style.cursor = '';
        return;
      }
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = '';
        return;
      }

      // Active tool gets first claim on the release (drag commits). A
      // plain click falls through to _handleClick, which dispatches the
      // tool's onClick.
      if (this._toolConsumed('onMouseUp', e)) return;

      if (e.button === 0) {
        // Left click
        this._handleClick(e.clientX, e.clientY);
      } else if (e.button === 2) {
        // Right click — the active tool decides whether it deselects
        // (ZonePaintTool / FloorTool / DemolishTool / BeamlineTool do;
        // PlaceableTool keeps the legacy behavior of ignoring right-click).
        this._toolConsumed('onRightClick', e);
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
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
        this.isFreeOrbiting = false;
        this.renderer.endFreeOrbit();
        canvas.style.cursor = '';
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
   * Drop every in-flight pointer gesture without committing it: camera
   * orbit/pan and the active tool's drag state. Safe to call repeatedly.
   */
  _abortPointerGesture() {
    this._hideDragCostTooltip?.();
    if (this.isFreeOrbiting) {
      this.isFreeOrbiting = false;
      this.renderer.endFreeOrbit?.();
    }
    this.isPanning = false;
    const canvas = this.renderer?.canvas;
    if (canvas) canvas.style.cursor = this.activeTool?.cursor || '';
    // 'abort', not 'stateReplaced': nothing restores the world here, so a
    // tool carrying a lifted object has to put it back itself.
    this.activeTool?.cancelGesture?.(this._toolCtx, 'abort');
  }

  // --- Click handling ---

  _handleClick(screenX, screenY) {
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
      // Design placement is a world-mutating gesture like any other tool
      // commit — outside the gesture helper it was the only one outside the
      // undo model, so Ctrl+Z after placing a design silently deleted it as
      // a side effect of rewinding whatever came before.
      this.game.commitGesture({
        validate: () => (this.game._designPlacer.valid
          ? true : { ok: false, reason: 'Invalid placement!' }),
        mutate: () => this.game._designPlacer.confirm(),
      });
      return;
    }

    // Active tool gets first claim on the click (placement commits).
    if (this._toolConsumed('onClick', { clientX: screenX, clientY: screenY, button: 0 })) {
      return;
    }

    // Utility-line click-to-inspect. An armed beamline tool suppresses it
    // (legacy dispatch order: the beamline family kept the click for node
    // selection below); tools that consume clicks never reach this point.
    // Opens a UtilityInspector window for the clicked line's network.
    if (this.activeTool?.kind !== 'beamline'
        && typeof this.renderer.raycastUtilityLine === 'function') {
      const hit = this.renderer.raycastUtilityLine(screenX, screenY);
      if (hit && hit.lineId) {
        if (this._openUtilityInspectorForLine(hit.lineId)) return;
      }
    }

    // Selection mode
    const node = this._getNodeAtScreenOrGrid(screenX, screenY, col, row);
    if (node) {
      this.selectedNodeId = node.id;
      // Select the beamline this node belongs to and open its context window
      const blId = node.beamlineId;
      if (blId) {
        this.game.selectedBeamlineId = blId;
        this.renderer._openBeamlineWindow(blId, node);
        this.game.emit('beamlineSelected', blId);
      }
    } else {
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
            this.renderer.showNetworkOverlay(facId);
            this.renderer._openEquipmentWindow(equip);
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
    this._hideTooltip();
    // Variant is per-armed-tool state: whatever the previous tool chose must
    // not survive into the next one (a decoration swatch leaking into a
    // facility item commits that item with a variant it never offered).
    // Tools that own a variant write it back in onEnter.
    this.selectedPlaceableVariant = 0;
    this.activeTool = tool || null;
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
    this._updateShiftHint();
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
      case 'facility':   this.setTool(new PlaceableTool('facility', key, variant)); break;
      case 'floor':      this.setTool(new FloorTool(key, variant)); break;
      case 'wall':       this.setTool(new WallTool(key, variant)); break;
      case 'door':       this.setTool(new DoorTool(key, variant)); break;
      case 'zone':       this.setTool(new ZonePaintTool(key)); break;
      case 'furnishing': this.setTool(new PlaceableTool('furnishing', key, variant)); break;
      case 'decoration': this.setTool(new PlaceableTool('decoration', key, variant)); break;
      case 'demolish':   this.setTool(new DemolishTool(key || 'demolishAll')); break;
      case 'utility':    this.setTool(new UtilityLineTool(key)); break;
      default:
        console.warn('[InputHandler] unknown palette kind:', kind, key);
    }
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
    // Param-flyout overrides live on the UIHost (renderer.ui); fall back to
    // the renderer for harnesses that stub it flat.
    const overrideMap = this.renderer.ui?._selectedParamOverrides
      ?? this.renderer._selectedParamOverrides;
    const overrides = overrideMap?.[key] || null;
    this.setTool(new BeamlineTool(key, overrides));
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
   * Never returns an entry whose kind isn't in the scope set.
   */
  _findDeletablePlaceable(world, grid, screenX, screenY, scope) {
    if (!scope) return null;

    // --- 1. Raycast for precise 3D hit detection ---
    const hit = this.renderer.raycastScreen(screenX, screenY);
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
          if (node && scope.has('beamline')) {
            const placeable = PLACEABLES[node.type] || COMPONENTS[node.type];
            return { kind: 'beamline', node, placeable, rootObj: info.rootObj };
          }
          // No registry node — likely an infrastructure module. Resolve via
          // the unified subgridOccupied probe using the hit world position.
          const p = info.rootObj.position;
          const entry = this._placeableAtWorldPos(p.x, p.z);
          if (entry && scope.has(entry.kind)) {
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
        // Equipment / furnishing / decoration all route through the same
        // unified subgridOccupied probe, using the hit mesh's world
        // position as the probe point.
        if (info.group === 'equipment' || info.group === 'decoration') {
          const p = info.rootObj.position;
          const entry = this._placeableAtWorldPos(p.x, p.z);
          if (entry && scope.has(entry.kind)) {
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
        const k = grid.col + ',' + grid.row + ',' + sc + ',' + sr;
        const occ = this.game.state.subgridOccupied[k];
        if (occ && scope.has(occ.kind)) {
          const entry = this.game.getPlaceable(occ.id);
          if (entry) {
            // Decorations live in the decoration builder's own registry, not
            // the component mesh map — check both or they highlight nothing.
            const rootObj = this.renderer.componentBuilder?._meshMap?.get(entry.id)
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
        if (!scope.has(p.category)) continue;
        if (!p.cells) continue;
        if (p.cells.some(c => c.col === grid.col && c.row === grid.row)) {
          const rootObj = this.renderer.componentBuilder?._meshMap?.get(p.id) || null;
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
    const k = col + ',' + row + ',' + subCol + ',' + subRow;
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
   * Recompute the unified placeable ghost from the last known cursor
   * world position. Called from the mousemove handler and from the
   * rotation key so rotating refreshes the preview immediately.
   */
  _updatePlaceablePreview() {
    const armedId = this.armedPlaceableId;
    if (!armedId) {
      this.hoverPlaceable = null;
      return;
    }
    // Beamline junction/placement hover is handled by BeamlineInputController.
    const selDef = COMPONENTS[armedId];
    if (selDef?.role === 'junction' || selDef?.role === 'placement') {
      this.hoverPlaceable = null;
      const wx = this.lastMouseWorldX ?? 0;
      const wy = this.lastMouseWorldY ?? 0;
      this.beamlineController.onHover(wx, wy, armedId);
      return;
    }
    // Drawn connections (beam pipes) have their own preview system; skip the
    // full-tile ghost/grid overlay so hovering with the pipe tool stays clean.
    if (selDef?.isDrawnConnection) {
      this.hoverPlaceable = null;
      return;
    }
    const placeable = PLACEABLES[armedId];
    if (!placeable) {
      // No unified def for the armed id — nothing can be committed, so the
      // ghost left over from the previous tool must not stay on screen.
      this.hoverPlaceable = null;
      this.renderer._clearPreview?.();
      return;
    }
    const wx = this.lastMouseWorldX ?? 0;
    const wy = this.lastMouseWorldY ?? 0;
    const snap = snapForPlaceable(wx, wy, placeable, this.placementDir);

    let placeY = 0;
    let stackTargetId = null;
    let ok = false;
    let reason = null;

    if (placeable.stackable) {
      const getEntry = (id) => {
        const idx = this.game.state.placeableIndex[id];
        return idx !== undefined ? this.game.state.placeables[idx] : null;
      };
      const getDef = (t) => PLACEABLES[t] || null;
      const st = findStackTarget(
        placeable, snap.col, snap.row, snap.subCol, snap.subRow, this.placementDir,
        this.game.state.subgridOccupied, getEntry, getDef,
      );
      if (st) {
        placeY = st.placeY;
        stackTargetId = st.targetEntry.id;
        // Stacking bypasses the footprint check, not the ledger — Game still
        // charges for the stacked item.
        ok = canAffordCost(this.game, placeable.cost);
        reason = ok ? null : PLACE_UNAFFORDABLE;
      } else {
        const result = previewPlacement(
          this.game, placeable,
          snap.col, snap.row, snap.subCol, snap.subRow,
          this.placementDir,
        );
        ok = result.ok;
        reason = result.reason;
      }
    } else {
      const result = previewPlacement(
        this.game, placeable,
        snap.col, snap.row, snap.subCol, snap.subRow,
        this.placementDir,
      );
      ok = result.ok;
      reason = result.reason;
    }

    this.hoverPlaceable = {
      id: armedId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir: this.placementDir,
      placeY,
      stackTargetId,
      variant: this.selectedPlaceableVariant,
    };
    this.renderer.renderPlaceableGhost(this.hoverPlaceable, ok, reason);
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
    // For beamline modules, check if the click landed on an existing node
    // (opens its beamline window instead of placing).
    const comp = COMPONENTS[this.hoverPlaceable.id];
    if (comp && comp.placement !== 'attachment') {
      const existingNode = this._getNodeAtScreenOrGrid(screenX, screenY, grid.col, grid.row);
      if (existingNode) {
        this.selectedNodeId = existingNode.id;
        const blId = existingNode.beamlineId;
        if (blId) {
          this.game.selectedBeamlineId = blId;
          this.renderer._openBeamlineWindow(blId, existingNode);
          this.game.emit('beamlineSelected', blId);
        }
        return true;
      }
    }
    this.game._withUndo(() => {
      const placedId = this.game.placePlaceable({
        type: this.hoverPlaceable.id,
        col: this.hoverPlaceable.col,
        row: this.hoverPlaceable.row,
        subCol: this.hoverPlaceable.subCol,
        subRow: this.hoverPlaceable.subRow,
        dir: this.hoverPlaceable.dir,
        params: this.selectedParamOverrides,
        variant: this.selectedPlaceableVariant,
      });
      // Auto-switch to beam pipe tool after placing a source.
      if (placedId && comp?.isSource) {
        this.selectComponentTool('drift');
      }
    });
    // Re-preview at the same cursor position: the tile the ghost sits on is
    // now occupied, so leaving the stale green ghost up made a second click
    // without moving report "Space occupied!" under a valid-looking preview.
    // (BeamlineInputController._commitPlacement and
    // _finishLinePlaceDecoration refresh the same way.)
    this._repaintArmedPreview();
    return true;
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
      );

      let overlapsEarlier = false;
      if (result.ok) {
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

  _demolishEverythingAt(col, row) {
    const key = col + ',' + row;
    // Remove beamline components
    const node = this._getNodeAtGrid(col, row);
    if (node) this.game.removePlaceable(node.id);
    // Remove unified placeables (equipment / furnishings / decorations /
    // infrastructure modules) occupying any subcell of this tile.
    const idsOnTile = new Set();
    for (let sr = 0; sr < 4; sr++) {
      for (let sc = 0; sc < 4; sc++) {
        const occ = this.game.state.subgridOccupied[key + ',' + sc + ',' + sr];
        if (occ && occ.id) idsOnTile.add(occ.id);
      }
    }
    for (const id of idsOnTile) this.game.removePlaceable(id);
    // Phase 6: rack segments removed from state; nothing to demolish here.
    // Remove furnishings
    const subgrid = this.game.state.zoneFurnishingSubgrids[key];
    if (subgrid) {
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
    // Remove decorations
    this.game.removeDecoration(col, row);
    // Remove zones
    if (this.game.state.zoneOccupied[key]) this.game.removeZoneTile(col, row);
    // Remove walls and doors on every edge of this tile (segments may be
    // stored under either alias of any of the four edge keys)
    for (const edge of ['n', 's', 'e', 'w']) {
      this._removeWallAndDoorAtEdge({ col, row, edge });
    }
    // Remove floor last
    if (this.game.state.infraOccupied[key]) this.game.removeInfraTile(col, row);
  }

  // --- Move mode (MoveTool) ---

  _toggleMoveMode() {
    // setTool handles the exclusivity sweep; MoveTool.onExit restores a
    // still-carried item to its origin.
    if (this.activeTool?.kind === 'move') {
      this.clearTool();
    } else {
      this.setTool(new MoveTool());
    }
  }

  // Refreshes the unified placeable preview for a just-picked-up carried
  // item (the carried type arms the preview via MoveTool.armedPlaceableId).
  _armMovePreview(_type, dir) {
    this.placementDir = dir || 0;
    this.renderer.updatePlacementDir?.(this.placementDir);
    this.hoverPlaceable = null;
    this.renderer._clearPreview?.();
    this._updatePlaceablePreview();
  }

  _pickUpAt(col, row, screenX, screenY) {
    // Beamline component (moved on placement so attached beam pipes get
    // rebuilt via _deriveBeamGraph).
    const node = this._getNodeAtGrid(col, row);
    if (node) {
      const comp = COMPONENTS[node.type];
      this._showToast(`Moving ${comp ? comp.name : node.type}`);
      return {
        kind: 'component',
        nodeId: node.id,
        type: node.type,
        dir: node.dir || 0,
        originCol: node.col,
        originRow: node.row,
      };
    }

    // Unified placeables (equipment, furnishing, decoration, infrastructure).
    // Use the 3D raycast when available so the hit matches what the user
    // sees; fall back to subgrid lookup at the cursor tile center.
    let hitEntry = null;
    const world = this.renderer.screenToWorld
      ? this.renderer.screenToWorld(screenX, screenY)
      : null;
    if (world && typeof this._placeableAtWorldPos === 'function') {
      hitEntry = this._placeableAtWorldPos(world.x, world.y);
    }
    if (!hitEntry) {
      // Fallback: scan a few subtile cells at the clicked tile center.
      for (let sr = 0; sr < 4 && !hitEntry; sr++) {
        for (let sc = 0; sc < 4 && !hitEntry; sc++) {
          const k = col + ',' + row + ',' + sc + ',' + sr;
          const occ = this.game.state.subgridOccupied[k];
          if (occ) hitEntry = this.game.getPlaceable(occ.id);
        }
      }
    }
    if (hitEntry && hitEntry.kind !== 'beamline') {
      const snap = this.game._withUndo(() => this.game.liftPlaceable(hitEntry.id));
      if (!snap) return null;
      const def = PLACEABLES[snap.type];
      this._showToast(`Moving ${def?.name || snap.type}`);
      return {
        kind: 'placeable',
        type: snap.type,
        params: snap.params,
        variant: snap.variant ?? 0,
        originCol: snap.col,
        originRow: snap.row,
        originSubCol: snap.subCol,
        originSubRow: snap.subRow,
        originDir: snap.dir,
        dir: snap.dir,
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
      const entry = this._placeableAtWorldPos(p.x, p.z);
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
      return this.game._withUndo(() => {
        placeable.col = col;
        placeable.row = row;
        if (this.placementDir != null) placeable.dir = this.placementDir;
        this.game._rebuildPlaceableCells(placeable);
        this.game._deriveBeamGraph();
        this.game.recalcAllBeamlines();
        this.game.emit('placeableChanged');
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
        params: p.params,
        variant: p.variant,
        free: true,
        silent: true,
      });
      return placedId !== false;
    }

    return false;
  }

  /**
   * Refresh the bottom-left shift-hint chip based on the active tool.
   * Shows contextual hints for the armed tool: rotate/cancel while a
   * rotatable placeable is selected, shift-modified actions (line place,
   * wall boundary fill, demolish whole run), and floor orientation.
   * Hidden when no hint applies to the current selection.
   */
  _updateShiftHint() {
    const el = document.getElementById('shift-hint');
    if (!el) return;

    const sep = `<span class="sep">•</span>`;
    const tool = this.activeTool;
    let html = '';
    if (tool?.kind === 'demolish' && tool.demolishType === 'demolishBuilding') {
      html = `<span class="k">SHIFT</span>+click: delete whole run`;
    } else if (tool?.kind === 'wall') {
      html = `<span class="k">SHIFT</span>+click: fill floor boundary`;
    } else if (this.armedPlaceableId) {
      // Placement hint: F rotates every free-placed placeable (furnishings,
      // decorations, equipment, grid beamline components). Pipe-bound tools
      // (junctions, on-pipe placements, drawn pipes) take orientation from
      // the pipe, so no rotate hint for them.
      const comp = COMPONENTS[this.armedPlaceableId];
      const rotatable = !(comp && (comp.role === 'junction'
        || comp.role === 'placement' || comp.isDrawnConnection));
      if (rotatable) {
        const bits = [`<span class="k">F</span> Rotate`];
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
    // Pick demolish type based on active tool context: structure-ish tools
    // map to Building, beamline mode maps to Beamline, everything else gets
    // the catch-all.
    let demolishType;
    const kind = this.activeTool?.kind;
    const cat = this.selectedCategory;
    const catDef = MODES[this.activeMode]?.categories?.[cat];
    if (kind === 'wall' || catDef?.isWallTab || cat === 'walls' || cat === 'fencing'
        || kind === 'door' || cat === 'doors'
        || kind === 'floor' || cat === 'flooring' || catDef?.isSurfaceTab
        || kind === 'zone') {
      demolishType = 'demolishBuilding';
    } else if (this.activeMode === 'beamline') {
      demolishType = 'demolishBeamline';
    } else {
      demolishType = 'demolishAll';
    }

    // Activate demolish in-place without changing mode/menu — setTool
    // disarms whatever was active.
    this.setTool(new DemolishTool(demolishType));
    const btn = DEMOLISH_BUTTONS.find(b => b.key === demolishType);
    this._renderPreview(btn?.name || 'Demolish', 'Press Delete or Esc to exit', []);
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
    this.renderer.updatePalette(category);
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
  _openUtilityInspectorForLine(lineId) {
    const state = this.game.state;
    const lines = state.utilityLines;
    if (!lines || typeof lines.get !== 'function') return false;
    const line = lines.get(lineId);
    if (!line) return false;
    const lookup = makeDefaultPortLookup(state);
    const nets = discoverNetworks(line.utilityType, lines, lookup);
    const net = nets.find(n => (n.lineIds || []).includes(lineId));
    if (!net) return false;
    new UtilityInspector(this.game, line.utilityType, net.id);
    return true;
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
    // Entering demolish mode arms the catch-all tool immediately (RCT
    // style) so the first click already demolishes. The HUD's own mode-btn
    // listener runs before this one, so the palette DOM is already built;
    // highlight card 0 to match.
    if (mode === 'demolish') {
      this.setTool(new DemolishTool('demolishAll'));
      this._syncPaletteClick(0);
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
    this.renderer.updatePalette(next.category);

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
        this._renderPreview(wt.name, wt.desc || '', [
          ['Cost', `$${typeof wt.cost === 'object' ? wt.cost.funding : wt.cost}/segment`],
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
          ['Requires', FLOORS[zone.requiredFloor]?.name || zone.requiredFloor],
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
        if (zoneType) furnStats.push(['Zone', ZONES[zoneType]?.name || zoneType]);
        this._renderPreview(furn.name, furn.desc || '', furnStats);
        return;
      }
      case 'decoration': {
        const dec = DECORATIONS[key];
        if (!dec) { this._hidePreview(); return; }
        const decStats = [['Cost', `$${typeof dec.cost === 'object' ? dec.cost.funding : dec.cost}`]];
        if (dec.morale) decStats.push(['Morale', `+${dec.morale}`]);
        if (dec.placement === 'outdoor') decStats.push(['Placement', 'Outdoor only']);
        if (dec.blocksBuild) decStats.push(['Blocks building', 'Yes']);
        this._renderPreview(dec.name, dec.desc || '', decStats);
        return;
      }
      case 'demolish': {
        const btn = DEMOLISH_BUTTONS.find(b => b.key === key);
        this._renderPreview(btn?.name || 'Demolish', btn?.desc || '', []);
        return;
      }
      case 'utility': {
        const descriptor = UTILITY_TYPES[key];
        if (!descriptor) { this._hidePreview(); return; }
        this._renderPreview(descriptor.displayName || key, descriptor.desc || '', [
          ['Placement', 'Drag port → port'],
        ]);
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
        this._renderPreview(comp.name, comp.desc || '', statEntries, comp.id);
        return;
      }
      default:
        this._hidePreview();
    }
  }

  _renderPreview(name, desc, stats, componentId) {
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
