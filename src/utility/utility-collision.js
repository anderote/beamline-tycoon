// Runtime bridge from dependency-neutral utility routing to measured component
// geometry. The renderer registers a synchronous model-envelope lookup once it
// can instantiate real meshes; headless callers deliberately fall back to
// permissive routing instead of treating an entire 2D footprint as solid.

let _modelEnvelopeIntersects = null;

/**
 * @param {(type: string, envelope: object) => boolean|null} provider
 * Envelope coordinates are in the component model's unrotated local frame.
 */
export function setUtilityCollisionProvider(provider) {
  _modelEnvelopeIntersects = typeof provider === 'function' ? provider : null;
}

export function utilityModelEnvelopeIntersects(type, envelope) {
  if (!_modelEnvelopeIntersects || !type || !envelope) return false;
  return _modelEnvelopeIntersects(type, envelope) === true;
}

export function hasUtilityCollisionProvider() {
  return _modelEnvelopeIntersects !== null;
}
