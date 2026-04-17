// src/renderer3d/materials/decals.js
// Loads and caches decal MeshStandardMaterial instances for hero faces.
// THREE is a CDN global — do NOT import it.
//
// Decals use ClampToEdgeWrapping (no tiling) and 0→1 face UVs. The
// authored PNG should match the target face aspect ratio.
//
// Initially empty — populated as decals are authored or generated.

const BASE = 'assets/textures/decals/';

const _loader = new THREE.TextureLoader();

function loadDecal(file) {
  const tex = _loader.load(BASE + file);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function makeDecal(file, { roughness = 0.5, metalness = 0.2 } = {}) {
  return new THREE.MeshStandardMaterial({
    map: loadDecal(file),
    roughness,
    metalness,
  });
}

/**
 * Creates a soft-radial-gradient alpha texture used for ground flower decals.
 * White with alpha fading from 1.0 at center to 0.0 at edge. Small (32x32)
 * since it's rendered at ~0.2 world units.
 */
function gen_radialDot(size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

/** Shared procedural textures (not loaded from PNGs). Module-level singletons. */
export const PROC_DECAL_TEXTURES = {
  flower_dot: gen_radialDot(32),
};

/**
 * Map of decal name -> shared MeshStandardMaterial instance.
 * Populated incrementally as decals are authored. Module-level singletons.
 */
export const DECALS = {
  scope_screen: makeDecal('scope_screen.png', { roughness: 0.35, metalness: 0.1 }),
  // RF lab front-panel decals — full instrument face with bezel, screen,
  // knobs, buttons. PNG aspect matches visualSubW : visualSubH so the
  // pixel grid stays square when stretched across the 0→1 face UVs.
  oscilloscope_front:      makeDecal('oscilloscope_front.png',      { roughness: 0.6, metalness: 0.15 }),
  signal_generator_front:  makeDecal('signal_generator_front.png',  { roughness: 0.6, metalness: 0.2 }),
  spectrum_analyzer_front: makeDecal('spectrum_analyzer_front.png', { roughness: 0.6, metalness: 0.15 }),
  network_analyzer_front:  makeDecal('network_analyzer_front.png',  { roughness: 0.6, metalness: 0.15 }),
  oscilloscope_side:       makeDecal('oscilloscope_side.png',       { roughness: 0.7, metalness: 0.1 }),
  signal_generator_side:   makeDecal('signal_generator_side.png',   { roughness: 0.7, metalness: 0.15 }),
  spectrum_analyzer_side:  makeDecal('spectrum_analyzer_side.png',  { roughness: 0.7, metalness: 0.1 }),
  network_analyzer_side:   makeDecal('network_analyzer_side.png',   { roughness: 0.7, metalness: 0.1 }),

  // RF power
  klystron_pulsed_front:    makeDecal('klystron_pulsed_front.png',    { roughness: 0.6, metalness: 0.25 }),
  klystron_cw_front:        makeDecal('klystron_cw_front.png',        { roughness: 0.6, metalness: 0.25 }),
  klystron_multibeam_front: makeDecal('klystron_multibeam_front.png', { roughness: 0.6, metalness: 0.25 }),
  modulator_front:          makeDecal('modulator_front.png',          { roughness: 0.6, metalness: 0.2 }),
  ssa_rack_front:           makeDecal('ssa_rack_front.png',           { roughness: 0.6, metalness: 0.2 }),
  iot_front:                makeDecal('iot_front.png',                { roughness: 0.6, metalness: 0.25 }),

  // Cooling
  cold_box_front:           makeDecal('cold_box_front.png',           { roughness: 0.6, metalness: 0.2 }),
  he_compressor_front:      makeDecal('he_compressor_front.png',      { roughness: 0.6, metalness: 0.2 }),
  chiller_front:            makeDecal('chiller_front.png',            { roughness: 0.6, metalness: 0.2 }),

  // Vacuum
  bakeout_front:            makeDecal('bakeout_front.png',            { roughness: 0.65, metalness: 0.2 }),

  // Controls / safety / power
  rack_ioc_front:           makeDecal('rack_ioc_front.png',           { roughness: 0.55, metalness: 0.3 }),
  pps_panel:                makeDecal('pps_panel.png',                { roughness: 0.6, metalness: 0.15 }),
  mps_panel:                makeDecal('mps_panel.png',                { roughness: 0.6, metalness: 0.15 }),
  power_panel_front:        makeDecal('power_panel_front.png',        { roughness: 0.6, metalness: 0.2 }),
  switchgear_front:         makeDecal('switchgear_front.png',         { roughness: 0.6, metalness: 0.2 }),
  mcc_front:                makeDecal('mcc_front.png',                { roughness: 0.55, metalness: 0.25 }),
  ups_front:                makeDecal('ups_front.png',                { roughness: 0.55, metalness: 0.25 }),

  // Data/controls — distribution
  patch_panel_front:        makeDecal('patch_panel_front.png',        { roughness: 0.6, metalness: 0.2 }),
  network_switch_front:     makeDecal('network_switch_front.png',     { roughness: 0.55, metalness: 0.3 }),

  // Data/controls — controls
  blm_readout_front:        makeDecal('blm_readout_front.png',        { roughness: 0.6, metalness: 0.15 }),
  bpm_electronics_front:    makeDecal('bpm_electronics_front.png',    { roughness: 0.55, metalness: 0.3 }),
  archiver_front:           makeDecal('archiver_front.png',           { roughness: 0.55, metalness: 0.3 }),

  // Data/controls — safety
  search_secure_panel:      makeDecal('search_secure_panel.png',      { roughness: 0.6, metalness: 0.15 }),
  access_control_panel:     makeDecal('access_control_panel.png',     { roughness: 0.6, metalness: 0.15 }),

  // Optics lab equipment
  laser_alignment_front:  makeDecal('laser_alignment_front.png',  { roughness: 0.6, metalness: 0.2 }),
  laser_alignment_side:   makeDecal('laser_alignment_side.png',   { roughness: 0.6, metalness: 0.2 }),
  mirror_mount_front:     makeDecal('mirror_mount_front.png',     { roughness: 0.4, metalness: 0.35 }),
  beam_profiler_front:    makeDecal('beam_profiler_front.png',    { roughness: 0.6, metalness: 0.2 }),
  interferometer_front:   makeDecal('interferometer_front.png',   { roughness: 0.55, metalness: 0.25 }),
  photodetector_front:    makeDecal('photodetector_front.png',    { roughness: 0.6, metalness: 0.2 }),
  polarizer_front:        makeDecal('polarizer_front.png',        { roughness: 0.4, metalness: 0.35 }),
  fiber_coupler_front:    makeDecal('fiber_coupler_front.png',    { roughness: 0.6, metalness: 0.2 }),
  optical_chopper_front:  makeDecal('optical_chopper_front.png',  { roughness: 0.6, metalness: 0.2 }),
  power_meter_front:      makeDecal('power_meter_front.png',      { roughness: 0.6, metalness: 0.2 }),
  spatial_filter_front:   makeDecal('spatial_filter_front.png',   { roughness: 0.4, metalness: 0.35 }),

  // Diagnostics lab equipment
  scope_station_front:        makeDecal('scope_station_front.png',        { roughness: 0.5, metalness: 0.15 }),
  wire_scanner_bench_front:   makeDecal('wire_scanner_bench_front.png',   { roughness: 0.6, metalness: 0.2 }),
  wire_scanner_bench_side:    makeDecal('wire_scanner_bench_side.png',    { roughness: 0.6, metalness: 0.2 }),
  bpm_test_fixture_front:     makeDecal('bpm_test_fixture_front.png',     { roughness: 0.6, metalness: 0.2 }),
  bpm_test_fixture_side:      makeDecal('bpm_test_fixture_side.png',      { roughness: 0.6, metalness: 0.2 }),
  server_cluster_front:       makeDecal('server_cluster_front.png',       { roughness: 0.55, metalness: 0.3 }),
  server_cluster_side:        makeDecal('server_cluster_side.png',        { roughness: 0.55, metalness: 0.3 }),

  // Vacuum lab equipment
  test_chamber_front:     makeDecal('test_chamber_front.png',     { roughness: 0.55, metalness: 0.3 }),
  test_chamber_side:      makeDecal('test_chamber_side.png',      { roughness: 0.55, metalness: 0.3 }),
  leak_detector_front:    makeDecal('leak_detector_front.png',    { roughness: 0.6, metalness: 0.2 }),
  pump_cart_front:        makeDecal('pump_cart_front.png',        { roughness: 0.6, metalness: 0.25 }),
  pump_cart_side:         makeDecal('pump_cart_side.png',         { roughness: 0.6, metalness: 0.25 }),
  gas_manifold_front:     makeDecal('gas_manifold_front.png',     { roughness: 0.55, metalness: 0.3 }),
  rga_front:              makeDecal('rga_front.png',              { roughness: 0.6, metalness: 0.2 }),
  rga_side:               makeDecal('rga_side.png',               { roughness: 0.6, metalness: 0.2 }),

  // Cooling lab equipment
  coolant_pump_front:       makeDecal('coolant_pump_front.png',       { roughness: 0.6, metalness: 0.25 }),
  coolant_pump_side:        makeDecal('coolant_pump_side.png',        { roughness: 0.6, metalness: 0.25 }),
  heat_exchanger_front:     makeDecal('heat_exchanger_front.png',     { roughness: 0.6, metalness: 0.2 }),
  heat_exchanger_side:      makeDecal('heat_exchanger_side.png',      { roughness: 0.6, metalness: 0.2 }),
  pipe_rack_front:          makeDecal('pipe_rack_front.png',          { roughness: 0.65, metalness: 0.3 }),
  chiller_unit_front:       makeDecal('chiller_unit_front.png',       { roughness: 0.5, metalness: 0.15 }),
  chiller_unit_side:        makeDecal('chiller_unit_side.png',        { roughness: 0.5, metalness: 0.15 }),
  flow_meter_front:         makeDecal('flow_meter_front.png',         { roughness: 0.6, metalness: 0.25 }),
};

// Re-export so tests / future code can construct ad-hoc decal materials.
export { makeDecal };
