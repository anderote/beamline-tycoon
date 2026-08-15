import { Color, Node, Vector3, Vector4 } from 'three/webgpu';
import {
  Loop, NodeUpdateType, getDistanceAttenuation, positionView,
  renderGroup, uniform, uniformArray, vec3,
} from 'three/tsl';

const _position = new Vector3();
const _color = new Color();

/** Point-light equivalent of PackedSpotLightDataNode: two vec4s per light. */
export class PackedPointLightDataNode extends Node {
  constructor(maxCount = 32) {
    super();
    this.maxCount = maxCount;
    this._lights = [];
    this._records = Array.from({ length: maxCount * 2 }, () => new Vector4());
    this.recordsNode = uniformArray(this._records, 'vec4').setGroup(renderGroup);
    this.countNode = uniform(0, 'int').setGroup(renderGroup);
    this.updateType = NodeUpdateType.RENDER;
  }

  setLights(lights) {
    if (lights.length > this.maxCount) {
      console.warn(`THREE.PackedPointLightDataNode: ${lights.length} lights exceed ${this.maxCount}; excess lights are ignored.`);
    }
    this._lights = lights;
    return this;
  }

  update({ camera }) {
    const count = Math.min(this._lights.length, this.maxCount);
    this.countNode.value = count;
    for (let i = 0; i < count; i++) {
      const light = this._lights[i];
      _color.copy(light.color).multiplyScalar(light.intensity);
      this._records[i * 2].set(_color.r, _color.g, _color.b, light.distance);
      _position.setFromMatrixPosition(light.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      this._records[i * 2 + 1].set(_position.x, _position.y, _position.z, light.decay);
    }
  }

  setup(builder) {
    const surfacePosition = builder.context.positionView || positionView;
    const { lightingModel, reflectedLight } = builder.context;
    const dynDiffuse = vec3(0).toVar('packedPointDiffuse');
    const dynSpecular = vec3(0).toVar('packedPointSpecular');

    Loop(this.countNode, ({ i }) => {
      const base = i.mul(2);
      const colorAndCutoff = this.recordsNode.element(base);
      const positionAndDecay = this.recordsNode.element(base.add(1));
      const lightVector = positionAndDecay.xyz.sub(surfacePosition).toVar();
      const lightDirection = lightVector.normalize().toVar();
      const lightDistance = lightVector.length();
      const attenuation = getDistanceAttenuation({
        lightDistance,
        cutoffDistance: colorAndCutoff.w,
        decayExponent: positionAndDecay.w,
      });
      const lightColor = colorAndCutoff.rgb.mul(attenuation).toVar();
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

export default PackedPointLightDataNode;
