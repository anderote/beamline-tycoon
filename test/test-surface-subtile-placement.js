// test/test-surface-subtile-placement.js
//
// Tests for multi-child surface stacking — exercises the pure helpers in
// src/game/stacking.js directly (canStack, findStackTarget, collapsePlan)
// with hand-rolled fixtures. No Game instance; no PLACEABLES registry.
//
// Covers T1-T8 from
//   docs/superpowers/specs/2026-04-17-surface-subtile-placement-design.md:
//     T1 multi-place on bench
//     T2 sibling collision
//     T3 recursive stack (tray on bench, item on tray)
//     T4 remove mid-tree (children re-parent upward)
//     T5 remove ground bench (children drop to ground)
//     T6 cursor targeting (descent into tray vs. bench)
//     T7 save/load round-trip — schema unchanged; this is a structural check
//        (all fields round-trip through JSON stringify/parse).
//     T8 height cap on placement still rejected.
//
// Runs with: node test/test-surface-subtile-placement.js

import { canStack, findStackTarget, collapsePlan, MAX_STACK_HEIGHT } from '../src/game/stacking.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A def provides just what stacking.js needs: subW, subL, subH, flags, and
// footprintCells. dir=0 for all tests.
function mockDef({
  type,
  subW = 1,
  subL = 1,
  subH = 1,
  hasSurface = false,
  stackable = false,
  surfaceY = undefined,
}) {
  return {
    type,
    subW,
    subL,
    subH,
    hasSurface,
    stackable,
    surfaceY,
    footprintCells(col, row, subCol, subRow, _dir) {
      const cells = [];
      for (let dr = 0; dr < subL; dr++) {
        for (let dc = 0; dc < subW; dc++) {
          const sc = subCol + dc;
          const sr = subRow + dr;
          cells.push({
            col: col + Math.floor(sc / 4),
            row: row + Math.floor(sr / 4),
            subCol: ((sc % 4) + 4) % 4,
            subRow: ((sr % 4) + 4) % 4,
          });
        }
      }
      return cells;
    },
  };
}

function mockEntry({
  id,
  type,
  col = 0, row = 0, subCol = 0, subRow = 0, dir = 0,
  cells,
  stackParentId = null,
  stackChildren = [],
  placeY = 0,
  kind = 'equipment',
}) {
  return {
    id, type, col, row, subCol, subRow, dir,
    cells: cells || [],
    stackParentId,
    stackChildren: stackChildren.slice(),
    placeY,
    kind,
  };
}

// Registry helpers.
function makeRegistry() {
  const defs = new Map();
  const entries = new Map();
  return {
    defs, entries,
    addDef(def) { defs.set(def.type, def); return def; },
    addEntry(entry) { entries.set(entry.id, entry); return entry; },
    getDef: (t) => defs.get(t) || null,
    getEntry: (id) => entries.get(id) || null,
  };
}

// Build a subgridOccupied map that marks all cells of `entries` as owned by
// each entry. (For ground-level entries only.)
function buildSubgrid(groundEntries) {
  const occ = {};
  for (const e of groundEntries) {
    for (const c of e.cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      occ[k] = { id: e.id, kind: e.kind };
    }
  }
  return occ;
}

// Bench/tray/item fixture helpers. Bench: 4×2 surface at col,row. Tray: 2×2
// surface (at subCol,subRow on bench). Item: 1×1 leaf.
function placeBench(reg, { id = 'bench', col = 0, row = 0 } = {}) {
  const def = reg.addDef(mockDef({
    type: 'bench', subW: 4, subL: 2, subH: 1, hasSurface: true,
  }));
  const cells = def.footprintCells(col, row, 0, 0, 0);
  return reg.addEntry(mockEntry({
    id, type: 'bench', col, row, cells,
  }));
}

function placeTray(reg, parent, { id = 'tray', subCol = 0, subRow = 0 } = {}) {
  let def = reg.getDef('tray');
  if (!def) {
    def = reg.addDef(mockDef({
      type: 'tray', subW: 2, subL: 2, subH: 1, hasSurface: true, stackable: true,
    }));
  }
  const cells = def.footprintCells(parent.col, parent.row, subCol, subRow, 0);
  const entry = reg.addEntry(mockEntry({
    id, type: 'tray',
    col: parent.col, row: parent.row,
    subCol, subRow,
    cells,
    stackParentId: parent.id,
    placeY: (parent.placeY || 0) + (reg.getDef(parent.type).surfaceY ?? reg.getDef(parent.type).subH),
  }));
  parent.stackChildren.push(id);
  return entry;
}

