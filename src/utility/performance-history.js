// Bounded, derived telemetry published by SolveRunner for utility UI plots.
//
// Utility lines are topology members rather than independently solved flow
// elements. A clicked run therefore displays the history of its exact
// connected network. Recording that history here keeps the UI display-only:
// every plotted quantity is copied from a solver-owned flowState.

export const UTILITY_PERFORMANCE_HISTORY_MAX = 180;

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function worstDeliveredQuality(perSinkQuality) {
  const values = Object.values(perSinkQuality || {}).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

/** Build one immutable plot sample from a published solver result. */
export function utilityPerformanceSample(flow, tick) {
  const errors = Array.isArray(flow?.errors) ? flow.errors : [];
  return Object.freeze({
    tick: finiteOrNull(tick),
    totalCapacity: finiteOrNull(flow?.totalCapacity),
    totalDemand: finiteOrNull(flow?.totalDemand),
    utilization: finiteOrNull(flow?.utilization),
    deliveredQuality: worstDeliveredQuality(flow?.perSinkQuality),
    connectivity: Number.isFinite(flow?.connectedNodeCount)
      ? (flow.connectedNodeCount >= 2 ? 1 : 0) : null,
    networkPressure: finiteOrNull(flow?.networkPressure ?? flow?.pressure),
    connectedNodeCount: finiteOrNull(flow?.connectedNodeCount),
    connectedLinkCount: finiteOrNull(flow?.connectedLinkCount),
    hardErrorCount: errors.filter(error => error?.severity === 'hard').length,
    softErrorCount: errors.filter(error => error?.severity === 'soft').length,
  });
}

/**
 * Append or replace a network's sample. Re-running the gate during one game
 * tick replaces that tick instead of making the chart advance artificially.
 */
export function appendUtilityPerformanceSample(previous, flow, tick,
  capacity = UTILITY_PERFORMANCE_HISTORY_MAX) {
  // This is derived state owned exclusively by SolveRunner. Mutate the
  // retained array in place so N live networks do not each copy an ever-longer
  // history on every tick.
  const history = Array.isArray(previous) ? previous : [];
  const sample = utilityPerformanceSample(flow, tick);
  const last = history[history.length - 1];
  if (last && last.tick === sample.tick) history[history.length - 1] = sample;
  else history.push(sample);
  if (history.length > capacity) history.splice(0, history.length - capacity);
  return history;
}
