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
