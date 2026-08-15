// Shared interaction seam for the vacuum history range buttons. The solver
// owns the retained samples; UI windows own only which published span they
// are currently displaying.

import { VACUUM_HISTORY_RANGES } from '../utility/types/vacuumPipe.js';

const VALID_RANGE_TICKS = new Set(VACUUM_HISTORY_RANGES.map(range => range.ticks));

export function bindVacuumPressureRangeControls(root, onRangeChange) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('[data-vacuum-range-ticks]').forEach(button => {
    button.addEventListener('click', () => {
      const rangeTicks = Number(button.dataset.vacuumRangeTicks);
      if (!VALID_RANGE_TICKS.has(rangeTicks)) return;
      onRangeChange(rangeTicks);
    });
  });
}
