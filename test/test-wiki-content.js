// test/test-wiki-content.js — integrity of the wiki content data layer.
//
// The wiki went stale before because nothing tied the prose to the registry.
// These checks are that tie:
//
//   1. Interface shape — the four exports the UI is written against.
//   2. Every component in COMPONENTS resolves to a page, fully populated.
//   3. Every relatedArticles / links.js / UTILITY_META article id exists.
//   4. Every component id named in links.js still exists in COMPONENTS.
//   5. Every code identifier the prose quotes in backticks still exists as a
//      component, a tunable param, a stat, or a declared port param.
//   6. articles.generated.js matches the markdown on disk.
//   7. Cavity performance agrees with cavity-specs.js rather than restating it.
//
// Checks 4 and 5 are the point. 5 is what catches a doc that still calls a
// param by a name the code dropped three refactors ago.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { COMPONENTS } from '../src/data/components.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { UNITS } from '../src/data/units.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { RESEARCH, RESEARCH_EFFECT_KEYS } from '../src/data/research.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { CAVITY_SPECS, eAccMax, q0 } from '../src/beamline/cavity-specs.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';

import {
  WIKI_SECTIONS, getArticle, getComponentPage, searchWiki, ARTICLE_IDS,
  UTILITY_LADDERS,
} from '../src/data/wiki/index.js';
import {
  ARTICLE_COMPONENTS, COMPONENT_ARTICLE_OVERRIDES, CATEGORY_ARTICLES,
  SCHEMA_IDENTIFIERS, NAVIGATION_ARTICLES,
} from '../src/data/wiki/links.js';
import { UTILITY_META } from '../src/data/wiki/utility-model.js';
import { NOT_INGESTED } from '../src/data/wiki/parse-article.js';
import { buildArticles, renderModule } from '../scripts/build-wiki.mjs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const ARTICLE_ID_SET = new Set(ARTICLE_IDS);
const COMPONENT_IDS = Object.keys(COMPONENTS);