function placeItem(reg, parent, { id, subCol = 0, subRow = 0, subW = 1, subL = 1, type = 'item' } = {}) {
  let def = reg.getDef(type);
  if (!def) {
    def = reg.addDef(mockDef({
      type, subW, subL, subH: 1, stackable: true,
    }));
  }
  const cells = def.footprintCells(parent.col, parent.row, subCol, subRow, 0);
  const entry = reg.addEntry(mockEntry({
    id, type,
    col: parent.col, row: parent.row,
    subCol, subRow,
    cells,
    stackParentId: parent.id,
    placeY: (parent.placeY || 0) + (reg.getDef(parent.type).surfaceY ?? reg.getDef(parent.type).subH),
  }));
  parent.stackChildren.push(id);
  return entry;
}

// ===========================================================================
// T1 Multi-place on bench via canStack.
// ===========================================================================
console.log('\n--- T1: place two items on one bench (canStack allows both) ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const benchDef = reg.getDef('bench');
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);

  // First item at subCol=0,subRow=0.
  const r1 = canStack(itemDef, bench, benchDef, 0, 0, 0, 0, 0, reg.getEntry);
  assert(r1.ok === true, `first item fits (got ${JSON.stringify(r1)})`);
  assert(r1.placeY === 1, `placeY=1 (got ${r1.placeY})`);

  // Commit the first item (mutate fixture).
  placeItem(reg, bench, { id: 'itemA', subCol: 0, subRow: 0 });

  // Second item at different subtile (subCol=2,subRow=0) should still fit.
  const r2 = canStack(itemDef, bench, benchDef, 0, 0, 2, 0, 0, reg.getEntry);
  assert(r2.ok === true, `second item at distinct subtile fits (got ${JSON.stringify(r2)})`);
  assert(r2.placeY === 1, `second placeY=1 (got ${r2.placeY})`);
}

// ===========================================================================
// T2 Sibling collision rejected.
// ===========================================================================
console.log('\n--- T2: sibling collision rejected by canStack ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const benchDef = reg.getDef('bench');
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);

  placeItem(reg, bench, { id: 'itemA', subCol: 1, subRow: 0 });

  // Attempt to place over the occupied subtile.
  const r = canStack(itemDef, bench, benchDef, 0, 0, 1, 0, 0, reg.getEntry);
  assert(r.ok === false, `overlap rejected (got ${JSON.stringify(r)})`);
  assert(/occupied|collision/i.test(r.reason || ''),
    `reason mentions occupied/collision (got ${r.reason})`);
}

// Partial-overlap case: 2×1 footprint that overlaps the one occupied subtile.
console.log('--- T2b: partial sibling overlap rejected ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const benchDef = reg.getDef('bench');
  reg.addDef(mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true }));
  placeItem(reg, bench, { id: 'itemA', subCol: 2, subRow: 0 });

  const wideDef = mockDef({ type: 'wide', subW: 2, subL: 1, subH: 1, stackable: true });
  // wide footprint at subCol=1 occupies subCol 1..2 → overlaps itemA@2.
  const r = canStack(wideDef, bench, benchDef, 0, 0, 1, 0, 0, reg.getEntry);
  assert(r.ok === false, `partial overlap rejected (got ${JSON.stringify(r)})`);

  // Non-overlapping wide footprint at subCol=0 (covers 0..1) should be ok.
  const r2 = canStack(wideDef, bench, benchDef, 0, 0, 0, 0, 0, reg.getEntry);
  assert(r2.ok === true, `non-overlapping wide fits (got ${JSON.stringify(r2)})`);
}

