// test/test-advisor.js — the advice bus behind Stubby.
//
// The bus exists because the game computes plenty of advice and says almost
// none of it: utility faults land in state.infraBlockers, the physics engine
// reports dispersionWarnings, the focus advisor produces ghostQuads, and
// tutorial.js carries a hint per step — each surfaced in one view, in one
// format, if at all.
//
// Everything here is pure by construction. Rules read a context snapshot and
// never touch `game`, which is what makes them testable at all; a rule that
// reached into live state could not be exercised against a fixture and could
// mutate the facility it is meant to be commenting on.
//
// Coverage:
//   1. context tolerates a half-booted game (the tick starts before Pyodide
//      and before the utility gate has ever solved).
//   2. every rule fires on a context built to trigger it, and stays quiet on
//      one built not to.
//   3. ranking: blockers outrank warnings outrank tips; ties break on
//      declaration order.
//   4. dismissal is scoped to the advice KEY, so silencing one unwired magnet
//      leaves its neighbour still speaking.
//   5. cooldown expiry brings a persistent problem back.
//   6. silence persists across a JSON round trip; dismissals deliberately
//      do not.
//   7. a rule that throws does not take the rest of the table down with it.
//   8. sprite frames are distinguishable from idle.
//   9. every advice can disable Stubby through the durable global Off level.

import {
  ADVICE_LEVELS,
  ADVICE_LEVEL_STORAGE_KEY,
  AdvisorEngine,
  SEVERITY_RANK,
} from '../src/advisor/engine.js';
import { ADVICE_RULES } from '../src/advisor/rules.js';
import { buildAdvisorContext } from '../src/advisor/context.js';
import { STUBBY_FRAMES } from '../src/ui/stubby-sprite.js';
import {
  STUBBY_INTRODUCTION,
  STUBBY_INTRODUCTION_STORAGE_KEY,
  STUBBY_TURN_OFF_LABEL,
  Stubby,
} from '../src/ui/Stubby.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A context with nothing wrong: every rule should stay silent. */
function quietContext(over = {}) {
  return {
    tick: 0,
    funding: 100000, income: 100, expenses: 50, net: 50,
    blockers: [],
    beamRunning: true, placeableCount: 5, beamlineCount: 1, placementCount: 5,
    designerOpen: false, ghostQuads: [], dispersionWarnings: [],
    draftLength: 0, draftQuadCount: 0,
    tutorial: { nextStep: null },
    ...over,
  };
}

const ruleById = (id) => ADVICE_RULES.find(r => r.id === id);

console.log('1. context survives a half-booted game');
{
  let ctx = null;
  let threw = null;
  try {
    ctx = buildAdvisorContext({}, null);
  } catch (e) {
    threw = e;
  }
  check('buildAdvisorContext({}) does not throw', !threw, threw && threw.message);
  if (ctx) {
    check('defaults blockers to an empty array', Array.isArray(ctx.blockers) && ctx.blockers.length === 0);
    check('defaults ghostQuads to an empty array', Array.isArray(ctx.ghostQuads));
    check('defaults numerics to 0', ctx.tick === 0 && ctx.funding === 0);
    check('reports the designer as closed', ctx.designerOpen === false);
  }
  let threw2 = null;
  try {
    buildAdvisorContext({ state: { placeables: null, beamPipes: null } }, { isOpen: true });
  } catch (e) { threw2 = e; }
  check('tolerates null collections on state', !threw2, threw2 && threw2.message);

  // The shapes below are the REAL ones the game publishes, not convenient
  // stand-ins. An earlier version of this file asserted against an invented
  // array shape for unwiredSinks and so happily passed while the context threw
  // on every tick in the actual game — the fixture agreed with the bug.
  // utility-gate.js builds unwiredSinks as { [placeableId]: { [utility]: true } }.
  let threw3 = null;
  try {
    buildAdvisorContext({
      state: {
        tick: 5,
        unwiredSinks: { p1: { powerCable: true }, p2: { vacuumPipe: true } },
        infraBlockers: [{
          severity: 'hard', code: 'power_unconnected',
          message: 'quadrupole pwr_in not connected to powerCable',
          location: { placeableId: 'p1', portName: 'pwr_in' },
        }],
        resources: { funding: 1000 },
      },
    }, null);
  } catch (e) { threw3 = e; }
  check('survives the REAL unwiredSinks object shape', !threw3, threw3 && threw3.message);

  const real = threw3 ? null : buildAdvisorContext({
    state: {
      tick: 5,
      unwiredSinks: { p1: { powerCable: true } },
      infraBlockers: [{
        severity: 'hard', code: 'power_unconnected', message: 'm',
        location: { placeableId: 'p1', portName: 'pwr_in' },
      }],
    },
  }, null);
  if (real) {
    check('lifts placeableId and portName off blocker.location',
      real.blockers[0].placeableId === 'p1' && real.blockers[0].portName === 'pwr_in',
      JSON.stringify(real.blockers[0]));
  }
}