// ==========================================================================
// 1. Interface shape
// ==========================================================================
console.log('\n--- Test 1: exported interface ---');
{
  assert(Array.isArray(WIKI_SECTIONS) && WIKI_SECTIONS.length > 0, 'WIKI_SECTIONS is a non-empty array');

  const badSection = WIKI_SECTIONS.find(s => !s.id || !s.title || !Array.isArray(s.entries));
  assert(!badSection, `every section has { id, title, entries } (bad: ${badSection?.id})`);

  const KINDS = new Set(['article', 'component', 'infrastructure']);
  const badEntry = WIKI_SECTIONS.flatMap(s => s.entries).find(
    e => !e.id || !e.title || !KINDS.has(e.kind));
  assert(!badEntry, `every entry has { id, title, kind in ${[...KINDS].join('|')} } (bad: ${JSON.stringify(badEntry)})`);

  const seen = new Set();
  const dup = WIKI_SECTIONS.flatMap(s => s.entries).find((e) => {
    const key = `${e.kind === 'article' ? 'a' : 'c'}:${e.id}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  assert(!dup, `no entry appears twice (dup: ${dup?.id})`);

  assert(getArticle('does-not-exist') === null, 'getArticle returns null for an unknown id');
  assert(getComponentPage('does-not-exist') === null, 'getComponentPage returns null for an unknown id');
  assert(searchWiki('x').length === 0, 'searchWiki ignores a one-character query');
  assert(searchWiki('klystron').length > 0, 'searchWiki finds "klystron"');
  assert(searchWiki('KLYSTRON')[0].id === searchWiki('klystron')[0].id, 'searchWiki is case-insensitive');

  const hit = searchWiki('cryogenic')[0];
  assert(hit && hit.id && hit.title && hit.kind && typeof hit.snippet === 'string',
    'search results carry { id, title, kind, snippet }');
}

// ==========================================================================
// 2. Every component resolves to a page
// ==========================================================================
console.log('\n--- Test 2: a page for every component ---');
{
  const missing = COMPONENT_IDS.filter(id => !getComponentPage(id));
  assert(missing.length === 0, `all ${COMPONENT_IDS.length} components resolve (missing: ${missing.join(', ')})`);

  const problems = [];
  for (const id of COMPONENT_IDS) {
    const p = getComponentPage(id);
    if (!p.name) problems.push(`${id}: no name`);
    if (typeof p.summary !== 'string') problems.push(`${id}: summary not a string`);
    if (!Array.isArray(p.stats) || p.stats.length === 0) problems.push(`${id}: no stats`);
    if (!Array.isArray(p.utilities)) problems.push(`${id}: utilities not an array`);
    if (!Array.isArray(p.performance) || p.performance.length === 0) problems.push(`${id}: no performance`);
    if (!Array.isArray(p.curves)) problems.push(`${id}: curves not an array`);
    if (!Array.isArray(p.relatedArticles)) problems.push(`${id}: relatedArticles not an array`);
    for (const s of p.stats) {
      if (!s.label || s.value === undefined || s.unit === undefined) {
        problems.push(`${id}: malformed stat ${JSON.stringify(s)}`);
      }
    }
    for (const u of p.utilities) {
      if (!u.utility || !u.role || !u.params || !u.effect) {
        problems.push(`${id}: malformed utility row ${JSON.stringify(u)}`);
      }
      if (!UTILITY_TYPES[u.utility]) problems.push(`${id}: unknown utility ${u.utility}`);
    }
    for (const c of p.curves) {
      if (!c.title || !c.xLabel || !c.yLabel || !Array.isArray(c.points) || c.points.length < 2) {
        problems.push(`${id}: malformed curve ${c.title}`);
      }
      // Both axes are numeric on every curve, so the UI can plot them all the
      // same way — anything categorical belongs in `performance` instead.
      for (const pt of c.points || []) {
        if (!Array.isArray(pt) || pt.length !== 2
            || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
          problems.push(`${id}/${c.title}: bad point ${JSON.stringify(pt)}`);
        }
      }
    }
  }
  assert(problems.length === 0, `every page is fully populated (${problems.slice(0, 8).join(' | ')})`);

  // Every port a component declares has to be visible on its page — a silent
  // omission here is how a player ends up with an unconnected sink they were
  // never told about.
  const dropped = [];
  for (const id of COMPONENT_IDS) {
    const declared = new Set(Object.values(getUtilityPortsV2(id)).map(p => `${p.utility}:${p.role}`));
    const shown = new Set(getComponentPage(id).utilities.map(u => `${u.utility}:${u.role}`));
    for (const d of declared) if (!shown.has(d)) dropped.push(`${id} ${d}`);
  }
  assert(dropped.length === 0, `no declared port is missing from its page (${dropped.join(', ')})`);
}

// ==========================================================================
// 3. Article references resolve
// ==========================================================================
console.log('\n--- Test 3: article references resolve ---');
{
  const bad = [];
  for (const id of COMPONENT_IDS) {
    for (const aid of getComponentPage(id).relatedArticles) {
      if (!ARTICLE_ID_SET.has(aid)) bad.push(`${id} → ${aid}`);
    }
  }
  assert(bad.length === 0, `every relatedArticles id exists (${bad.join(', ')})`);

  const emptyRelated = COMPONENT_IDS.filter(id => getComponentPage(id).relatedArticles.length === 0);
  assert(emptyRelated.length === 0, `every page links somewhere (${emptyRelated.join(', ')})`);

  const badLinkKeys = Object.keys(ARTICLE_COMPONENTS).filter(a => !ARTICLE_ID_SET.has(a));
  assert(badLinkKeys.length === 0, `ARTICLE_COMPONENTS keys are real articles (${badLinkKeys.join(', ')})`);

  const badOverrides = Object.entries(COMPONENT_ARTICLE_OVERRIDES)
    .flatMap(([cid, ids]) => ids.filter(a => !ARTICLE_ID_SET.has(a)).map(a => `${cid} → ${a}`));
  assert(badOverrides.length === 0, `COMPONENT_ARTICLE_OVERRIDES targets exist (${badOverrides.join(', ')})`);

  const badCategory = Object.entries(CATEGORY_ARTICLES)
    .flatMap(([cat, ids]) => ids.filter(a => !ARTICLE_ID_SET.has(a)).map(a => `${cat} → ${a}`));
  assert(badCategory.length === 0, `CATEGORY_ARTICLES targets exist (${badCategory.join(', ')})`);

  const badUtility = Object.entries(UTILITY_META)
    .filter(([, m]) => !ARTICLE_ID_SET.has(m.article))
    .map(([u, m]) => `${u} → ${m.article}`);
  assert(badUtility.length === 0, `UTILITY_META article ids exist (${badUtility.join(', ')})`);

  const listed = new Set(WIKI_SECTIONS.flatMap(s => s.entries)
    .filter(e => e.kind === 'article').map(e => e.id));
  const unlisted = ARTICLE_IDS.filter(a => !listed.has(a) && !NAVIGATION_ARTICLES.has(a));
  assert(unlisted.length === 0, `every content article is in the contents (${unlisted.join(', ')})`);
}

// ==========================================================================
// 4. No article claims a component that no longer exists
// ==========================================================================
console.log('\n--- Test 4: articles do not reference dead components ---');
{
  const dead = [];
  for (const [articleIdValue, ids] of Object.entries(ARTICLE_COMPONENTS)) {
    for (const cid of ids) if (!COMPONENTS[cid]) dead.push(`${articleIdValue} → ${cid}`);
  }
  assert(dead.length === 0,
    `every component named in links.js exists — rewrite the article if one was removed (${dead.join(', ')})`);

  const deadOverride = Object.keys(COMPONENT_ARTICLE_OVERRIDES).filter(cid => !COMPONENTS[cid]);
  assert(deadOverride.length === 0,
    `COMPONENT_ARTICLE_OVERRIDES keys still exist (${deadOverride.join(', ')})`);

  const categories = new Set(COMPONENT_IDS.map(id => COMPONENTS[id].category).filter(Boolean));
  const deadCategory = Object.keys(CATEGORY_ARTICLES).filter(c => !categories.has(c));
  assert(deadCategory.length === 0, `CATEGORY_ARTICLES keys are live categories (${deadCategory.join(', ')})`);
}

// ==========================================================================
// 5. Identifiers quoted in the prose still exist in the code
// ==========================================================================
console.log('\n--- Test 5: prose identifiers exist in the registries ---');
{
  // Vocabulary, derived from the live registries so it can never go stale.
  const vocabulary = new Set([
    ...COMPONENT_IDS,
    ...Object.keys(UTILITY_TYPES),
    ...Object.keys(UNITS),
    ...Object.keys(CAVITY_SPECS),
    // PARAM_DEFS keys are element types the physics models, several of which
    // the tier articles document before they are placeable. That is design
    // documentation, not staleness.
    ...Object.keys(PARAM_DEFS),
    ...Object.keys(RESEARCH),
    ...RESEARCH_EFFECT_KEYS,
    ...OBJECTIVES.map(o => o.id),
    ...SCHEMA_IDENTIFIERS,
  ]);
  for (const defs of Object.values(PARAM_DEFS)) for (const k of Object.keys(defs)) vocabulary.add(k);
  for (const c of Object.values(COMPONENTS)) {
    for (const k of Object.keys(c.stats || {})) vocabulary.add(k);
    for (const k of Object.keys(c.params || {})) vocabulary.add(k);
    for (const k of Object.keys(c.effects || {})) vocabulary.add(k);
  }
  for (const id of COMPONENT_IDS) {
    for (const port of Object.values(getUtilityPortsV2(id))) {
      for (const k of Object.keys(port.params || {})) vocabulary.add(k);
      for (const k of Object.keys(port)) vocabulary.add(k);
    }
  }

  const docDirs = ['docs/infra-wiki', 'docs/physics-wiki'];
  const unknown = [];
  for (const dir of docDirs) {
    const docs = readdirSync(dir).filter(f => f.endsWith('.md') && !NOT_INGESTED.has(f));
    for (const file of docs) {
      const text = readFileSync(path.join(dir, file), 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        const token = m[1].trim();
        // Only camelCase code identifiers — physics prose is full of `x'`,
        // `beta_0` and `sigma_x(s)`, none of which name anything in the code.
        if (!/^[a-z][A-Za-z0-9]*$/.test(token) || !/[A-Z]/.test(token)) continue;
        if (!vocabulary.has(token)) unknown.push(`${file}: \`${token}\``);
      }
    }
  }
  assert(unknown.length === 0,
    'every camelCase identifier the docs quote exists in the code — '
    + `fix the doc or add it to SCHEMA_IDENTIFIERS (${[...new Set(unknown)].join(', ')})`);
}

