// The build revision changes whenever an authored asset changes. Development
// and Node fixtures retain ordinary paths; versioned production paths are immutable.
export function assetUrl(path, revision = typeof __BEAMLINE_ASSET_REVISION__ === 'string'
  ? __BEAMLINE_ASSET_REVISION__ : '') {
  if (!revision || typeof path !== 'string' || !path.startsWith('assets/')) return path;
  return `versioned-assets/${revision}/${path.slice(7)}`;
}
