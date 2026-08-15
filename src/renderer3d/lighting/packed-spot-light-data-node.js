import { Color, Node, Vector3, Vector4 } from 'three/webgpu';
import {
  Loop, NodeUpdateType, getDistanceAttenuation, positionView,
  renderGroup, smoothstep, uniform, uniformArray, vec3,
} from 'three/tsl';

const _lightPosition = new Vector3();
const _targetPosition = new Vector3();
const _color = new Color();

/**
 * Dynamic spot lights packed into one uniform buffer binding. Three's stock
 * node uses four bindings; that collides with the bind-group cost of several
 * independent shadow nodes long before WebGPU runs out of actual buffer space.
 */
export class PackedSpotLightDataNode extends Node {
  constructor(maxCount = 64) {
    super();
    this.maxCount = maxCount;
    this._lights = [];
    this._records = Array.from({ length: maxCount * 4 }, () => new Vector4());
    this.recordsNode = uniformArray(this._records, 'vec4').setGroup(renderGroup);
    this.countNode = uniform(0, 'int').setGroup(renderGroup);
    this.updateType = NodeUpdateType.RENDER;
  }

  setLights(lights) {
    if (lights.length > this.maxCount) {
      console.warn(`THREE.PackedSpotLightDataNode: ${lights.length} lights exceed ${this.maxCount}; excess lights are ignored.`);
    }
    this._lights = lights;
    return this;
  }

  update({ camera }) {
    const count = Math.min(this._lights.length, this.maxCount);
    this.countNode.value = count;
    for (let i = 0; i < count; i++) {
      const light = this._lights[i];
      const base = i * 4;
      const color = this._records[base];
      const position = this._records[base + 1];
      const direction = this._records[base + 2];
      const cone = this._records[base + 3];

      _color.copy(light.color).multiplyScalar(light.intensity);
      color.set(_color.r, _color.g, _color.b, light.distance);

      _lightPosition.setFromMatrixPosition(light.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      position.set(_lightPosition.x, _lightPosition.y, _lightPosition.z, light.decay);

      _lightPosition.setFromMatrixPosition(light.matrixWorld);
      _targetPosition.setFromMatrixPosition(light.target.matrixWorld);
      _lightPosition.sub(_targetPosition).transformDirection(camera.matrixWorldInverse);
      direction.set(_lightPosition.x, _lightPosition.y, _lightPosition.z, Math.cos(light.angle));
      cone.set(Math.cos(light.angle * (1 - light.penumbra)), 0, 0, 0);
    }
  }

  setup(builder) {
    const surfacePosition = builder.context.positionView || positionView;
    const { lightingModel, reflectedLight } = builder.context;
    const dynDiffuse = vec3(0).toVar('packedSpotDiffuse');
    const dynSpecular = vec3(0).toVar('packedSpotSpecular');

    Loop(this.countNode, ({ i }) => {
      const base = i.mul(4);
      const colorAndCutoff = this.recordsNode.element(base);
      const positionAndDecay = this.recordsNode.element(base.add(1));
      const directionAndCone = this.recordsNode.element(base.add(2));
      const cone = this.recordsNode.element(base.add(3));
      const lightVector = positionAndDecay.xyz.sub(surfacePosition).toVar();
      const lightDirection = lightVector.normalize().toVar();
      const lightDistance = lightVector.length();
      const spotAttenuation = smoothstep(
        directionAndCone.w,
        cone.x,
        lightDirection.dot(directionAndCone.xyz),
      );
      const distanceAttenuation = getDistanceAttenuation({
        lightDistance,
        cutoffDistance: colorAndCutoff.w,
        decayExponent: positionAndDecay.w,
      });
      const lightColor = colorAndCutoff.rgb.mul(spotAttenuation).mul(distanceAttenuation).toVar();
      lightingModel.direct({
        lightDirection,
        lightColor,
        lightNode: { light: {}, shadowNode: null },
        reflectedLight: { directDiffuse: dynDiffuse, directSpecular: dynSpecular },
      }, builder);
    });

    reflectedLight.directDiffuse.addAssign(dynDiffuse);
    reflectedLight.directSpecular.addAssign(dynSpecular);
  }
}

export default PackedSpotLightDataNode;
