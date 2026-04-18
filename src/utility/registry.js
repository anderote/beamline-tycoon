// src/utility/registry.js
// Registry of all utility-type descriptors. Imports each per-utility module and
// exports a {type → descriptor} map. Adding a 7th utility = one import + entry.
//
// Descriptors populated in Phase 2; this file exists now so the shared
// core modules can import it without circular-dependency anxiety.

export const UTILITY_TYPES = {};
export const UTILITY_TYPE_LIST = [];
