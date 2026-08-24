import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };

const { BeamlinesMenu, beamlinesMenuModel } = await import('../src/ui/BeamlinesMenu.js');

const entries = [
  {
    id: 'bl-1', name: 'Injector', accentColor: 0x46c25a,
    status: 'running', sourceId: 'source-1',
  },
  {
    id: 'bl-2', name: 'Test Stand', accentColor: 0x4d8ee8,
    status: 'stopped', sourceId: null,
  },
];
const registry = {
  getAll: () => entries,
  get: id => entries.find(entry => entry.id === id),
};

const model = beamlinesMenuModel(registry);
assert.deepEqual(model.map(entry => entry.id), ['bl-1', 'bl-2'],
  'menu preserves the registry order with one model row per beamline');
assert.equal(model[0].canOpenDesigner, true);
assert.equal(model[1].canOpenDesigner, false,
  'a legacy entry without a source cannot advertise an unusable Designer action');

const classes = new Set();
const attrs = {};
function fakeElement(tagName) {
  return {
    tagName,
    className: '',
    textContent: '',
    children: [],
    dataset: {},
    style: {},
    setAttribute() {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
  };
}
const fakeDocument = { createElement: fakeElement };
const button = {
  addEventListener() {},
  setAttribute(name, value) { attrs[name] = value; },
};
const menu = {
  ownerDocument: fakeDocument,
  children: [],
  addEventListener() {},
  replaceChildren(...children) { this.children = children; },
  appendChild(child) { this.children.push(child); },
  classList: {
    contains: name => classes.has(name),
    add: name => classes.add(name),
    remove: name => classes.delete(name),
  },
};
const emitted = [];
const infoOpens = [];
const designerOpens = [];
const game = {
  registry,
  selectedBeamlineId: null,
  on() {},
  emit: (...args) => emitted.push(args),
};
const beamlinesMenu = new BeamlinesMenu(game, {
  button,
  menu,
  documentTarget: { addEventListener() {} },
  onOpenInfo: id => infoOpens.push(id),
  onOpenDesigner: id => designerOpens.push(id),
});

beamlinesMenu.render();
assert.equal(menu.children.length, 2,
  'rendering creates exactly one visible row per registry entry');
assert.equal(menu.children[0].children.length, 2,
  'each row contains an information entry and a separate far-right action');
assert.equal(menu.children[0].children[0].dataset.beamlineAction, 'info');
assert.equal(menu.children[0].children[1].dataset.beamlineAction, 'designer');
assert.equal(menu.children[0].children[1].textContent, 'Designer');

assert.equal(beamlinesMenu.activate('bl-1', 'info'), true);
assert.equal(game.selectedBeamlineId, 'bl-1');
assert.deepEqual(emitted, [['beamlineSelected', 'bl-1']]);
assert.deepEqual(infoOpens, ['bl-1'],
  'clicking a beamline entry selects it and opens its information window');
assert.equal(attrs['aria-expanded'], 'false');

assert.equal(beamlinesMenu.activate('bl-1', 'designer'), true);
assert.deepEqual(designerOpens, ['bl-1'],
  'the far-right action opens that exact beamline in Designer');
assert.equal(beamlinesMenu.activate('bl-2', 'designer'), false,
  'Designer action rejects entries with no editable source');
assert.equal(beamlinesMenu.activate('missing', 'info'), false,
  'stale rows cannot open a removed beamline');

console.log('Beamlines menu: all assertions passed');
