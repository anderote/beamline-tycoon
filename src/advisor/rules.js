// src/advisor/rules.js — everything Stubby knows, in one table.
//
// A rule is a pure function of the context built by advisor/context.js. `when`
// returns a falsy value for "nothing to say", or a payload object that is
// carried verbatim into `say` and into the action. The payload is what lets one
// rule speak about a specific magnet rather than about a category — the
// `target` field on it becomes the discriminator in the advice key, so
// silencing one unwired magnet leaves its neighbour still speaking.
//
// Order within a severity band is rank: the engine breaks severity ties by
// position in this array, so the table is ordered deliberately.
//
// Voice: Stubby is a competent colleague, not a mascot. One sentence saying
// what is wrong, one saying what to do about it. No exclamation marks, no
// "It looks like you're building a beamline!".

import { UNCONNECTED_CODES } from '../game/utility-gate.js';
import { makeUtilityEndpointIndex } from '../utility/utility-endpoints.js';
import { portWorldPosition } from '../utility/ports.js';
import { COMPONENTS } from '../data/components.js';

/** Human-facing names for the utilities, for message text. */
const UTILITY_NAMES = {
  hvCable: 'HV feeder',
  powerCable: 'power',
  vacuumPipe: 'vacuum',
  rfWaveguide: 'RF',
  coolingWater: 'cooling water',
  cryoTransfer: 'cryogenics',
};

/** What to go place when a utility is missing entirely. */
const UTILITY_FIXES = {
  hvCable: 'Run HV Cable from a transformer to the panel behind it.',
  powerCable: 'Run Power Cable from a transformer or distribution panel.',
  vacuumPipe: 'Run Vacuum Pipe from a roughing or turbo pump.',
  rfWaveguide: 'Run RF Waveguide from an amplifier that covers its band.',
  coolingWater: 'Run Cooling Water from a chiller or LCW skid.',
  cryoTransfer: 'Run Cryo Transfer line from a cold box.',
};

/**
 * Frame the camera on the port that is missing its connection — the same
 * resolution the HUD blocker panel uses for click-to-locate, so both routes
 * land the player on the same spot. Framing the PORT rather than the component
 * centre matters: the port is where a line has to be dragged to.
 *
 * Takes the host rather than the game because the renderer is not reachable
 * from a Game: main.js keeps it in a local and only mirrors it onto `window`
 * for console debugging. An action that went looking for `game._renderer`
 * would find undefined, and optional chaining would turn "Show me" into a
 * button that silently does nothing.
 */
function focusBlockerPort(host, payload) {
  if (!payload || payload.placeableId == null) return;
  const state = host?.game?.state;
  if (!state || !host.renderer) return;
  const ep = makeUtilityEndpointIndex(state).get(payload.placeableId);
  if (!ep) return;
  const world = portWorldPosition(ep, COMPONENTS[ep.type], payload.portName);
  if (!world) return;
  host.renderer.focusOnWorld?.(world.x, world.z);
}

/**
 * One rule per hard-required utility, generated from the gate's own code map
 * rather than restated here — a new utility added to UNCONNECTED_CODES gets an
 * advice rule for free, and can never drift out of sync with the blocker that
 * produced it.
 */
function unconnectedRules() {
  return Object.entries(UNCONNECTED_CODES).map(([utility, code]) => ({
    id: `utilities.${utility}-unconnected`,
    group: 'utilities',
    severity: 'blocker',
    cooldownTicks: 120,
    when(ctx) {
      const hit = ctx.blockers.find(b => b.code === code);
      if (!hit) return false;
      const count = ctx.blockers.filter(b => b.code === code).length;
      return {
        target: hit.placeableId ?? code,
        placeableId: hit.placeableId,
        portName: hit.portName,
        count,
        utility,
      };
    },
    say(ctx, p) {
      const name = UTILITY_NAMES[p.utility] || p.utility;
      return {
        title: `No ${name}`,
        body: p.count > 1
          ? `${p.count} pieces of kit have no ${name} connection, so the beam will not run. ${UTILITY_FIXES[p.utility] || ''}`
          : `Something is missing its ${name} connection, so the beam will not run. ${UTILITY_FIXES[p.utility] || ''}`,
      };
    },
    action: { label: 'Show me', run: focusBlockerPort },
  }));
}

