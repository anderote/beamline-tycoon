const DOOR_HEIGHT_SCALE = 1.5 / 14;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cssColor(color, fallback = 0x8899aa) {
  return `#${(color ?? fallback).toString(16).padStart(6, '0')}`;
}

/**
 * A small, renderer-independent description of a door thumbnail. Keeping the
 * leaf orientation here explicit lets the DOM palette and 3D wall builder
 * follow the same convention: source art has its handle on the right, so the
 * left leaf stays unmirrored and the right leaf mirrors toward the seam.
 */
export function doorPalettePreviewModel(def, texturePath = null, variant = 0) {
  const isDouble = def?.doorWidth === 'double';
  const leafCount = Math.max(0, def?.leafCount ?? (isDouble ? 2 : 1));
  const tileSpan = Math.max(1, Math.round(def?.tileSpan || 1));
  const openingWidth = tileSpan > 1 ? tileSpan * 2 : (isDouble ? 2 : 1);
  const openingHeight = Math.max(0.1, (def?.doorHeight || 14) * DOOR_HEIGHT_SCALE);
  const aspect = openingWidth / openingHeight;
  let width = 64 * aspect;
  let height = 64;
  if (width > 78) {
    height = 78 / aspect;
    width = 78;
  }

  return {
    width: Math.round(clamp(width, 24, 78)),
    height: Math.round(clamp(height, 20, 64)),
    leafCount,
    isGlass: def?.isGlassDoor === true,
    isOpen: leafCount === 0,
    frameColor: cssColor(def?.topColor),
    leafColor: cssColor(
      def?.variantPreviewColors?.[variant] ?? def?.variantTints?.[variant] ?? def?.color,
    ),
    glassColor: cssColor(
      def?.variantGlassColors?.[variant] ?? def?.doorWindow?.glassColor ?? def?.glassColor,
      0xcfe8f5,
    ),
    glassOpacity: clamp(
      def?.variantGlassOpacities?.[variant]
        ?? def?.doorWindow?.glassOpacity ?? def?.glassOpacity ?? 0.2,
      0.08,
      0.8,
    ),
    doorWindow: def?.doorWindow || null,
    leaves: Array.from({ length: leafCount }, (_, index) => ({
      index,
      texturePath,
      mirrored: leafCount === 2 && index === 1,
      handleAtSeam: leafCount === 2,
      handleSide: index === 0 ? 'right' : 'left',
    })),
  };
}

/** Build the door-specific palette icon inside an existing .palette-preview. */
export function renderDoorPalettePreview(previewEl, def, texturePath = null, variant = 0) {
  const model = doorPalettePreviewModel(def, texturePath, variant);
  previewEl.replaceChildren();

  const icon = document.createElement('div');
  icon.className = 'door-palette-icon';
  if (model.isOpen) icon.classList.add('door-palette-icon-open');
  icon.style.width = `${model.width}px`;
  icon.style.height = `${model.height}px`;
  icon.style.borderColor = model.frameColor;

  for (const leafModel of model.leaves) {
    const leaf = document.createElement('div');
    leaf.className = 'door-palette-leaf';
    leaf.style.backgroundColor = model.leafColor;
    if (model.isGlass) {
      leaf.classList.add('door-palette-leaf-glass');
      leaf.style.backgroundColor = model.glassColor;
      leaf.style.opacity = `${model.glassOpacity}`;
    }

    if (leafModel.texturePath) {
      const img = document.createElement('img');
      img.src = leafModel.texturePath;
      img.alt = '';
      if (leafModel.mirrored) img.classList.add('door-palette-leaf-mirrored');
      leaf.appendChild(img);
    }

    if (model.doorWindow && !model.isGlass) {
      const pane = document.createElement('span');
      pane.className = 'door-palette-window';
      pane.style.width = `${model.doorWindow.width * 100}%`;
      pane.style.height = `${model.doorWindow.height * 100}%`;
      pane.style.left = `${((model.doorWindow.centerX ?? 0.5) - model.doorWindow.width / 2) * 100}%`;
      pane.style.bottom = `${((model.doorWindow.centerY ?? 0.68) - model.doorWindow.height / 2) * 100}%`;
      pane.style.backgroundColor = model.glassColor;
      pane.style.opacity = `${model.glassOpacity}`;
      leaf.appendChild(pane);
    }

    if (leafModel.handleAtSeam) {
      const handle = document.createElement('span');
      handle.className = `door-palette-handle door-palette-handle-${leafModel.handleSide}`;
      leaf.appendChild(handle);
    }
    icon.appendChild(leaf);
  }

  previewEl.appendChild(icon);
  return model;
}
