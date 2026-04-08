// === STARTING MAP GENERATOR ===

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// All tree types available for natural placement
const LARGE_TREES = ['oakTree', 'mapleTree', 'elmTree', 'birchTree'];
const CONIFERS    = ['pineTree', 'cedarTree'];
const SMALL_TREES = ['smallTree'];
const ALL_TREES   = [...LARGE_TREES, ...CONIFERS, ...SMALL_TREES];

export function generateStartingMap(seed = 42, range = 20) {
  const rng = mulberry32(seed);
  const decorations = [];
  let nextId = 1;
  const occupied = new Set();
  const centerClearRadius = 6;

  // Generate tree cluster centers — each cluster favors a species mix
  const clusterCount = 5 + Math.floor(rng() * 6); // 5-10 clusters
  const clusters = [];
  for (let i = 0; i < clusterCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = centerClearRadius + rng() * (range - centerClearRadius);
    clusters.push({
      cx: Math.cos(angle) * dist,
      cy: Math.sin(angle) * dist,
      radius: 3 + rng() * 7,          // cluster spread (3-10 tiles)
      density: 0.3 + rng() * 0.5,     // how dense (0.3-0.8)
      // Each cluster has a dominant species type
      type: rng() < 0.6 ? 'deciduous' : (rng() < 0.6 ? 'conifer' : 'mixed'),
    });
  }

  // Place trees tile by tile
  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      const dist = Math.sqrt(col * col + row * row);
      if (dist > range + 2) continue;

      // Base probability: sparse near center, denser at edges
      let baseProbability;
      if (dist < centerClearRadius) {
        baseProbability = 0.005;
      } else {
        const edgeFactor = (dist - centerClearRadius) / (range - centerClearRadius);
        baseProbability = 0.02 + edgeFactor * 0.08;
      }

      // Add cluster influence — gaussian falloff from each cluster center
      let clusterInfluence = 0;
      let dominantCluster = null;
      for (const cluster of clusters) {
        const dx = col - cluster.cx;
        const dy = row - cluster.cy;
        const d2 = (dx * dx + dy * dy) / (cluster.radius * cluster.radius);
        const influence = cluster.density * Math.exp(-d2);
        if (influence > clusterInfluence) {
          dominantCluster = cluster;
        }
        clusterInfluence += influence;
      }

      const totalProbability = Math.min(0.7, baseProbability + clusterInfluence);

      if (rng() < totalProbability) {
        // Pick tree type based on dominant cluster
        let treeType;
        if (dominantCluster && clusterInfluence > 0.1) {
          if (dominantCluster.type === 'deciduous') {
            treeType = LARGE_TREES[Math.floor(rng() * LARGE_TREES.length)];
          } else if (dominantCluster.type === 'conifer') {
            treeType = CONIFERS[Math.floor(rng() * CONIFERS.length)];
          } else {
            treeType = ALL_TREES[Math.floor(rng() * ALL_TREES.length)];
          }
        } else {
          // Scattered trees — any type, slight bias toward large deciduous
          const r = rng();
          if (r < 0.5) treeType = LARGE_TREES[Math.floor(rng() * LARGE_TREES.length)];
          else if (r < 0.7) treeType = CONIFERS[Math.floor(rng() * CONIFERS.length)];
          else treeType = 'smallTree';
        }

        // Avoid placing trees directly adjacent
        const key = col + ',' + row;
        if (occupied.has(key)) continue;
        occupied.add(key);

        decorations.push({ id: 'dec_' + nextId++, type: treeType, col, row });

        // Mark neighbors to prevent dense clumping
        if (rng() < 0.4) {
          occupied.add((col + 1) + ',' + row);
          occupied.add((col - 1) + ',' + row);
          occupied.add(col + ',' + (row + 1));
          occupied.add(col + ',' + (row - 1));
        }
      } else if (rng() < 0.02 && dist > centerClearRadius) {
        // Occasional shrub or flower bed
        const shrubType = rng() < 0.6 ? 'shrub' : 'flowerBed';
        decorations.push({ id: 'dec_' + nextId++, type: shrubType, col, row });
      }
    }
  }

  return { decorations, nextId };
}
