import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  pipePathRuns, splitRunExcludingModules,
} from '../src/beamline/pipe-geometry.js';

test('pipe render runs collapse dense straight points and preserve corners', () => {
  const path = [
    { col: 0, row: 0 }, { col: 0.25, row: 0 }, { col: 0.5, row: 0 },
    { col: 0.5, row: 0.25 }, { col: 0.5, row: 0.5 },
  ];
  assert.deepEqual(pipePathRuns(path), [
    { start: path[0], end: path[2] },
    { start: path[2], end: path[4] },
  ]);
});

test('pipe render runs are carved around occupied module subtiles', () => {
  const modules = new Set(['0,0,2,2']);
  assert.deepEqual(
    splitRunExcludingModules({ col: -1, row: 0 }, { col: 1, row: 0 }, modules),
    [
      { start: { col: -1, row: 0 }, end: { col: 0, row: 0 } },
      { start: { col: 0.25, row: 0 }, end: { col: 1, row: 0 } },
    ],
  );
});
