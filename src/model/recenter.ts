import * as THREE from 'three';
import type { PartInfo } from './types';

/**
 * Shifts a file's parts so the root's origin sits at the centre of everything
 * the file contains, leaving their positions relative to each other untouched.
 *
 * Source files put the origin wherever the authoring tool did — often at an
 * assembly datum well outside the geometry. The transform gizmo pivots on the
 * object's origin, so without this a rotation swings the whole file through an
 * arc instead of turning it in place.
 *
 * Call this while the root still has an identity transform, before layout.
 */
export function recenterDocumentOnItself(root: THREE.Object3D, parts: PartInfo[]): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  for (const part of parts) {
    part.mesh.position.sub(center);
  }
  root.updateMatrixWorld(true);
}