// ==========================================================================
// 6. The generated module matches the markdown on disk
// ==========================================================================
console.log('\n--- Test 6: articles.generated.js is current ---');
{
  const onDisk = readFileSync('src/data/wiki/articles.generated.js', 'utf8');
  const expected = renderModule(buildArticles());
  assert(onDisk === expected,
    'articles.generated.js matches docs/*-wiki — run `node scripts/build-wiki.mjs`');

  const noTip = ARTICLE_IDS.filter(id => !getArticle(id).quickTip);
  assert(noTip.length === 0, `every article has a quickTip (${noTip.join(', ')})`);

  const noBody = ARTICLE_IDS.filter(id => (getArticle(id).bodyHtml || '').length < 200);
  assert(noBody.length === 0, `every article has a body (${noBody.join(', ')})`);

  // "The Math" sections are tables and code blocks; losing them in the render
  // would quietly gut half the wiki.
  const withTables = ARTICLE_IDS.filter(id => getArticle(id).bodyHtml.includes('<table>'));
  assert(withTables.length >= 8, `pipe tables survive the render (${withTables.length} articles)`);
  const withCode = ARTICLE_IDS.filter(id => getArticle(id).bodyHtml.includes('<pre><code'));
  assert(withCode.length >= 8, `fenced code survives the render (${withCode.length} articles)`);

  const unescaped = ARTICLE_IDS.filter((id) => {
    const html = getArticle(id).bodyHtml;
    // Every tag we emit is from a fixed set; anything else means author text
    // reached the output unescaped.
    return /<(?!\/?(h[1-6]|p|a|em|strong|code|pre|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|hr)[\s>/])/i.test(html);
  });
  assert(unescaped.length === 0, `no unescaped markup reaches bodyHtml (${unescaped.join(', ')})`);
}

