const cookies = new Map();

function pixel(profile, x, y, size) {
  const nx = (x + 0.5) / size * 2 - 1;
  const ny = (y + 0.5) / size * 2 - 1;
  const r = Math.hypot(nx, ny);
  const falloff = Math.max(0, Math.min(1, (1 - r) / 0.28));
  if (profile === 'panel') return falloff * (0.82 + 0.18 * Math.cos(nx * Math.PI * 3));
  if (profile === 'cage') return falloff * ((Math.abs(nx) < 0.08 || Math.abs(ny) < 0.08) ? 0.55 : 1);
  if (profile === 'flood') return falloff * (0.9 + 0.1 * Math.cos(ny * Math.PI * 2));
  return falloff;
}

export function getLightCookie(profile = 'soft') {
  if (typeof THREE.DataTexture !== 'function') return null;
  if (cookies.has(profile)) return cookies.get(profile);
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.round(pixel(profile, x, y, size) * 255);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  cookies.set(profile, texture);
  return texture;
}

export function disposeLightCookies() {
  for (const texture of cookies.values()) texture.dispose();
  cookies.clear();
}

