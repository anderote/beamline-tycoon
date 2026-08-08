// src/renderer3d/content-hash.js
// Cheap structural content hashing for renderer builder cache keys.
//
// Builders skip a rebuild when their input data is unchanged. The previous
// guards were either `length + revision` keys (blind to same-count topology
// or brightness-only changes) or `JSON.stringify` (allocates megabyte-scale
// strings for terrain-sized arrays). `contentKey` walks the JSON-like input
// once, mixing every key and value into two independent 32-bit FNV-style
// accumulators, and returns a compact string key — no large allocations,
// and any single-field change flips the key.
//
// Supported value shapes: numbers (incl. NaN/±0 by bit pattern), strings,
// booleans, null/undefined, arrays, and plain objects. Object keys are mixed
// in own-enumerable order — snapshot builders construct literals with fixed
// key order, so this is deterministic for renderer inputs.
//
// No Three.js dependencies — safe to import from plain Node tests.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

// Type tags keep e.g. null / 0 / '' / [] / false from colliding.
const TAG_NULL = 1, TAG_UNDEF = 2, TAG_NUM = 3, TAG_STR = 4,
      TAG_TRUE = 5, TAG_FALSE = 6, TAG_ARR = 7, TAG_OBJ = 8, TAG_OTHER = 9;

function mix(s, x) {
  s.h1 = Math.imul(s.h1 ^ x, 0x01000193) >>> 0;               // FNV-1a step
  s.h2 = (Math.imul(s.h2 ^ x, 0x85ebca6b) + 0x9e3779b9) >>> 0; // independent mix
}

// Memoized 32-bit hash per distinct string. Renderer data has a tiny string
// vocabulary (object keys like 'col'/'cornersY', type names, edge letters),
// each repeated thousands of times per snapshot — hashing chars once per
// distinct string instead of per occurrence is the dominant speedup. Capped
// so pathological inputs (e.g. ever-changing cutaway keys) can't grow the
// map unboundedly.
const _strMemo = new Map();
const STR_MEMO_MAX = 4096;

function strHash32(v) {
  const memo = _strMemo.get(v);
  if (memo !== undefined) return memo;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < v.length; i++) {
    h = Math.imul(h ^ v.charCodeAt(i), 0x01000193) >>> 0;
  }
  // Mix in the length so 'aa' vs 'aŁ'-style char-sum coincidences
  // stay distinguishable beyond the FNV walk itself.
  h = Math.imul(h ^ v.length, 0x01000193) >>> 0;
  if (_strMemo.size < STR_MEMO_MAX) _strMemo.set(v, h);
  return h;
}

function hashInto(v, s) {
  if (v === null) { mix(s, TAG_NULL); return; }
  if (v === undefined) { mix(s, TAG_UNDEF); return; }
  const t = typeof v;
  if (t === 'number') {
    f64[0] = v;
    mix(s, TAG_NUM);
    mix(s, u32[0]);
    mix(s, u32[1]);
    return;
  }
  if (t === 'string') {
    mix(s, TAG_STR);
    mix(s, strHash32(v));
    return;
  }
  if (t === 'boolean') { mix(s, v ? TAG_TRUE : TAG_FALSE); return; }
  if (Array.isArray(v)) {
    mix(s, TAG_ARR);
    mix(s, v.length);
    for (let i = 0; i < v.length; i++) hashInto(v[i], s);
    return;
  }
  if (t === 'object') {
    mix(s, TAG_OBJ);
    // for..in over plain snapshot literals (no inherited enumerables) —
    // avoids the per-object array allocation of Object.keys.
    for (const k in v) {
      mix(s, TAG_STR);
      mix(s, strHash32(k));
      hashInto(v[k], s);
    }
    return;
  }
  mix(s, TAG_OTHER);
}

/**
 * Compute a compact cache-key string for a JSON-like value. Two structurally
 * equal values always produce the same key; any changed field flips it
 * (up to the ~64-bit combined hash's collision probability).
 * @param {*} value
 * @returns {string}
 */
export function contentKey(value) {
  const s = { h1: 0x811c9dc5 >>> 0, h2: 0xcbf29ce4 >>> 0 };
  hashInto(value, s);
  return s.h1.toString(36) + '.' + s.h2.toString(36);
}
