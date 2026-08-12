// src/data/wiki/search.js
//
// Substring search across article prose and component catalogue text. No index
// structure and no fuzzy matching: 27 articles plus 140 components is a few
// hundred kilobytes of text, and a linear scan over it is faster than the
// keystroke that triggered it.
//
// Ranking is by where the hit lands, not how often — a player typing "klystron"
// wants the Pulsed Klystron page, not the sentence in rf-power.md that happens
// to mention it four times.

import { COMPONENTS } from '../components.js';
import { ARTICLES } from './articles.generated.js';
import { NAVIGATION_ARTICLES } from './links.js';

const SNIPPET_RADIUS = 90;

/** Text around the first hit, with word boundaries tidied up. */
function snippetAround(text, index, query) {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS);
  let slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) slice = `…${slice.replace(/^\S*\s/, '')}`;
  if (end < text.length) slice = `${slice.replace(/\s\S*$/, '')}…`;
  return slice;
}

function scoreFor(needle, { id, title, body }) {
  const t = title.toLowerCase();
  if (t === needle) return 100;
  if (t.startsWith(needle)) return 80;
  if (id.toLowerCase() === needle) return 90;
  if (t.includes(needle)) return 60;
  const at = body.indexOf(needle);
  if (at !== -1) return 30;
  return 0;
}

/**
 * `[{ id, title, kind, snippet }]`, best first. Empty for a query under two
 * characters — a single letter matches everything and helps nobody.
 */
export function searchWiki(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return [];

  const results = [];

  for (const a of ARTICLES) {
    if (NAVIGATION_ARTICLES.has(a.id)) continue;
    const body = a.plain.toLowerCase();
    const score = scoreFor(needle, { id: a.id, title: a.title, body });
    if (!score) continue;
    const at = body.indexOf(needle);
    results.push({
      id: a.id,
      title: a.title,
      kind: 'article',
      snippet: at !== -1 ? snippetAround(a.plain, at, needle) : (a.quickTip || ''),
      score,
      section: a.section,
    });
  }

  for (const [id, c] of Object.entries(COMPONENTS)) {
    const desc = c.desc || '';
    const body = `${id} ${desc}`.toLowerCase();
    const score = scoreFor(needle, { id, title: c.name || id, body });
    if (!score) continue;
    const at = desc.toLowerCase().indexOf(needle);
    results.push({
      id,
      title: c.name || id,
      kind: c.kind === 'infrastructure' ? 'infrastructure' : 'component',
      snippet: at !== -1 ? snippetAround(desc, at, needle) : desc.slice(0, 160),
      score: score + 5, // a component page answers "what is this thing" directly
      section: c.category || 'equipment',
    });
  }

  return results
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .map(({ score, ...rest }) => rest);
}
