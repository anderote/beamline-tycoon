// === STARTING MAP GENERATOR ===

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generateStartingMap(seed = 42, range = 30) {
  const rng = mulberry32(seed);
  const decorations = [];
  let nextId = 1;
  const treeTypes = ['oakTree', 'pineTree', 'smallTree'];
  const centerClearRadius = 8;

  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      const dist = Math.sqrt(col * col + row * row);
      let treeProbability;
      if (dist < centerClearRadius) {
        treeProbability = 0.02;
      } else if (dist < range * 0.5) {
        treeProbability = 0.08;
      } else if (dist < range * 0.8) {
        treeProbability = 0.15;
      } else {
        treeProbability = 0.25;
      }

      const roll = rng();
      if (roll < treeProbability) {
        const treeType = treeTypes[Math.floor(rng() * treeTypes.length)];
        decorations.push({ id: 'dec_' + nextId++, type: treeType, col, row });
      } else if (roll < treeProbability + 0.03 && dist > centerClearRadius) {
        const shrubType = rng() < 0.6 ? 'shrub' : 'flowerBed';
        decorations.push({ id: 'dec_' + nextId++, type: shrubType, col, row });
      }
    }
  }

  return { decorations, nextId };
}