console.log('2. every rule fires when it should and not when it should not');
{
  // A quiet context must produce nothing at all — this is the check that
  // catches a rule whose predicate is accidentally always-true.
  const engine = new AdvisorEngine();
  const quiet = engine.evaluate(quietContext());
  check('a healthy facility gets no advice', quiet === null,
    quiet && `got "${quiet.ruleId}"`);

  const cases = [
    ['utilities.unstaffed',
      quietContext({ blockers: [{ code: 'beam_unstaffed', message: 'No operator on shift.' }] })],
    ['utilities.powerCable-unconnected',
      quietContext({ blockers: [{ code: 'power_unconnected', message: 'x', placeableId: 'p1', portName: 'pwr_in' }] })],
    ['utilities.vacuumPipe-unconnected',
      quietContext({ blockers: [{ code: 'vacuum_unconnected', message: 'x', placeableId: 'p2' }] })],
    ['utilities.coolingWater-unconnected',
      quietContext({ blockers: [{ code: 'cooling_unconnected', message: 'x', placeableId: 'p3' }] })],
    ['utilities.rfWaveguide-unconnected',
      quietContext({ blockers: [{ code: 'rf_unconnected', message: 'x', placeableId: 'p4' }] })],
    ['utilities.cryoTransfer-unconnected',
      quietContext({ blockers: [{ code: 'cryo_unconnected', message: 'x', placeableId: 'p5' }] })],
    ['utilities.hvCable-unconnected',
      quietContext({ blockers: [{ code: 'hv_unconnected', message: 'x', placeableId: 'p6' }] })],
    ['optics.no-quads',
      quietContext({ designerOpen: true, draftLength: 40, draftQuadCount: 0 })],
    ['optics.needs-focusing',
      quietContext({ designerOpen: true, draftQuadCount: 2, ghostQuads: [{ s: 14, nodeIndex: 3, polarity: 1 }] })],
    ['optics.dispersion',
      quietContext({ designerOpen: true, dispersionWarnings: [{ elementIndex: 4, elementType: 'drift', etaX: 0.8, s: 22 }] })],
    ['economy.burning-cash',
      quietContext({ funding: 1000, net: -100 })],
    ['tutorial.next-step',
      quietContext({ tutorial: { nextStep: { id: 'tut-quads', name: 'Focus with Quadrupoles', hint: 'Place a quad.', group: 'beamline' } } })],
    ['economy.idle-funding',
      quietContext({ funding: 5000000, net: 200 })],
  ];

  for (const [id, ctx] of cases) {
    const rule = ruleById(id);
    if (!rule) { check(`rule ${id} exists`, false); continue; }
    const fired = rule.when(ctx);
    check(`${id} fires`, !!fired);
    if (fired) {
      let text = null;
      try { text = rule.say(ctx, fired); } catch (e) { /* reported below */ }
      check(`${id} produces a title and body`,
        !!(text && text.title && text.body), text ? JSON.stringify(text) : 'say() threw');
    }
    check(`${id} stays quiet on a healthy facility`, !rule.when(quietContext()));
  }

  check('the table has 13 rules (7 blockers, 4 warnings, 2 tips)',
    ADVICE_RULES.length === 13, `got ${ADVICE_RULES.length}`);
  check('every rule declares a known severity',
    ADVICE_RULES.every(r => SEVERITY_RANK[r.severity] > 0),
    ADVICE_RULES.filter(r => !SEVERITY_RANK[r.severity]).map(r => r.id).join(','));
  check('rule ids are unique',
    new Set(ADVICE_RULES.map(r => r.id)).size === ADVICE_RULES.length);
}

