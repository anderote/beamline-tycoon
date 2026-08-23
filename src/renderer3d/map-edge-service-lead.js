// Procedural incoming conductors for an off-map utility service point.
// Path calculation is exported separately from Three.js construction so the
// exact "terminates at the map edge" contract is testable without a browser.

function inverseYawPoint(point, pose) {
  const dx = point.x - pose.x;
  const dz = point.z - pose.z;
  const c = Math.cos(pose.rotY || 0);
  const s = Math.sin(pose.rotY || 0);
  return {
    x: c * dx - s * dz,
    y: point.y - pose.y,
    z: s * dx + c * dz,
  };
}

function yawPoint(point, pose) {
  const c = Math.cos(pose.rotY || 0);
  const s = Math.sin(pose.rotY || 0);
  return {
    x: pose.x + c * point.x + s * point.z,
    y: pose.y + point.y,
    z: pose.z - s * point.x + c * point.z,
  };
}

export function mapEdgeServiceLeadPaths(connection, pose = { x: 0, y: 0, z: 0, rotY: 0 }) {
  if (!connection?.insideMap || !connection.startWorld || !connection.endWorld) return [];
  const count = Math.max(1, Math.floor(connection.conductorCount || 3));
  const spacing = Number(connection.conductorSpacingMeters) || 0.34;
  const sag = Math.max(0, Number(connection.sagMeters) || 0.22);
  const spreadOnX = connection.edge === 'north' || connection.edge === 'south';
  const terminals = Array.isArray(connection.terminalPointsLocal)
    && connection.terminalPointsLocal.length === count
    ? connection.terminalPointsLocal
    : null;
  const paths = [];
  for (let index = 0; index < count; index++) {
    const offset = (index - (count - 1) / 2) * spacing;
    const start = terminals
      ? yawPoint(terminals[index], pose)
      : { ...connection.startWorld };
    const end = terminals
      ? { ...start }
      : { ...connection.endWorld };
    if (terminals) {
      // Project each real terminal straight to the selected map boundary. The
      // conductors keep their own height and lateral station instead of
      // converging on an invented cabinet bushing.
      if (spreadOnX) end.z = connection.endWorld.z;
      else end.x = connection.endWorld.x;
    } else if (spreadOnX) {
      start.x += offset;
      end.x += offset;
    } else {
      start.z += offset;
      end.z += offset;
    }
    const control = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2 - sag,
      z: (start.z + end.z) / 2,
    };
    paths.push({
      index,
      world: { start, control, end },
      local: {
        start: inverseYawPoint(start, pose),
        control: inverseYawPoint(control, pose),
        end: inverseYawPoint(end, pose),
      },
    });
  }
  return paths;
}

function disposeLead(group) {
  if (!group) return;
  group.traverse(child => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material?.dispose?.();
  });
  group.parent?.remove(group);
}

/** Attach or refresh the derived conductor group on a component wrapper. */
export function syncMapEdgeServiceLeadVisual(wrapper, connection, pose, options = {}) {
  if (!wrapper || typeof THREE === 'undefined') return null;
  const signature = connection?.insideMap
    ? JSON.stringify([connection, pose, options.ghost === true, options.color || null])
    : '';
  if (wrapper.userData.mapEdgeLeadSignature === signature) {
    return wrapper.userData.mapEdgeLeadGroup || null;
  }
  disposeLead(wrapper.userData.mapEdgeLeadGroup);
  wrapper.userData.mapEdgeLeadGroup = null;
  wrapper.userData.mapEdgeLeadSignature = signature;
  if (!signature) return null;

  const paths = mapEdgeServiceLeadPaths(connection, pose);
  if (paths.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'mapEdgeServiceLead';
  const ghost = options.ghost === true;
  const color = options.color ?? 0x25282b;
  for (const path of paths) {
    const start = new THREE.Vector3(path.local.start.x, path.local.start.y, path.local.start.z);
    const control = new THREE.Vector3(path.local.control.x, path.local.control.y, path.local.control.z);
    const end = new THREE.Vector3(path.local.end.x, path.local.end.y, path.local.end.z);
    const curve = new THREE.QuadraticBezierCurve3(start, control, end);
    const length = start.distanceTo(end);
    const geometry = new THREE.TubeGeometry(
      curve, Math.max(8, Math.ceil(length * 3)),
      connection.conductorRadiusMeters || 0.035, 6, false,
    );
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.28,
      transparent: ghost,
      opacity: ghost ? 0.58 : 1,
      depthWrite: !ghost,
    });
    const wire = new THREE.Mesh(geometry, material);
    wire.castShadow = !ghost;
    wire.receiveShadow = false;
    wire.renderOrder = ghost ? 999 : 0;
    group.add(wire);

  }
  wrapper.add(group);
  wrapper.userData.mapEdgeLeadGroup = group;
  return group;
}
