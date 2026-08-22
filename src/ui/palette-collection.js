// Pure resolver for palette tabs that intentionally reuse placeables from
// another primary category. The item's authored category remains authoritative
// for simulation, search, and normal palette ownership; linkedPlaceables only
// gives a convenient second build-menu home.

export function resolvePaletteCollection(categoryKey, categoryDef, {
  decorations = {},
  components = {},
} = {}) {
  const decorationEntries = [];
  const componentEntries = [];
  const seenDecorations = new Set();
  const seenComponents = new Set();

  const addDecoration = (id, def) => {
    if (!def || def.deprecated || seenDecorations.has(id)) return;
    seenDecorations.add(id);
    decorationEntries.push([id, def]);
  };
  const addComponent = (id, def) => {
    if (!def || def.deprecated || seenComponents.has(id)) return;
    seenComponents.add(id);
    componentEntries.push([id, def]);
  };

  for (const [id, def] of Object.entries(decorations)) {
    if (def.category === categoryKey) addDecoration(id, def);
  }

  for (const id of categoryDef?.linkedPlaceables || []) {
    if (decorations[id]) addDecoration(id, decorations[id]);
    else if (components[id]) addComponent(id, components[id]);
  }

  return {
    decorations: decorationEntries,
    components: componentEntries,
    utilityLineTools: [...new Set(categoryDef?.utilityLineTools || [])],
  };
}

/** Buildable component entries for one standard palette category. */
export function componentPaletteEntries(components = {}, categoryKey, linkedIds = []) {
  const linked = new Set(linkedIds);
  return Object.entries(components)
    .filter(([id, def]) => def && !def.deprecated
      && (def.category === categoryKey || linked.has(id)))
    .map(([key, comp]) => ({ key, comp }));
}

/**
 * Preserve authored subsection order while keeping the renderer DOM-free.
 * Entries without a subsection belong to the first section, matching the
 * established component-palette convention.
 */
export function groupDecorationPaletteEntries(entries = [], subsections = {}) {
  const keys = Object.keys(subsections);
  if (keys.length === 0) return [];
  return keys.map((key, index) => ({
    key,
    name: subsections[key]?.name || key,
    entries: entries.filter(([, def]) => def?.subsection
      ? def.subsection === key
      : index === 0),
  })).filter(section => section.entries.length > 0);
}

/**
 * A decoration with live utility ports is intentionally also present in the
 * COMPONENTS compatibility registry. Standard Infra palettes must still arm
 * its unified decoration placement tool rather than treating it as beamline
 * hardware merely because that registry supplied the entry.
 */
export function standardPaletteKind(def, isFacility = false) {
  if (def?.universalUtilityBus) return 'utilityBus';
  if (def?.kind === 'decoration') return 'decoration';
  return isFacility ? 'facility' : 'component';
}
