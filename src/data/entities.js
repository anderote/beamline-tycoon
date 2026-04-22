// src/data/entities.js
//
// Consumer shim: re-exports ENTITIES_RAW as ENTITIES and provides a
// typed lookup helper.

import { ENTITIES_RAW } from './entities.raw.js';

export const ENTITIES = ENTITIES_RAW;

/**
 * Look up a species by id. Throws on unknown ids so callers get a clear
 * error rather than a silent undefined.
 *
 * @param {string} id
 * @returns {object}
 */
export function getEntityType(id) {
  const entity = ENTITIES[id];
  if (!entity) {
    throw new Error(`Unknown entity type: "${id}"`);
  }
  return entity;
}
