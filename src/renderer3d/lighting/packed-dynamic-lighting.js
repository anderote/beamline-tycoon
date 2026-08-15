import { Lighting, LightsNode } from 'three/webgpu';
import { nodeObject } from 'three/tsl';
import DynamicLightsNode from 'three/addons/tsl/lighting/DynamicLightsNode.js';
import AmbientLightDataNode from 'three/addons/tsl/lighting/data/AmbientLightDataNode.js';
import DirectionalLightDataNode from 'three/addons/tsl/lighting/data/DirectionalLightDataNode.js';
import HemisphereLightDataNode from 'three/addons/tsl/lighting/data/HemisphereLightDataNode.js';
import { PackedPointLightDataNode } from './packed-point-light-data-node.js';
import { PackedSpotLightDataNode } from './packed-spot-light-data-node.js';

const _defaultLights = new LightsNode();
const _lightNodeRef = new WeakMap();

const DATA_NODES = {
  AmbientLight: AmbientLightDataNode,
  DirectionalLight: DirectionalLightDataNode,
  PointLight: PackedPointLightDataNode,
  SpotLight: PackedSpotLightDataNode,
  HemisphereLight: HemisphereLightDataNode,
};

const MAX_PROPS = {
  DirectionalLight: 'maxDirectionalLights',
  PointLight: 'maxPointLights',
  SpotLight: 'maxSpotLights',
  HemisphereLight: 'maxHemisphereLights',
};

function canBatch(light) {
  const projectedSpot = light.isSpotLight === true
    && (light.map !== null || light.colorNode !== undefined);
  return light.isNode !== true
    && light.castShadow !== true
    && !projectedSpot
    && DATA_NODES[light.constructor.name] !== undefined;
}

class PackedDynamicLightsNode extends DynamicLightsNode {
  setupLightsNode(builder) {
    const lightNodes = [];
    const lightsByType = new Map();
    const lights = [...this._lights].sort((a, b) => a.id - b.id);
    const nodeLibrary = builder.renderer.library;

    for (const light of lights) {
      if (light.isNode === true) {
        lightNodes.push(nodeObject(light));
      } else if (canBatch(light)) {
        const type = light.constructor.name;
        const list = lightsByType.get(type);
        if (list) list.push(light);
        else lightsByType.set(type, [light]);
      } else {
        const LightNodeClass = nodeLibrary.getLightNodeClass(light.constructor);
        if (LightNodeClass === null) {
          console.warn(`THREE.PackedDynamicLightsNode: Light node not found for ${light.constructor.name}.`);
          continue;
        }
        let node = _lightNodeRef.get(light);
        if (!node) {
          node = new LightNodeClass(light);
          _lightNodeRef.set(light, node);
        }
        lightNodes.push(node);
      }
    }

    for (const [type, typeLights] of lightsByType) {
      let dataNode = this._dataNodes.get(type);
      if (!dataNode) {
        const DataNode = DATA_NODES[type];
        const prop = MAX_PROPS[type];
        dataNode = prop ? new DataNode(this[prop]) : new DataNode();
        this._dataNodes.set(type, dataNode);
      }
      dataNode.setLights(typeLights);
      lightNodes.push(dataNode);
    }

    for (const [type, dataNode] of this._dataNodes) {
      if (!lightsByType.has(type)) {
        dataNode.setLights([]);
        lightNodes.push(dataNode);
      }
    }
    // r184 LightsNode stores this list for hashing/building; setup is a
    // mutating hook rather than the r185 return-value form.
    this._lightNodes = lightNodes;
  }
}

/** DynamicLighting with packed point/spot buffers to preserve bindings for shadows. */
export class PackedDynamicLighting extends Lighting {
  constructor(options = {}) {
    super();
    this.options = {
      maxDirectionalLights: 4,
      maxPointLights: 32,
      maxSpotLights: 64,
      maxHemisphereLights: 2,
      ...options,
    };
    this._nodes = new WeakMap();
  }

  createNode(lights = []) {
    return new PackedDynamicLightsNode(this.options).setLights(lights);
  }

  getNode(scene) {
    if (scene.isQuadMesh) return _defaultLights;
    let node = this._nodes.get(scene);
    if (!node) {
      node = this.createNode();
      this._nodes.set(scene, node);
    }
    return node;
  }
}

export default PackedDynamicLighting;
