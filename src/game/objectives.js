import { OBJECTIVES } from '../data/objectives.js';

export function checkObjectives(state, log) {
  const completed = [];
  for (const obj of OBJECTIVES) {
    if (state.completedObjectives.includes(obj.id)) continue;
    try {
      if (obj.condition(state)) {
        state.completedObjectives.push(obj.id);
        for (const [r, a] of Object.entries(obj.reward))
          state.resources[r] = (state.resources[r] || 0) + a;
        log(`Goal complete: ${obj.name}!`, 'reward');
        completed.push(obj);
      }
    } catch { /* objective condition may reference undefined state */ }
  }
  return completed;
}