console.log('3. ranking');
{
  const engine = new AdvisorEngine();
  const ctx = quietContext({
    blockers: [{ code: 'power_unconnected', message: 'x', placeableId: 'p1' }],
    designerOpen: true, draftLength: 40, draftQuadCount: 0,
    tutorial: { nextStep: { id: 't1', name: 'Step', hint: 'Do it.', group: 'beamline' } },
  });
  const top = engine.evaluate(ctx);
  check('a blocker outranks a warning and a tip',
    top && top.severity === 'blocker', top && `${top.ruleId} (${top.severity})`);

  const warnOnly = engine.evaluate(quietContext({
    designerOpen: true, draftLength: 40, draftQuadCount: 0,
    tutorial: { nextStep: { id: 't1', name: 'Step', hint: 'Do it.', group: 'beamline' } },
  }));
  check('a warning outranks a tip',
    warnOnly && warnOnly.severity === 'warning', warnOnly && warnOnly.ruleId);

  check('exactly one advice is surfaced', engine.current() === warnOnly);
}

console.log('4. dismissal is scoped to the advice key');
{
  const engine = new AdvisorEngine();
  const twoMagnets = quietContext({
    blockers: [
      { code: 'power_unconnected', message: 'x', placeableId: 'p1', portName: 'pwr_in' },
    ],
  });
  const first = engine.evaluate(twoMagnets);
  check('advice key carries the target', first && first.key.endsWith(':p1'),
    first && first.key);

  engine.dismiss(first.key, 0);
  const afterDismiss = engine.evaluate(twoMagnets);
  check('the dismissed target goes quiet', afterDismiss === null,
    afterDismiss && afterDismiss.key);

  // A DIFFERENT magnet with the same fault must still speak.
  const otherMagnet = quietContext({
    blockers: [{ code: 'power_unconnected', message: 'x', placeableId: 'p2', portName: 'pwr_in' }],
  });
  const second = engine.evaluate(otherMagnet);
  check('a sibling target still speaks', second && second.key.endsWith(':p2'),
    second ? second.key : 'silent');
}

console.log('5. cooldown expiry');
{
  const engine = new AdvisorEngine();
  const ctx = quietContext({
    blockers: [{ code: 'power_unconnected', message: 'x', placeableId: 'p1' }],
  });
  const a = engine.evaluate(ctx);
  engine.dismiss(a.key, 0);
  check('still quiet one tick later',
    engine.evaluate({ ...ctx, tick: 1 }) === null);
  const cooldown = ruleById('utilities.powerCable-unconnected').cooldownTicks;
  const back = engine.evaluate({ ...ctx, tick: cooldown + 1 });
  check('a persistent problem comes back after its cooldown',
    back && back.key === a.key, back ? back.key : 'still silent');
}