export const ADVICE_RULES = [
  // ---- Blockers: the beam is not running and this is why ----
  {
    id: 'utilities.unstaffed',
    group: 'staffing',
    severity: 'blocker',
    cooldownTicks: 180,
    when(ctx) {
      const hit = ctx.blockers.find(b => b.code === 'beam_unstaffed');
      return hit ? { target: 'unstaffed', message: hit.message } : false;
    },
    say(ctx, p) {
      return {
        title: 'Nobody at the controls',
        body: `${p.message} The beam stays down until an operator is on shift in the Control Room.`,
      };
    },
  },

  ...unconnectedRules(),

  // ---- Warnings: it runs, but it is not doing what you want ----
  {
    id: 'optics.no-quads',
    group: 'optics',
    severity: 'warning',
    cooldownTicks: 240,
    when(ctx) {
      if (!ctx.designerOpen) return false;
      if (ctx.draftQuadCount > 0) return false;
      if (ctx.draftLength < 10) return false;
      return { target: 'no-quads', length: ctx.draftLength };
    },
    say(ctx, p) {
      return {
        title: 'No focusing at all',
        body: `${p.length.toFixed(0)} m of beamline and not one quadrupole. The beam spreads until it hits the pipe wall — put in a quad, then alternate F and D from there.`,
      };
    },
  },
  {
    id: 'optics.needs-focusing',
    group: 'optics',
    severity: 'warning',
    cooldownTicks: 180,
    when(ctx) {
      if (!ctx.designerOpen || ctx.ghostQuads.length === 0) return false;
      // Covered more pointedly by optics.no-quads when there is no focusing
      // anywhere; this rule is about topping up a lattice that exists.
      if (ctx.draftQuadCount === 0) return false;
      return { target: 'needs-focusing', count: ctx.ghostQuads.length, first: ctx.ghostQuads[0].s };
    },
    say(ctx, p) {
      return {
        title: `${p.count} more quad${p.count === 1 ? '' : 's'} wanted`,
        body: `The beam is diverging from about ${p.first.toFixed(1)} m. I have marked where I would put focusing — alternate F and D along the run.`,
      };
    },
    action: {
      label: 'Show me',
      run: (host) => host?.game?._designer?._jumpToNextGhost?.(),
    },
  },
  {
    id: 'optics.dispersion',
    group: 'optics',
    severity: 'warning',
    cooldownTicks: 240,
    when(ctx) {
      if (!ctx.designerOpen || ctx.dispersionWarnings.length === 0) return false;
      const worst = ctx.dispersionWarnings.reduce(
        (a, b) => (Math.abs(b.etaX) > Math.abs(a.etaX) ? b : a));
      return { target: 'dispersion', etaX: worst.etaX, s: worst.s, type: worst.elementType };
    },
    say(ctx, p) {
      return {
        title: 'Dispersion left uncorrected',
        body: `The line still carries ${Math.abs(p.etaX).toFixed(2)} m of dispersion past ${p.s.toFixed(1)} m. Bend the other way or add a chicane, or the energy spread shows up as beam size.`,
      };
    },
  },
  {
    id: 'economy.burning-cash',
    group: 'economy',
    severity: 'warning',
    cooldownTicks: 300,
    when(ctx) {
      if (ctx.net >= 0) return false;
      if (ctx.funding <= 0) return { target: 'broke', funding: ctx.funding, net: ctx.net };
      const ticksLeft = ctx.funding / -ctx.net;
      if (ticksLeft > 200) return false;
      return { target: 'burning', funding: ctx.funding, net: ctx.net, ticksLeft };
    },
    say(ctx, p) {
      if (p.target === 'broke') {
        return {
          title: 'Out of money',
          body: 'Funding is gone and upkeep is still running. Sell something, or get a beam on a paying target.',
        };
      }
      return {
        title: 'Running at a loss',
        body: `Upkeep is $${Math.abs(p.net).toLocaleString()} a tick over income — about ${Math.round(p.ticksLeft)} ticks of runway left.`,
      };
    },
  },

  // ---- Tips: nothing is wrong, but here is something worth doing ----
  {
    id: 'tutorial.next-step',
    group: 'tutorial',
    severity: 'tip',
    cooldownTicks: 240,
    when(ctx) {
      const step = ctx.tutorial.nextStep;
      return step ? { target: step.id, step } : false;
    },
    say(ctx, p) {
      return { title: p.step.name, body: p.step.hint };
    },
  },
  {
    id: 'economy.idle-funding',
    group: 'economy',
    severity: 'tip',
    cooldownTicks: 600,
    when(ctx) {
      if (ctx.funding < 2000000) return false;
      if (ctx.net < 0) return false;
      return { target: 'idle-funding', funding: ctx.funding };
    },
    say(ctx, p) {
      return {
        title: 'Money sitting still',
        body: `$${Math.round(p.funding / 1000).toLocaleString()}k in the bank and nothing being built with it. Longer beamlines and better sources both pay for themselves.`,
      };
    },
  },
];

export { UTILITY_NAMES };
