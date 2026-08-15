import { MeshBasicNodeMaterial } from 'three/webgpu';
import { positionLocal, positionWorld, sin, smoothstep, uniform } from 'three/tsl';

function createModernVolumetricLightMaterial() {
  const uniforms = {
    uColor: uniform(new THREE.Color(0xffffff)),
    uOpacity: uniform(0),
    uLength: uniform(1),
    uRadius: uniform(1),
    uTime: uniform(0),
    uPhase: uniform(0),
  };

  // ConeGeometry is one unit high, centred on the origin and widens toward
  // local -Y. Fade both ends and the shell edge so this reads as suspended
  // atmosphere, never as an opaque cone object.
  const axial = positionLocal.y.negate().add(0.5).clamp(0, 1);
  const localRadius = uniforms.uRadius.mul(axial).max(0.001);
  const edge = positionLocal.xz.length().div(localRadius);
  const radial = smoothstep(1, 0.42, edge);
  const longitudinal = smoothstep(0, 0.12, axial)
    .mul(smoothstep(1, 0.78, axial));
  const drift = sin(positionWorld.y.mul(5).add(uniforms.uTime.mul(0.35)).add(uniforms.uPhase))
    .mul(0.1).add(0.9);

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.colorNode = uniforms.uColor;
  material.opacityNode = uniforms.uOpacity.mul(radial).mul(longitudinal).mul(drift);
  // Preserve the tiny uniform facade consumed by VolumetricLightPool so both
  // renderer implementations share the same update path.
  material.uniforms = uniforms;
  return material;
}

export function createVolumetricLightMaterial({ modern = false } = {}) {
  if (modern) return createModernVolumetricLightMaterial();
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 0 },
      uLength: { value: 1 },
      uRadius: { value: 1 },
      uTime: { value: 0 },
      uPhase: { value: 0 },
    },
    vertexShader: `
      uniform float uLength;
      uniform float uRadius;
      varying float vAxial;
      varying float vEdge;
      varying vec3 vWorld;
      void main() {
        vAxial = clamp(0.5 - position.y / max(0.001, uLength), 0.0, 1.0);
        float localRadius = max(0.001, uRadius * vAxial);
        vEdge = length(position.xz) / localRadius;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uPhase;
      varying float vAxial;
      varying float vEdge;
      varying vec3 vWorld;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        float radial = 1.0 - smoothstep(0.42, 1.0, vEdge);
        float longitudinal = smoothstep(0.0, 0.12, vAxial) * (1.0 - smoothstep(0.78, 1.0, vAxial));
        float drift = 0.9 + 0.1 * sin(vWorld.y * 5.0 + uTime * 0.35 + uPhase);
        float dither = mix(0.94, 1.06, hash(floor(gl_FragCoord.xyz + uPhase * 9.0)));
        float alpha = uOpacity * radial * longitudinal * drift * dither;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