console.log('6. persistence');
{
  const engine = new AdvisorEngine();
  const ctx = quietContext({
    blockers: [{ code: 'power_unconnected', message: 'x', placeableId: 'p1' }],
  });
  const a = engine.evaluate(ctx);
  engine.silence(a.key);
  check('silenced advice stays silent forever',
    engine.evaluate({ ...ctx, tick: 100000 }) === null);

  const revived = new AdvisorEngine();
  revived.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())));
  check('silence survives a save round trip',
    revived.evaluate(ctx) === null);

  // Dismissals are session state on purpose: a reloaded game should say again
  // what is still broken.
  const dismissEngine = new AdvisorEngine();
  const b = dismissEngine.evaluate(ctx);
  dismissEngine.dismiss(b.key, 0);
  const reloaded = new AdvisorEngine();
  reloaded.fromJSON(JSON.parse(JSON.stringify(dismissEngine.toJSON())));
  check('a dismissal does NOT survive a reload',
    reloaded.evaluate(ctx) !== null);
}

console.log('7. player-selected advice levels filter and persist');
{
  const always = (id, severity) => ({
    id, group: 'test', severity, cooldownTicks: 1,
    when() { return { target: id }; },
    say() { return { title: id, body: severity }; },
  });
  const rules = [always('tip', 'tip'), always('warning', 'warning'), always('blocker', 'blocker')];
  const engine = new AdvisorEngine(rules);

  check('all four player-facing advice levels are declared',
    ['all', 'warnings', 'blockers', 'off'].every(level => ADVICE_LEVELS[level]));
  check('advice level has a stable global preference key',
    ADVICE_LEVEL_STORAGE_KEY === 'beamlineTycoon.adviceLevel');
  engine.setLevel('warnings');
  const warningOnly = new AdvisorEngine([rules[0], rules[1]]);
  warningOnly.setLevel('warnings');
  check('warnings level filters tips but keeps warnings',
    warningOnly.evaluate(quietContext())?.severity === 'warning');
  engine.setLevel('blockers');
  check('blockers level keeps only beam-stopping advice',
    engine.evaluate(quietContext())?.severity === 'blocker');
  engine.setLevel('off');
  check('off suppresses every advice band', engine.evaluate(quietContext()) === null);

  const restored = new AdvisorEngine(rules);
  restored.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())));
  check('advice level survives a save round trip', restored.level() === 'off');
  restored.fromJSON({ silenced: [] });
  check('old saves without a level default to full advice', restored.level() === 'all');
  check('unknown levels are rejected without changing the preference',
    restored.setLevel('nonsense') === false && restored.level() === 'all');
}

console.log('8. one broken rule does not silence the table');
{
  const exploding = {
    id: 'test.explodes', group: 'test', severity: 'blocker', cooldownTicks: 1,
    when() { throw new Error('boom'); },
    say() { return { title: 'never', body: 'never' }; },
  };
  const sane = {
    id: 'test.sane', group: 'test', severity: 'tip', cooldownTicks: 1,
    when() { return { target: 'x' }; },
    say() { return { title: 'fine', body: 'still here' }; },
  };
  const engine = new AdvisorEngine([exploding, sane]);
  let threw = null;
  let out = null;
  try { out = engine.evaluate(quietContext()); } catch (e) { threw = e; }
  check('evaluate does not propagate a rule throw', !threw, threw && threw.message);
  check('the surviving rule still speaks', out && out.ruleId === 'test.sane',
    out && out.ruleId);

  // A rule whose say() throws is dropped, not surfaced half-built.
  const badSay = {
    id: 'test.badsay', group: 'test', severity: 'blocker', cooldownTicks: 1,
    when() { return { target: 'x' }; },
    say() { throw new Error('boom'); },
  };
  const engine2 = new AdvisorEngine([badSay, sane]);
  const out2 = engine2.evaluate(quietContext());
  check('a rule whose say() throws is skipped', out2 && out2.ruleId === 'test.sane',
    out2 && out2.ruleId);
}

