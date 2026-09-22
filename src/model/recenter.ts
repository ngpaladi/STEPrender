import * as THREE from 'three';

/**
 * Shifts a file's contents so the root's origin sits at the centre of
 * everything it holds, leaving the contents' positions relative to each other
 * untouched.
 *
 * Source files put the origin wherever the authoring tool did — often at an
 * assembly datum well outside the geometry. The transform gizmo pivots on the
 * object's origin, so without this a rotation swings the whole file through an
 * arc instead of turning it in place.
 *
 * Operates on the root's direct children rather than on parts, so it stays
 * correct for formats that arrive as a nested scene graph. Call it while the
 * root still has an identity transform, before layout.
 */
export function recenterDocumentOnItself(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  for (const child of root.children) {
    child.position.sub(center);
  }
  root.updateMatrixWorld(true);
}
