import * as THREE from 'three';

/**
 * Moves a part's geometry so its origin sits at the centre of its own bounding
 * box, compensating with the mesh's position so nothing moves on screen.
 *
 * Source files put the origin wherever the authoring tool did — often at an
 * assembly datum well outside the part. The transform gizmo pivots on the
 * object's origin, so without this a rotation swings the part through an arc
 * instead of turning it in place.
 */
export function recenterGeometryOnItself(mesh: THREE.Mesh): void {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return;

  const center = box.getCenter(new THREE.Vector3());
  mesh.geometry.translate(-center.x, -center.y, -center.z);
  mesh.position.add(center);
}