console.log('9. sprite frames differ');
{
  // A minimal 2-D context recorder: enough to prove each frame issues a
  // different sequence of fills without pulling in a canvas implementation.
  const calls = {};
  for (const frame of STUBBY_FRAMES) {
    const ops = [];
    const fakeCanvas = {
      width: 0, height: 0,
      getContext: () => ({
        set imageSmoothingEnabled(_v) {},
        set fillStyle(v) { ops.push(`c:${v}`); },
        fillRect: (x, y, w, h) => ops.push(`r:${x},${y},${w},${h}`),
        clearRect: () => ops.push('clear'),
      }),
    };
    // drawStubby is imported lazily so the module's top level stays DOM-free.
    calls[frame] = { ops, fakeCanvas };
  }

  const { drawStubby, STUBBY_W, STUBBY_H } = await import('../src/ui/stubby-sprite.js');
  for (const frame of STUBBY_FRAMES) {
    drawStubby(calls[frame].fakeCanvas, { frame });
  }

  check('idle draws something', calls.idle.ops.length > 20,
    `${calls.idle.ops.length} ops`);
  for (const frame of STUBBY_FRAMES.filter(f => f !== 'idle')) {
    check(`${frame} differs from idle`,
      calls[frame].ops.join('|') !== calls.idle.ops.join('|'));
  }
  check('canvas is sized to the sprite',
    calls.idle.fakeCanvas.width === STUBBY_W && calls.idle.fakeCanvas.height === STUBBY_H,
    `${calls.idle.fakeCanvas.width}x${calls.idle.fakeCanvas.height}`);

  // Nothing may be drawn outside the sprite bounds — a stray rect there shows
  // up as clipping or bleed once the sprite is scaled up 2x in CSS. Checked on
  // every frame: `alert` has the tallest stubs but the body geometry that
  // actually overran is frame-independent.
  for (const frame of STUBBY_FRAMES) {
    const outOfBounds = calls[frame].ops
      .filter(o => o.startsWith('r:'))
      .map(o => o.slice(2).split(',').map(Number))
      .filter(([x, y, w, h]) => x < 0 || y < 0 || x + w > STUBBY_W || y + h > STUBBY_H);
    check(`${frame} frame stays inside the sprite bounds`, outOfBounds.length === 0,
      JSON.stringify(outOfBounds.slice(0, 4)));
  }
}

console.log('10. Stubby introduces himself before his first advice');
{
  check('the introduction has the requested greeting',
    STUBBY_INTRODUCTION.title === "Hi, I'm Stubby"
      && STUBBY_INTRODUCTION.body === "I'm a three-stub tuner here to help impedance match your gameplay experience. It looks like you're trying to build a beamline. Want some help?");
  check('the introduction has the requested choices',
    STUBBY_INTRODUCTION.acceptLabel === 'Yes help me'
      && STUBBY_INTRODUCTION.declineLabel === 'No Piss off');

  const firstAdvice = {
    key: 'tutorial.next-step:first', severity: 'tip',
    title: 'Build a beamline', body: 'Start with a source.',
  };
  const introduced = [];
  const fake = Object.create(Stubby.prototype);
  fake.advice = null;
  fake.introducing = false;
  fake.introductionSeen = false;
  fake._pendingAdvice = null;
  fake._showIntroduction = function () {
    this.introducing = true;
    introduced.push(this._pendingAdvice);
  };
  fake.update(firstAdvice);
  check('first advice opens the introduction instead',
    fake.introducing && introduced[0] === firstAdvice && fake.advice === null);

  const originalStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
  };
  try {
    const acceptedAdvice = [];
    fake._setAdvice = advice => {
      fake.advice = advice;
      acceptedAdvice.push(advice);
    };
    check('accepting the introduction is handled', fake.respondToIntroduction(true));
    check('accepting reveals the pending first advice',
      acceptedAdvice[0] === firstAdvice && fake.advice === firstAdvice);
    check('accepting remembers that Stubby introduced himself',
      stored.get(STUBBY_INTRODUCTION_STORAGE_KEY) === 'accepted');

    let saved = 0;
    let selectedLevel = null;
    const declined = Object.create(Stubby.prototype);
    declined.introducing = true;
    declined.introductionSeen = false;
    declined._pendingAdvice = firstAdvice;
    declined.engine = { setLevel: level => { selectedLevel = level; } };
    declined.game = { save: () => { saved++; } };
    declined._setAdvice = advice => { declined.advice = advice; };
    declined._rememberIntroduction = Stubby.prototype._rememberIntroduction;
    check('declining the introduction is handled', declined.respondToIntroduction(false));
    check('declining turns advice off and hides the pending advice',
      selectedLevel === 'off' && declined.advice === null);
    check('declining persists the preference and save',
      stored.get(STUBBY_INTRODUCTION_STORAGE_KEY) === 'declined'
        && stored.get(ADVICE_LEVEL_STORAGE_KEY) === 'off'
        && saved === 1);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
}

