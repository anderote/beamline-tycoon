#!/usr/bin/env node

import { runStaffScaleBenchmark } from './perf/staff-scale-benchmark.mjs';

const rows = runStaffScaleBenchmark();
console.log('Staff scale benchmark (headless simulation; cold nav build included)');
for (const row of rows) {
  console.log(
    `${String(row.staffCount).padStart(3)} staff | ${String(row.ticks).padStart(3)} ticks`
    + ` | mean ${row.meanTickMs.toFixed(2)} ms | max ${row.maxTickMs.toFixed(2)} ms`
    + ` | routes ${row.peakRouteStarts}/${row.routeStartBudget}`
    + ` | arrived ${row.arrived}/${row.staffCount}`,
  );
}

if (rows.some(row => !row.allArrived || row.peakRouteStarts > row.routeStartBudget)) {
  process.exitCode = 1;
}
