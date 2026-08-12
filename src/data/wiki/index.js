// src/data/wiki/index.js
//
// Public interface for the in-game wiki. Everything below is pure data — no
// DOM, no framework, and no HTML beyond `bodyHtml`, which the renderer in
// markdown.js has already escaped. The UI decides how any of it looks.
//
//   WIKI_SECTIONS               table of contents
//   getArticle(id)              a hand-written article
//   getComponentPage(id)        a generated page for any placeable
//   searchWiki(query)           substring search over both
//
// Two halves feed it. Articles come from docs/infra-wiki and docs/physics-wiki
// via scripts/build-wiki.mjs, which bakes the markdown into
// articles.generated.js — run it after editing a doc, or test/test-wiki-
// content.js will tell you that you forgot. Component pages are computed from
// the live registries every time, by calling the same physics the beam solve
// calls, so no number here can disagree with the game.

import { ARTICLES } from './articles.generated.js';
import { getComponentPage } from './component-pages.js';
import { WIKI_SECTIONS } from './sections.js';
import { searchWiki } from './search.js';

const BY_ID = new Map(ARTICLES.map(a => [a.id, a]));

/**
 * `{ id, title, section, quickTip, bodyHtml }`, or null.
 *
 * `headings` rides along for a table of contents; `plain` and `collection` are
 * search/build internals and are not part of the contract.
 */
export function getArticle(id) {
  const a = BY_ID.get(id);
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    section: a.section,
    quickTip: a.quickTip,
    bodyHtml: a.bodyHtml,
    headings: a.headings,
  };
}

/** Every article id, in file order. Handy for prefetch and for tests. */
export const ARTICLE_IDS = ARTICLES.map(a => a.id);

export { WIKI_SECTIONS, getComponentPage, searchWiki };

// Extras beyond the core contract, for a UI that wants to render the ladders
// or explain a utility on its own page.
export { UTILITY_LADDERS, UTILITY_META, UTILITY_IDS, utilityInfo } from './utility-model.js';
export { DOCUMENTED_NOT_PLACEABLE } from './links.js';
export { SPECCED_NOT_PLACEABLE } from './cavity-performance.js';
