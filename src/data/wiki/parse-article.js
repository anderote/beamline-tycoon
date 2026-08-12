// src/data/wiki/parse-article.js
//
// Turns one of the player-facing markdown docs into the article record the
// wiki UI consumes. Shared by scripts/build-wiki.mjs (which bakes the result
// into articles.generated.js) and by test/test-wiki-content.js (which parses
// the live docs so its checks can never be fooled by a stale build).
//
// The docs carry their Quick Tip in three shapes and all three have to
// survive: a `## Quick Tip` section, a `> **Quick Tip:**` blockquote above the
// first topic, and — in docs/physics-wiki, where one file holds several `##`
// topics — an inline `**Quick Tip:**` under each topic. The first two are
// article-level and get lifted out of the body (the UI renders the tip as its
// own callout); the third is left in place, because removing it would orphan
// the topic it belongs to.

import { renderMarkdown, markdownToPlain } from './markdown.js';

/** Collection prefixes keep infra-wiki/glossary.md and physics-wiki/glossary.md apart. */
export const COLLECTIONS = {
  infra: { dir: 'docs/infra-wiki', prefix: 'infra', title: 'Facility Infrastructure' },
  physics: { dir: 'docs/physics-wiki', prefix: 'physics', title: 'Beam Physics' },
};

/**
 * Docs that are maintenance records rather than content. AUDIT.md is a work
 * log of prose corrected against source — it names internal functions and
 * historical field names on purpose, so ingesting it would put engineering
 * notes in front of players and drag every retired identifier into the wiki's
 * vocabulary check.
 */
export const NOT_INGESTED = new Set(['AUDIT.md', 'TODO.md']);

export function articleId(collection, slug) {
  return `${COLLECTIONS[collection].prefix}-${slug}`;
}

/**
 * Opening sentence of the first real paragraph. Reference articles (glossary,
 * equations) open with a one-word heading, so scan past anything too short to
 * be prose rather than taking line one.
 */
function openingSentence(plain) {
  const para = plain.split('\n').map(l => l.trim()).find(l => l.length >= 40) || '';
  const m = para.match(/^(.{20,240}?[.!?])(\s|$)/);
  return (m ? m[1] : para.slice(0, 200)).trim();
}

const TIP_LINE = /^\s*>?\s*\*\*Quick Tip:\*\*\s*/;

/**
 * Parse one document.
 *
 * `source` is the raw markdown, `slug` the filename stem, `collection` one of
 * the COLLECTIONS keys. Returns
 * `{ id, title, section, collection, slug, quickTip, bodyHtml, plain, headings }`.
 */
export function parseArticle(collection, slug, source) {
  const text = String(source).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  // Title: the leading H1, which is then dropped from the body so the UI can
  // own the page header.
  let title = slug;
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const h1 = lines[i].match(/^#\s+(.*)$/);
    if (h1) { title = h1[1].trim(); start = i + 1; }
    break;
  }
  let body = lines.slice(start);

  // Shape 1 — a dedicated `## Quick Tip` section. Lift it out entirely.
  let quickTip = null;
  const tipHeading = body.findIndex(l => /^##\s+Quick Tip\s*$/i.test(l));
  if (tipHeading !== -1) {
    let end = tipHeading + 1;
    while (end < body.length && !/^#{1,6}\s/.test(body[end])) end++;
    quickTip = markdownToPlain(body.slice(tipHeading + 1, end).join('\n')).replace(/\s+/g, ' ').trim();
    body = [...body.slice(0, tipHeading), ...body.slice(end)];
  }

  // Shape 2 — a `> **Quick Tip:**` blockquote standing above the first topic.
  // Article-level, so lift it out the same way.
  if (!quickTip) {
    const firstTopic = body.findIndex(l => /^#{2,6}\s/.test(l));
    const quoted = body.findIndex(l => /^\s*>\s*\*\*Quick Tip:\*\*/.test(l));
    if (quoted !== -1 && (firstTopic === -1 || quoted < firstTopic)) {
      let end = quoted + 1;
      while (end < body.length && /^\s*>/.test(body[end])) end++;
      quickTip = markdownToPlain(
        body.slice(quoted, end).join(' ').replace(TIP_LINE, ''),
      ).replace(/\s+/g, ' ').trim();
      body = [...body.slice(0, quoted), ...body.slice(end)];
    }
  }

  // Shape 3 — inline `**Quick Tip:**` per topic. Use the first as the
  // article-level tip but leave every one of them in the body.
  if (!quickTip) {
    const inlineTip = body.find(l => TIP_LINE.test(l));
    if (inlineTip) {
      quickTip = markdownToPlain(inlineTip.replace(TIP_LINE, ''))
        .replace(/\s+/g, ' ').trim();
    }
  }

  const plain = markdownToPlain(body.join('\n'));

  // Shape 4 — reference articles (glossary, equations, real machines) carry no
  // tip at all. Their opening sentence is a better summary than nothing.
  if (!quickTip) quickTip = openingSentence(plain);

  const resolve = (linkSlug) => {
    // Prefer a sibling in the same tree; docs cross-link within a collection
    // far more often than across, and only READMEs link out.
    for (const key of [collection, ...Object.keys(COLLECTIONS).filter(k => k !== collection)]) {
      if (KNOWN_SLUGS[key] && KNOWN_SLUGS[key].has(linkSlug)) return articleId(key, linkSlug);
    }
    return null;
  };

  const { html, headings } = renderMarkdown(body.join('\n'), resolve);

  return {
    id: articleId(collection, slug),
    title,
    section: COLLECTIONS[collection].title,
    collection,
    slug,
    quickTip,
    bodyHtml: html,
    plain,
    headings,
  };
}

// Populated by the caller before parsing so `*.md` cross-links can resolve to
// article ids. Left empty, links degrade to their label text.
export const KNOWN_SLUGS = {};

export function registerSlugs(collection, slugs) {
  KNOWN_SLUGS[collection] = new Set(slugs);
}
