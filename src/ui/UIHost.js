// src/ui/UIHost.js
//
// UIHost owns the DOM-side UI of Beamline Tycoon: HUD panels, palette,
// popups, tech tree, and anchored context windows.
//
// It is populated by side-effect imports of ./hud.js and ./overlays.js,
// which attach their methods to UIHost.prototype.
//
// UIHost holds a reference to the active renderer. Pass-through getters
// and setters make renderer-owned state (game, sprites, active callbacks,
// wall-visibility flags, viewport transform) readable/writable from UI
// methods as `this.X`, so the method bodies migrate verbatim.
//
// Fields whose lifecycle is purely UI-local (tree pan/zoom, popup state,
// anchored-window registries) live on the UIHost instance.

import { fmtNumber } from './format.js';

export class UIHost {
  constructor(renderer) {
    this.renderer = renderer;

    // --- UI widget ephemeral state ---
    this._activeParamFlyout = null;
    this._selectedParamOverrides = null;
    this._activeStatsCategory = null;
    this._activeStatsKey = null;
    // Palette item under the cursor — read by the manual's contextual open
    // (hud.js: _contextualManualComponent) so "?" lands on that component.
    this._hoveredPaletteComponent = null;
    // Connection guides are one-shot orientation cards. A fresh Infra tab
    // visit reveals one; the first world/tool/Escape interaction dismisses it
    // for the rest of that visit (hud.js owns the transitions).
    this._connectionGuideCategory = null;
    this._connectionGuideVisible = false;

    // --- Tech tree pan/zoom state ---
    this._treePanX = 0;
    this._treePanY = 0;
    this._treeZoom = 1;
    this._treeDragging = false;
    this._treeDragStartX = 0;
    this._treeDragStartY = 0;
    this._treeLayout = null;
    this._treeCanvasWidth = 0;
    this._treeCanvasHeight = 0;

    // --- Anchored context-window registries ---
    this._beamlineWindows = {};
    this._equipmentWindows = {};
    this._selectionWindow = null;
    this._popupPlaceableId = null;
  }

  // Number formatter — shared fmtNumber, kept as a method so UI code can
  // call `this._fmt(n)` without a renderer round-trip.
  _fmt(n) {
    return fmtNumber(n);
  }

  // Forwarders for renderer methods called from UI code.
  _applyWallVisibility() { return this.renderer._applyWallVisibility(); }
  _applyDoorVisibility() { return this.renderer._applyDoorVisibility(); }

  // The single palette → tool path: every palette item click routes its
  // {kind, key, variant} identity into InputHandler.selectPaletteTool.
  _selectPaletteTool(kind, key, variant) {
    this.renderer._inputHandler?.selectPaletteTool(kind, key, variant);
  }

  _setDemolishFilter(key, enabled) {
    return this.renderer._inputHandler?.setDemolishFilter(key, enabled);
  }
}

// --- Pass-through properties: reads/writes delegate to the renderer. ---
//
// This list is the explicit contract between the UI layer and the renderer.
// A future renderer swap needs to satisfy exactly these fields.
const PASS_THROUGH_PROPS = [
  // World / viewport
  'game', 'sprites', 'app', 'world', 'zoom',
  // Mode state
  'activeMode', 'buildMode',
  // Wall / door visibility (UI writes, renderer reads)
  'wallVisibilityMode', '_cutawayHoverKey', '_transparentHoverKey',
  // Facility Labs/Rooms tab group. Owned by _generateCategoryTabs (this
  // layer), but main.js restores it through the renderer on load — without
  // the pass-through that write lands on a dead renderer field and the
  // toggle snaps back to 'labs'.
  '_facilityGroup',
  // Selection callbacks (main.js writes, UI reads)
  '_onTabSelect', '_onPaletteClick',
];

for (const prop of PASS_THROUGH_PROPS) {
  Object.defineProperty(UIHost.prototype, prop, {
    get() { return this.renderer[prop]; },
    set(value) { this.renderer[prop] = value; },
    configurable: true,
  });
}