// ===========================================================================
// T3 Recursive stack via findStackTarget (tray on bench, item on tray).
// ===========================================================================
console.log('\n--- T3: recursive stack — item targets tray, not bench ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const tray = placeTray(reg, bench, { id: 'tray1', subCol: 0, subRow: 0 });
  const subgrid = buildSubgrid([bench]);

  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);

  // Cursor inside tray cells (subCol=1,subRow=1 is within tray's 0..1).
  const res = findStackTarget(
    itemDef, 0, 0, 1, 1, 0,
    subgrid, reg.getEntry, reg.getDef,
  );
  assert(res !== null, `found a target (got ${JSON.stringify(res)})`);
  if (res) {
    assert(res.targetEntry.id === 'tray1',
      `target is tray (got ${res.targetEntry.id})`);
    // placeY = tray.placeY (=1) + tray.subH (=1) = 2.
    assert(res.placeY === 2, `placeY=2 (got ${res.placeY})`);
  }

  // Structural invariants.
  assert(bench.stackChildren.length === 1 && bench.stackChildren[0] === 'tray1',
    `bench children = [tray] (got ${JSON.stringify(bench.stackChildren)})`);
  assert(tray.placeY === 1, `tray.placeY=1 (got ${tray.placeY})`);
}

// ===========================================================================
// T6 Cursor targeting — inside tray → tray, outside tray → bench.
// ===========================================================================
console.log('\n--- T6: cursor inside tray targets tray; outside targets bench ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  placeTray(reg, bench, { id: 'tray1', subCol: 0, subRow: 0 });
  const subgrid = buildSubgrid([bench]);
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);

  // Inside tray (subCol=0,subRow=0).
  const inside = findStackTarget(itemDef, 0, 0, 0, 0, 0, subgrid, reg.getEntry, reg.getDef);
  assert(inside !== null && inside.targetEntry.id === 'tray1',
    `inside tray → tray (got ${inside && inside.targetEntry.id})`);

  // Outside tray but on bench (subCol=3,subRow=0).
  const outside = findStackTarget(itemDef, 0, 0, 3, 0, 0, subgrid, reg.getEntry, reg.getDef);
  assert(outside !== null && outside.targetEntry.id === 'bench',
    `outside tray → bench (got ${outside && outside.targetEntry.id})`);
  assert(outside.placeY === 1, `bench placeY=1 (got ${outside.placeY})`);
}

// ===========================================================================
// T6d Regression: stacking on an item that's already on a bench. Cursor
// over itemA (on bench) with a new stackable should target itemA (not the
// bench) so the new item lands on top of itemA, not beside it.
// ===========================================================================
console.log('\n--- T6d: stack onto item that is already on bench ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);
  const itemA = placeItem(reg, bench, { id: 'itemA', subCol: 2, subRow: 1 });
  const subgrid = buildSubgrid([bench]);

  const res = findStackTarget(itemDef, 0, 0, 2, 1, 0, subgrid, reg.getEntry, reg.getDef);
  assert(res !== null, `returns a target (got ${res})`);
  assert(res && res.targetEntry.id === 'itemA',
    `targets itemA, not bench (got ${res && res.targetEntry.id})`);
  // itemA is stackable + defaults hasSurface at def level; its surfaceY is
  // undefined so canStack uses subH=1. New item's placeY = itemA.placeY + 1.
  assert(res && res.placeY === itemA.placeY + 1,
    `placeY is one step above itemA (expected ${itemA.placeY + 1}, got ${res && res.placeY})`);
}

// ===========================================================================
// T6b findStackTarget returns null when footprint straddles two ground items.
// ===========================================================================
console.log('\n--- T6b: footprint straddles two ground items → null ---');
{
  const reg = makeRegistry();
  const benchA = placeBench(reg, { id: 'benchA', col: 0, row: 0 });
  // Second bench def shares the same type but at a different position.
  const benchB = (() => {
    const def = reg.getDef('bench');
    const cells = def.footprintCells(1, 0, 0, 0, 0);
    return reg.addEntry(mockEntry({
      id: 'benchB', type: 'bench', col: 1, row: 0, cells,
    }));
  })();
  const subgrid = buildSubgrid([benchA, benchB]);

  // A 2-wide item straddling the boundary between col=0 and col=1.
  const wideDef = mockDef({ type: 'wide', subW: 2, subL: 1, subH: 1, stackable: true });
  reg.addDef(wideDef);

  // Footprint at col=0, subCol=3 spans (col=0, subCol=3) and (col=1, subCol=0).
  const res = findStackTarget(wideDef, 0, 0, 3, 0, 0, subgrid, reg.getEntry, reg.getDef);
  assert(res === null, `straddling two ground items rejected (got ${JSON.stringify(res)})`);
}

