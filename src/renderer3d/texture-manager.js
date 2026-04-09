// === TEXTURE MANAGER ===
// Loads and caches THREE.Texture instances for all game assets.
// Replaces PIXI.Assets loading from SpriteManager for the Three.js renderer.
// Note: THREE is a CDN global — not imported.

export class TextureManager {
  constructor() {
    /** @type {Map<string, THREE.Texture>} Cache keyed by file path */
    this._cache = new Map();

    /** @type {THREE.TextureLoader} */
    this._loader = new THREE.TextureLoader();

    // Per-gameId tile info, populated by loadTileManifest()
    this._tileInfo = new Map(); // gameId -> { texture, variants, floorVariants, variantTints }
  }

  // ---------------------------------------------------------------------------
  // Core load / get
  // ---------------------------------------------------------------------------

  /**
   * Load a texture by file path. Returns a cached texture if already loaded.
   * @param {string} path
   * @returns {Promise<THREE.Texture|null>}
   */
  async load(path) {
    if (this._cache.has(path)) {
      return this._cache.get(path);
    }
    try {
      const texture = await this._loader.loadAsync(path);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      this._cache.set(path, texture);
      return texture;
    } catch (e) {
      console.warn(`TextureManager: failed to load "${path}"`, e);
      return null;
    }
  }

  /**
   * Return a cached texture synchronously, or null if not yet loaded.
   * @param {string} path
   * @returns {THREE.Texture|null}
   */
  get(path) {
    return this._cache.get(path) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Manifest loaders
  // ---------------------------------------------------------------------------

  /**
   * Fetch assets/tiles/tile-manifest.json and load all referenced textures.
   * Populates internal tileInfo map for use via getTileInfo().
   */
  async loadTileManifest() {
    try {
      const resp = await fetch('assets/tiles/tile-manifest.json');
      if (!resp.ok) {
        console.warn('TextureManager: tile-manifest.json not found');
        return;
      }
      const manifest = await resp.json();
      let count = 0;

      for (const [gameId, info] of Object.entries(manifest)) {
        const entry = {
          texture: null,
          variants: [],      // zone variant textures (from info.files)
          floorVariants: [], // floor color variant textures (from info.variants)
          variantTints: info.variantTints ?? [],
        };

        if (info.files) {
          // Zone tiles — multiple variant textures
          for (const filePath of info.files) {
            const tex = await this.load(filePath);
            if (tex) { entry.variants.push(tex); count++; }
          }
          // Use first variant as primary texture
          entry.texture = entry.variants[0] ?? null;

        } else if (info.file) {
          // Flooring — single primary texture plus optional color variants
          const tex = await this.load(info.file);
          if (tex) { entry.texture = tex; count++; }

          if (info.variants) {
            for (const variant of info.variants) {
              const vTex = await this.load(variant.file);
              if (vTex) { entry.floorVariants.push(vTex); count++; }
            }
          }
        }

        this._tileInfo.set(gameId, entry);
      }

      console.log(`TextureManager: loaded ${count} tile textures`);
    } catch (e) {
      console.warn('TextureManager: error loading tile manifest', e);
    }
  }

  /**
   * Fetch assets/decorations/decoration-manifest.json and load all textures.
   */
  async loadDecorationManifest() {
    try {
      const resp = await fetch('assets/decorations/decoration-manifest.json');
      if (!resp.ok) {
        console.warn('TextureManager: decoration-manifest.json not found');
        return;
      }
      const manifest = await resp.json();
      let count = 0;

      for (const [, info] of Object.entries(manifest)) {
        const tex = await this.load(info.file);
        if (tex) count++;
      }

      console.log(`TextureManager: loaded ${count} decoration textures`);
    } catch (e) {
      console.warn('TextureManager: error loading decoration manifest', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Return tile info for an infrastructure type (gameId).
   * @param {string} gameId
   * @returns {{ texture: THREE.Texture|null, variants: THREE.Texture[], floorVariants: THREE.Texture[], variantTints: any[] }|null}
   */
  getTileInfo(gameId) {
    return this._tileInfo.get(gameId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Dispose all cached textures and clear the cache.
   */
  dispose() {
    for (const texture of this._cache.values()) {
      texture.dispose();
    }
    this._cache.clear();
    this._tileInfo.clear();
  }
}
