// src/data/wiki/sections.js
//
// The wiki's table of contents: two sections of hand-written articles followed
// by one section per component family, every entry generated from the live
// registry so a new placeable shows up in the wiki the moment it exists.

import { COMPONENTS } from '../components.js';
import { ARTICLES } from './articles.generated.js';
import { categoryOf, categoryTitle } from './component-pages.js';
import { NAVIGATION_ARTICLES } from './links.js';

// Reading order within each article section: concepts first, reference last.
// Anything not named here lands after these, alphabetically.
const ARTICLE_ORDER = [
  'infra-utility-networks', 'infra-infrastructure-quality', 'infra-connection-types',
  'infra-power', 'infra-vacuum', 'infra-rf-power', 'infra-cooling',
  'infra-cryogenics', 'infra-controls',
  'infra-rooms', 'infra-required-connections', 'infra-glossary',

  'physics-fundamentals',
  'physics-tier1-components', 'physics-tier1-physics',
  'physics-tier2-components', 'physics-tier2-physics',
  'physics-tier3-components', 'physics-tier3-physics',
  'physics-tier4-components', 'physics-tier4-physics',
  'physics-diagnostics-and-plots', 'physics-real-machines',
  'physics-equations', 'physics-glossary',
];

// Component families, in build order: the beam first, then what feeds it.
const CATEGORY_ORDER = [
  'source', 'optics', 'rf', 'diagnostic', 'endpoint',
  'power', 'vacuum', 'rfPower', 'cooling', 'dataControls', 'ops', 'equipment',
];

function sortByOrder(ids, order) {
  return [...ids].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

function articleSection(collection, id, title) {
  const ids = ARTICLES
    .filter(a => a.collection === collection && !NAVIGATION_ARTICLES.has(a.id))
    .map(a => a.id);
  return {
    id,
    title,
    entries: sortByOrder(ids, ARTICLE_ORDER).map((articleIdValue) => {
      const a = ARTICLES.find(x => x.id === articleIdValue);
      return { id: a.id, title: a.title, kind: 'article' };
    }),
  };
}

function componentSections() {
  const byCategory = new Map();
  for (const id of Object.keys(COMPONENTS)) {
    const cat = categoryOf(id);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(id);
  }

  return sortByOrder([...byCategory.keys()], CATEGORY_ORDER).map(cat => ({
    id: `components-${cat}`,
    title: categoryTitle(cat),
    entries: byCategory.get(cat)
      .map(id => ({
        id,
        title: COMPONENTS[id].name || id,
        // Infrastructure gets its own entry kind so the UI can style a plant
        // page differently from a beamline element's.
        kind: COMPONENTS[id].kind === 'infrastructure' ? 'infrastructure' : 'component',
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  }));
}

export const WIKI_SECTIONS = [
  articleSection('infra', 'guide-infrastructure', 'Facility Infrastructure'),
  articleSection('physics', 'guide-physics', 'Beam Physics'),
  ...componentSections(),
];