// ==========================================================================
// 7. Cavity numbers come from the physics, not from a copy of it
// ==========================================================================
console.log('\n--- Test 7: cavity performance tracks cavity-specs ---');
{
  const cavityIds = Object.keys(CAVITY_SPECS).filter(id => COMPONENTS[id]);
  assert(cavityIds.length >= 8, `${cavityIds.length} cavities have both a spec and a component`);

  for (const id of cavityIds) {
    const page = getComponentPage(id);
    assert(page.curves.length > 0, `${id}: has at least one curve`);
    const spec = CAVITY_SPECS[id];

    // Sample a curve point and recompute it from the physics module directly.
    const gradientCurve = page.curves.find(c => c.yLabel.includes('gradient'));
    if (gradientCurve) {
      const t = /(\d+\.\d+) K/.exec(gradientCurve.title);
      const tempK = t ? Number(t[1]) : null;
      const [x, y] = gradientCurve.points[gradientCurve.points.length - 1];
      const direct = eAccMax(x, spec, tempK);
      // The x this reads back is the PLOTTED power, stored to 4 significant
      // figures, so it is up to 5e-4 off the power the y was computed at.
      // Gradient goes as sqrt(P), so the recomputed y inherits half of that —
      // an error that scales with the gradient and therefore cannot be caught
      // by a fixed absolute tolerance. 0.05 MV/m is nothing on a 20 MV/m
      // cryomodule and smaller than the axis rounding on a 300 MV/m sector.
      const tol = Math.max(0.05, Math.abs(direct) * 1e-3);
      assert(Math.abs(direct - y) < tol,
        `${id}: curve endpoint ${y} MV/m matches eAccMax(${x} W) = ${direct.toFixed(3)}`);
    }
  }

  // The headline SRF fact: sqrt(P), and Q0 collapsing with temperature.
  const cm = CAVITY_SPECS.cryomodule;
  assert(Math.abs(eAccMax(400, cm, 2.0) / eAccMax(100, cm, 2.0) - 2) < 1e-9,
    'gradient goes as sqrt(P): 4x the power is exactly 2x the gradient');
  assert(q0(2.0, cm) / q0(4.5, cm) > 20,
    `Q0 at 2.0 K is ${Math.round(q0(2.0, cm) / q0(4.5, cm))}x its 4.5 K value`);

  const cmPage = getComponentPage('cryomodule');
  assert(cmPage.performance.some(p => /Q₀ at 2\.0 K/.test(p.label)),
    'the cryomodule page quotes Q0 at 2.0 K');
  assert(cmPage.performance.some(p => /Quench temperature/.test(p.label)),
    'the cryomodule page quotes the quench temperature');
  assert(cmPage.utilities.some(u => u.utility === 'cryoTransfer' && /quench/i.test(u.effect)),
    'the cryomodule cryo row explains the quench mechanic');

  // Ladders are derived, so every source component must land on exactly one.
  for (const [utility, rungs] of Object.entries(UTILITY_LADDERS)) {
    const ids = new Set(rungs.map(r => r.id));
    assert(ids.size === rungs.length, `${utility}: ladder has no duplicate rungs`);
    const ascending = rungs.every((r, i) => i === 0 || r.capacity >= rungs[i - 1].capacity);
    assert(ascending, `${utility}: ladder is ordered by capacity`);
  }

  const coolingLadder = UTILITY_LADDERS.coolingWater;
  assert(coolingLadder.find(r => r.id === 'chiller')?.capacity === 300,
    'multi-port cooling ladder adds outlet shares back to the 300 kW nameplate');
  const makeUpPage = getComponentPage('waterTank');
  const mainPage = getComponentPage('facilityWaterSupply');
  const bulkPage = getComponentPage('bulkWaterTank');
  assert(makeUpPage.performance.some(p => p.label === 'Make-up flow' && p.value === 1)
      && makeUpPage.performance.some(p => p.label === 'Water storage' && p.value === 500),
    'make-up tank wiki page publishes both water capabilities');
  assert(mainPage.performance.some(p => p.label === 'Make-up flow' && p.value === 20)
      && !mainPage.performance.some(p => p.label === 'Water storage'),
    'water replenishment plant wiki page publishes flow without storage');
  assert(bulkPage.performance.some(p => p.label === 'Water storage' && p.value === 5000)
      && !bulkPage.performance.some(p => p.label === 'Make-up flow'),
    'bulk tank wiki page publishes passive storage without generation');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
