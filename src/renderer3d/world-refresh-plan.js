// One renderer invalidation policy for all durable world events. Legacy event
// names remain public UI contracts; this module normalizes them into the same
// plan shape consumed by the frame scheduler.

import {
  createWorldChangeSet,
  mergeWorldChangeSets,
  worldChangeForEvent,
  worldChangeFromPayload,
} from '../game/world-change-set.js';
import { placeableRefreshPlan } from './placeable-refresh-plan.js';

const DOMAIN_PLANS = Object.freeze({
  terrain: { terrain: true },
  infrastructure: { infrastructure: true, physicsBodies: true },
  decorations: { decorations: true, physicsBodies: true },
  walls: { walls: true, physicsBodies: true },
  connections: {
    connections: true,
    components: true,
    pipeAttachments: true,
    physicsBodies: true,
  },
  utilityLines: {
    utilityLines: true,
    utilityIssues: true,
    portFittings: true,
  },
  beamline: {
    components: true,
    pipeAttachments: true,
    beamPipes: true,
    beam: true,
    utilityLines: true,
    utilityIssues: 'force',
    portFittings: true,
    physicsBodies: true,
  },
  facility: {
    equipment: true,
    components: true,
    pipeAttachments: true,
    physicsBodies: true,
  },
  zones: {
    terrain: true,
    zones: true,
    decorations: true,
    palette: true,
  },
  palette: { palette: true },
});

export function mergeWorldRefreshPlans(...plans) {
  const merged = {};
  const changeSets = [];
  for (const plan of plans) {
    if (!plan) continue;
    if (plan.changeSet) changeSets.push(plan.changeSet);
    for (const [key, value] of Object.entries(plan)) {
      if (key === 'changeSet') continue;
      if (key === 'utilityIssues') {
        if (value === 'force' || !merged.utilityIssues) merged.utilityIssues = value;
      } else if (value) {
        merged[key] = true;
      }
    }
  }
  if (changeSets.length) {
    merged.changeSet = mergeWorldChangeSets(...changeSets);
  }
  return merged;
}

function planForDomains(domains) {
  return mergeWorldRefreshPlans(...domains.map(domain => DOMAIN_PLANS[domain]));
}

export function worldRefreshPlan(event, data) {
  if (event === 'loaded' || event === 'restored') {
    return { full: true, changeSet: createWorldChangeSet({ full: true, reason: event }) };
  }

  if (event === 'placeableChanged' || event === 'facilityChanged' || event === 'zonesChanged') {
    const plan = placeableRefreshPlan(event, data);
    if (!plan) return null;
    const changeSet = worldChangeFromPayload(data)
      || createWorldChangeSet({ reason: `legacy:${event}` });
    return { ...plan, changeSet };
  }

  const changeSet = worldChangeForEvent(event, data);
  if (!changeSet) return null;
  if (changeSet.full) return { full: true, changeSet };
  const plans = [planForDomains([...changeSet.domains])];
  if (changeSet.placeables.size > 0 || changeSet.domains.has('placeables')) {
    plans.push(placeableRefreshPlan('placeableChanged', { changeSet }));
  }
  if (changeSet.domains.has('legacyPlaceables')) {
    plans.push(placeableRefreshPlan('placeableChanged'));
  }
  return { ...mergeWorldRefreshPlans(...plans), changeSet };
}
