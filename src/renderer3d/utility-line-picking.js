// Resolve utility-line ray intersections without letting the neutral carrier
// of a Universal Utility Bus hide a populated utility lane behind it.

import { mergedFarInstanceIndex } from './far-mesh-merge.js';

function worldPosition(point) {
  return point ? { x: point.x, z: point.z } : null;
}

/**
 * Resolve sorted Three.js intersections into the utility object the player
 * intended to pick. A populated bus lane carries both line and bus metadata;
 * preserve both so inspection can use the line while bus-aware build and
 * demolish tools can continue to use the carrier id.
 *
 * Across one ray, any real utility line wins over a neutral bus mesh. This is
 * important because the tray rail can be physically closer to the camera than
 * the lane running immediately above it.
 */
export function utilityLinePickFromIntersections(intersections, utilityLineGroup) {
  let busFallback = null;

  for (const hit of intersections || []) {
    let object = hit.object;
    let line = null;
    let bus = null;

    if (object?.userData?.isUtilityFarRouteBatch
        || object?.userData?.isUtilityNearDetailBatch) {
      const index = mergedFarInstanceIndex(hit);
      const lineId = Number.isInteger(index) ? object.userData.lineIds?.[index] : null;
      if (lineId) return {
        lineId,
        utilityType: object.userData.utilityTypes?.[index],
        ...(object.userData.busIds?.[index] ? {
          busId: object.userData.busIds[index],
          universalUtilityBus: true,
        } : {}),
        ...(object.userData.channelSlots?.[index] != null ? {
          channelSlot: object.userData.channelSlots[index],
        } : {}),
        worldPos: worldPosition(hit.point),
        distance: hit.distance,
      };
      const busId = Number.isInteger(index) ? object.userData.busIds?.[index] : null;
      if (busId) return {
        busId,
        universalUtilityBus: true,
        ...(object.userData.channelSlots?.[index] != null ? {
          channelSlot: object.userData.channelSlots[index],
        } : {}),
        worldPos: worldPosition(hit.point),
        distance: hit.distance,
      };
    }

    while (object) {
      const data = object.userData || {};
      if (!line && data.lineId) {
        line = {
          lineId: data.lineId,
          utilityType: data.utilityType,
        };
      }
      if (!bus && data.isUniversalUtilityBus && data.busId) {
        bus = {
          busId: data.busId,
          universalUtilityBus: true,
          ...(data.channelSlot != null ? { channelSlot: data.channelSlot } : {}),
        };
      }
      if (object.parent === utilityLineGroup) break;
      object = object.parent;
    }

    const position = worldPosition(hit.point);
    if (line) {
      return {
        ...line,
        ...(bus || {}),
        worldPos: position,
        distance: hit.distance,
      };
    }
    if (!busFallback && bus) {
      busFallback = {
        ...bus,
        worldPos: position,
        distance: hit.distance,
      };
    }
  }

  return busFallback;
}
