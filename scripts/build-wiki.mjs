#!/usr/bin/env node
// scripts/build-wiki.mjs — bake docs/*-wiki/*.md into src/data/wiki/articles.generated.js
//
// The wiki has to work in three places that disagree about how to read a file:
// the Vite bundle (no fs), plain `node test/*.js` (no import.meta.glob), and a
// static production build (no dev server to fetch from). A generated ES module
// is the only artifact all three can import, so the markdown is parsed once
// here and committed as data.
//
//   node scripts/build-wiki.mjs           regenerate
//   node scripts/build-wiki.mjs --check   exit 1 if the committed file is stale
//
// test/test-wiki-content.js runs the --check equivalent in-process, so editing
// a doc without rebuilding fails the suite rather than silently shipping the
// old prose.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTIONS, NOT_INGESTED, parseArticle, registerSlugs,
} from '../src/data/wiki/parse-article.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'src/data/wiki/articles.generated.js');

/** Every markdown doc, parsed, in a stable order. */
export function buildArticles() {
  const files = {};
  for (const [key, spec] of Object.entries(COLLECTIONS)) {
    const dir = path.join(root, spec.dir);
    files[key] = readdirSync(dir)
      .filter(f => f.endsWith('.md') && !NOT_INGESTED.has(f)).sort()
      .map(f => ({ slug: f.replace(/\.md$/, ''), file: path.join(dir, f) }));
    registerSlugs(key, files[key].map(f => f.slug));
  }

  const articles = [];
  for (const [key, entries] of Object.entries(files)) {
    for (const { slug, file } of entries) {
      articles.push(parseArticle(key, slug, readFileSync(file, 'utf8')));
    }
  }
  return articles;
}

export function renderModule(articles) {
  const header = `// src/data/wiki/articles.generated.js
//
// GENERATED FILE — do not edit. Source: docs/infra-wiki/*.md,
// docs/physics-wiki/*.md. Regenerate with \`node scripts/build-wiki.mjs\`.
//
// ${articles.length} articles. bodyHtml is already escaped and safe to inject;
// see src/data/wiki/markdown.js for the renderer.

/* eslint-disable */
export const ARTICLES = `;
  return `${header}${JSON.stringify(articles, null, 1)};\n`;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const articles = buildArticles();
  const next = renderModule(articles);
  const check = process.argv.includes('--check');
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;

  if (check) {
    if (current === next) {
      console.log(`wiki: up to date (${articles.length} articles)`);
      process.exit(0);
    }
    console.error('wiki: articles.generated.js is STALE — run `node scripts/build-wiki.mjs`');
    process.exit(1);
  }

  writeFileSync(OUT, next);
  console.log(`wiki: wrote ${path.relative(root, OUT)} (${articles.length} articles)`);
}
