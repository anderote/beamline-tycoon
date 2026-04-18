// src/ui/UIHost.js
//
// UIHost owns the DOM-side UI of Beamline Tycoon: HUD panels, palette,
// popups, tech tree, goals overlay, tutorial panel, and anchored context
// windows.
//
// It is populated by side-effect imports of ../renderer/hud.js and
// ../renderer/overlays.js, which attach their methods to UIHost.prototype.
//
// UIHost holds a reference to the active renderer. Pass-through getters
// and setters make renderer-owned state (game, sprites, active callbacks,
// wall-visibility flags, viewport transform) readable/writable from UI
// methods as `this.X`, so the method bodies migrate verbatim.
//
// Fields whose lifecycle is purely UI-local (tree pan/zoom, popup state,
// anchored-window registries, tutorial state) live on the UIHost instance.

export class UIHost {
  constructor(renderer) {
    this.renderer = renderer;

    // --- UI widget ephemeral state ---
    this._activeParamFlyout = null;
    this._selectedParamOverrides = null;
    this._activeStatsCategory = null;
    this._activeStatsKey = null;

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
    this._machineWindows = {};
    this._equipmentWindows = {};

    // --- Tutorial panel state ---
    this._tutorialInited = false;
    this._tutorialMinimized = true;
    this._tutorialPrevCompleted = null;
  }

  // Number formatter — duplicated from Renderer.prototype._fmt so UI methods
  // can call `this._fmt(n)` without a renderer round-trip.
  _fmt(n) {
    if (n === undefined || n === null) return '0';
    if (typeof n !== 'number') return String(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.floor(n).toString();
  }

  // Forwarders for renderer methods called from UI code.
  _applyWallVisibility() { return this.renderer._applyWallVisibility(); }
  _applyDoorVisibility() { return this.renderer._applyDoorVisibility(); }
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
  // Selection callbacks (main.js writes, UI reads)
  '_onTabSelect', '_onConnSelect', '_onPaletteClick',
  '_onInfraSelect', '_onWallSelect', '_onDoorSelect',
  '_onDecorationSelect', '_onZoneSelect', '_onFurnishingSelect',
  '_onDemolishSelect', '_onFacilitySelect', '_onToolSelect',
  '_onFloorSelect', '_onUtilityLineSelect',
];

for (const prop of PASS_THROUGH_PROPS) {
  Object.defineProperty(UIHost.prototype, prop, {
    get() { return this.renderer[prop]; },
    set(value) { this.renderer[prop] = value; },
    configurable: true,
  });
}
