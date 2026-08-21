import assert from 'node:assert/strict';
import {
  SKIP_TITLE_SESSION_KEY,
  returnToMainMenu,
} from '../src/ui/main-menu-navigation.js';
import { PENDING_SCENARIO_KEY } from '../src/data/scenarios.js';

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const storage = memoryStorage([[PENDING_SCENARIO_KEY, '__custom__']]);
const session = memoryStorage([[SKIP_TITLE_SESSION_KEY, '1']]);
const location = {
  pathname: '/beamline-tycoon/',
  href: '/beamline-tycoon/?demo=1#designer',
};
let saveCount = 0;

const target = returnToMainMenu({ save: () => { saveCount += 1; } }, {
  storage,
  session,
  location,
});

assert.equal(saveCount, 1, 'returning to the title screen saves the active game once');
assert.equal(session.getItem(SKIP_TITLE_SESSION_KEY), null,
  'a stale one-shot skip flag cannot bypass the title screen');
assert.equal(storage.getItem(PENDING_SCENARIO_KEY), null,
  'a stale pending scenario cannot immediately bypass the title screen');
assert.equal(target, '/beamline-tycoon/');
assert.equal(location.href, '/beamline-tycoon/',
  'navigation strips demo/editor query parameters and route hashes');

console.log('Main-menu navigation: all assertions passed');