console.log('11. every advice can turn Stubby off permanently');
{
  check('the permanent action is explicit', STUBBY_TURN_OFF_LABEL === 'Turn Stubby off');

  const originalStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
  };
  try {
    let saved = 0;
    let selectedLevel = null;
    const fake = Object.create(Stubby.prototype);
    fake.advice = { key: 'tutorial.next-step:first' };
    fake.introducing = false;
    fake.introductionSeen = true;
    fake._pendingAdvice = null;
    fake.engine = { setLevel: level => { selectedLevel = level; } };
    fake.game = { save: () => { saved++; } };
    fake._setAdvice = advice => { fake.advice = advice; };

    check('the message-level action is handled', fake.turnOff());
    check('turning Stubby off hides the current advice immediately', fake.advice === null);
    check('turning Stubby off selects the engine Off level', selectedLevel === 'off');
    check('turning Stubby off persists globally and in the active save',
      stored.get(ADVICE_LEVEL_STORAGE_KEY) === 'off' && saved === 1);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
}

console.log('12. the presenter refreshes changing numbers but does not re-perk');
{
  // Stubby.update's diff, exercised directly. Several rules hold a stable key
  // while their numbers move — optics.needs-focusing counts down as quads go
  // in, economy.burning-cash tracks the runway — so diffing on key alone
  // froze the bubble at whatever it said first.
  const rendered = [];
  const perks = [];
  const fake = Object.create(Stubby.prototype);
  fake.advice = null;
  fake.collapsed = false;
  fake.introducing = false;
  fake.introductionSeen = true;
  fake._setAdvice = function (advice, opts = {}) {
    this.advice = advice || null;
    rendered.push(advice ? `${advice.title}|${advice.body}` : null);
    if (opts.perk) perks.push(advice ? advice.key : null);
  };

  const a1 = { key: 'optics.needs-focusing:nf', severity: 'warning', title: '3 more quads wanted', body: 'from about 14.0 m' };
  const a2 = { key: 'optics.needs-focusing:nf', severity: 'warning', title: '1 more quad wanted', body: 'from about 26.0 m' };
  const a3 = { key: 'optics.needs-focusing:nf', severity: 'warning', title: '1 more quad wanted', body: 'from about 26.0 m' };
  const a4 = { key: 'utilities.powerCable-unconnected:p1', severity: 'blocker', title: 'No power', body: 'x' };

  fake.update(a1);
  fake.update(a2);   // same key, new numbers -> must re-render
  fake.update(a3);   // identical -> must NOT re-render
  fake.update(a4);   // new key -> re-render AND re-perk

  check('renders the first advice', rendered[0] === '3 more quads wanted|from about 14.0 m',
    JSON.stringify(rendered));
  check('refreshes when the numbers move under a stable key',
    rendered[1] === '1 more quad wanted|from about 26.0 m', JSON.stringify(rendered));
  check('does not re-render identical advice', rendered.length === 3,
    `${rendered.length} renders: ${JSON.stringify(rendered)}`);
  check('perks only on a changed key', perks.length === 2 && perks[1] === a4.key,
    JSON.stringify(perks));

  // Clearing to null must render once, and only once.
  fake.update(null);
  check('clearing renders once', rendered.length === 4 && rendered[3] === null,
    JSON.stringify(rendered));
  fake.update(null);
  check('clearing again is a no-op', rendered.length === 4, `${rendered.length} renders`);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