// ===========================================================================
// T6c findStackTarget returns null when a sibling partially overlaps.
// ===========================================================================
console.log('\n--- T6c: partial sibling overlap → findStackTarget null ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  // A 1×1 sibling occupies subCol=2,subRow=0.
  reg.addDef(mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true }));
  placeItem(reg, bench, { id: 'itemA', subCol: 2, subRow: 0 });
  const subgrid = buildSubgrid([bench]);

  // A 2-wide ghost at subCol=1..2 partially overlaps itemA. No single child
  // fully contains the 2-wide footprint, so descent stops at bench; canStack
  // on bench fails because the sibling's subtile (2,0) is in our footprint.
  const wideDef = mockDef({ type: 'wide', subW: 2, subL: 1, subH: 1, stackable: true });
  reg.addDef(wideDef);
  const res = findStackTarget(wideDef, 0, 0, 1, 0, 0, subgrid, reg.getEntry, reg.getDef);
  assert(res === null,
    `partial sibling overlap returns null (got ${JSON.stringify(res)})`);
}

// ===========================================================================
// T4 Remove mid-tree (tray under bench) — child re-parents to bench.
// ===========================================================================
console.log('\n--- T4: remove tray → item re-parents to bench ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const tray = placeTray(reg, bench, { id: 'tray1', subCol: 0, subRow: 0 });
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);
  const item = placeItem(reg, tray, { id: 'itemA', subCol: 0, subRow: 0 });
  assert(item.placeY === 2, `item on tray starts at placeY=2 (got ${item.placeY})`);

  const updates = collapsePlan('tray1', reg.getEntry, reg.getDef);
  assert(Array.isArray(updates), 'collapsePlan returned updates');
  // Expect one update for itemA: newParent=bench, newPlaceY=1.
  assert(updates.length === 1, `one update (got ${updates.length})`);
  const u = updates[0];
  assert(u.id === 'itemA', `update is for itemA (got ${u.id})`);
  assert(u.newStackParentId === 'bench',
    `newStackParentId=bench (got ${u.newStackParentId})`);
  assert(u.newPlaceY === 1, `newPlaceY=1 (got ${u.newPlaceY})`);
}

// ===========================================================================
// T5 Remove ground bench with 3 siblings — each drops to ground.
// ===========================================================================
console.log('\n--- T5: remove ground bench → 3 siblings drop to ground ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);
  placeItem(reg, bench, { id: 'i1', subCol: 0, subRow: 0 });
  placeItem(reg, bench, { id: 'i2', subCol: 1, subRow: 0 });
  placeItem(reg, bench, { id: 'i3', subCol: 2, subRow: 1 });

  const updates = collapsePlan('bench', reg.getEntry, reg.getDef);
  assert(Array.isArray(updates), 'collapsePlan returned updates');
  assert(updates.length === 3, `three updates (got ${updates.length})`);
  for (const u of updates) {
    assert(u.newStackParentId === null,
      `${u.id} re-parents to ground (got ${u.newStackParentId})`);
    assert(u.newPlaceY === 0, `${u.id} newPlaceY=0 (got ${u.newPlaceY})`);
  }

  // Apply updates; verify a derived subgridOccupied would place the items on
  // the ground (the Game-level application is responsible for this; we
  // simulate it here to sanity-check the plan is coherent).
  const appliedOcc = {};
  for (const u of updates) {
    const ent = reg.getEntry(u.id);
    const def = reg.getDef(ent.type);
    // Child cells are stored relative to the bench's col/row; after re-parent
    // they remain at the same col/row/subCol/subRow (cells don't change).
    const cells = def.footprintCells(ent.col, ent.row, ent.subCol, ent.subRow, ent.dir);
    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      appliedOcc[k] = { id: ent.id };
    }
  }
  // Three 1×1 items occupy three distinct cells.
  assert(Object.keys(appliedOcc).length === 3,
    `3 cells in derived subgrid (got ${Object.keys(appliedOcc).length})`);
}

