// Remove only triangles wholly inside a known opaque, closed sleeve. The
// cylinder is expressed in the ring geometry's local Z-axis coordinate frame.
// Use the sleeve's inscribed radius, not its circumradius: its polygonal wall
// must contain the complete discarded triangle regardless of radial phase.
// THREE is supplied by the renderer entry point.
export function utilityFittingBatchGeometry(object) {
  const geometry = object.geometry;
  const sleeve = object.userData?.utilitySleeveOccluder;
  const material = object.material;
  if (!sleeve || !geometry?.index || !material || Array.isArray(material)
      || material.transparent || material.opacity < 1 || material.wireframe) return geometry;
  const { radius, halfLength, centerZ = 0, radialSegments = 12 } = sleeve;
  if (!(radius > 0 && halfLength > 0 && radialSegments >= 3)) return geometry;
  const innerRadius = radius * Math.cos(Math.PI / radialSegments) - 1e-6;
  const radiusSquared = innerRadius * innerRadius;
  const positions = geometry.attributes.position;
  const inside = new Uint8Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    inside[i] = positions.getX(i) ** 2 + positions.getY(i) ** 2 < radiusSquared
      && Math.abs(positions.getZ(i) - centerZ) < halfLength - 1e-6 ? 1 : 0;
  }
  const retained = [];
  const index = geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    // A cylinder is convex, so containment of all three vertices proves the
    // entire triangle is hidden. Crossing triangles remain untouched.
    if (!(inside[a] && inside[b] && inside[c])) retained.push(a, b, c);
  }
  // Keep an entirely buried source intact rather than creating an empty
  // instance range in the shared merge/picking representation.
  if (retained.length === 0 || retained.length === index.count) return geometry;
  const batchGeometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    batchGeometry.setAttribute(name, attribute);
  }
  batchGeometry.setIndex(retained);
  return batchGeometry;
}