// ===========================================================================
// T5b Deeply nested: remove grandparent preserves non-direct descendants.
// ===========================================================================
console.log('\n--- T5b: remove grandparent — direct children shift, grandchildren follow ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const tray = placeTray(reg, bench, { id: 'tray1', subCol: 0, subRow: 0 });
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);
  placeItem(reg, tray, { id: 'itemA', subCol: 0, subRow: 0 });

  // Remove bench → tray re-parents to ground, itemA follows tray (still on tray).
  const updates = collapsePlan('bench', reg.getEntry, reg.getDef);
  assert(Array.isArray(updates), 'returned updates');
  // Expect 2 updates: tray drops to ground (placeY 1→0), itemA drops w/ tray (2→1).
  const byId = Object.fromEntries(updates.map(u => [u.id, u]));
  assert(byId.tray1 && byId.tray1.newPlaceY === 0 && byId.tray1.newStackParentId === null,
    `tray → ground placeY=0 (got ${JSON.stringify(byId.tray1)})`);
  assert(byId.itemA && byId.itemA.newPlaceY === 1 && byId.itemA.newStackParentId === 'tray1',
    `itemA stays on tray placeY=1 (got ${JSON.stringify(byId.itemA)})`);
}

// ===========================================================================
// T5c Remove leaf item (no children) — collapsePlan returns [].
// ===========================================================================
console.log('\n--- T5c: remove leaf item → empty updates ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);
  placeItem(reg, bench, { id: 'itemA', subCol: 0, subRow: 0 });

  const updates = collapsePlan('itemA', reg.getEntry, reg.getDef);
  assert(Array.isArray(updates) && updates.length === 0,
    `empty updates for leaf (got ${JSON.stringify(updates)})`);
}

// ===========================================================================
// T7 Save/load round-trip — structural fields survive JSON clone.
// ===========================================================================
console.log('\n--- T7: save/load round-trip (JSON clone preserves tree) ---');
{
  const reg = makeRegistry();
  const bench = placeBench(reg);
  const tray = placeTray(reg, bench, { id: 'tray1', subCol: 0, subRow: 0 });
  const itemDef = mockDef({ type: 'item', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(itemDef);
  placeItem(reg, tray, { id: 'a', subCol: 0, subRow: 0 });
  placeItem(reg, tray, { id: 'b', subCol: 1, subRow: 1 });

  const serialized = JSON.stringify([bench, tray, reg.getEntry('a'), reg.getEntry('b')]);
  const loaded = JSON.parse(serialized);
  const [lb, lt, la, lbItem] = loaded;

  assert(lb.stackChildren.length === 1 && lb.stackChildren[0] === 'tray1',
    `bench.stackChildren preserved`);
  assert(lt.stackChildren.length === 2 && lt.stackChildren.includes('a') && lt.stackChildren.includes('b'),
    `tray.stackChildren preserved (got ${JSON.stringify(lt.stackChildren)})`);
  assert(la.stackParentId === 'tray1' && lbItem.stackParentId === 'tray1',
    `parent links preserved`);
  assert(la.placeY === 2 && lbItem.placeY === 2,
    `placeY preserved`);
}

// ===========================================================================
// T8 Height cap on placement still enforced.
// ===========================================================================
console.log('\n--- T8: height cap enforced on placement ---');
{
  const reg = makeRegistry();
  // Tall surface near the cap: placeY=6, surfaceY=1 → child placeY=7.
  // A child with subH=2 would overflow (7+2=9 > 8).
  const tallDef = mockDef({
    type: 'tall', subW: 1, subL: 1, subH: 1, hasSurface: true, stackable: true, surfaceY: 1,
  });
  reg.addDef(tallDef);
  const tall = reg.addEntry(mockEntry({
    id: 'tall1', type: 'tall', col: 0, row: 0,
    cells: tallDef.footprintCells(0, 0, 0, 0, 0),
    placeY: 6,
  }));

  const bigDef = mockDef({ type: 'big', subW: 1, subL: 1, subH: 2, stackable: true });
  reg.addDef(bigDef);
  const r = canStack(bigDef, tall, tallDef, 0, 0, 0, 0, 0, reg.getEntry);
  assert(r.ok === false, `over-cap rejected (got ${JSON.stringify(r)})`);
  assert(/height/i.test(r.reason || ''), `reason mentions height (got ${r.reason})`);

  // And just under the cap: subH=1 → placeY=7, 7+1=8 (=MAX), ok.
  const smallDef = mockDef({ type: 'small', subW: 1, subL: 1, subH: 1, stackable: true });
  reg.addDef(smallDef);
  const r2 = canStack(smallDef, tall, tallDef, 0, 0, 0, 0, 0, reg.getEntry);
  assert(r2.ok === true, `exactly at cap ok (got ${JSON.stringify(r2)})`);
  assert(r2.placeY === 7 && r2.placeY + 1 === MAX_STACK_HEIGHT,
    `placeY=7, at MAX_STACK_HEIGHT`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
