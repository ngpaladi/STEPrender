import * as THREE from 'three';

export interface SurfaceInfo {
  /** index into the owning mesh's material array */
  materialIndex: number;
  /** display name, e.g. "Face 3" or "Surface 12" */
  name: string;
  /** number of triangles belonging to this surface, for display */
  triangleCount: number;
  material: THREE.MeshStandardMaterial;
  /** original color, used for reset */
  originalColor: THREE.Color;
}

export interface PartInfo {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  surfaces: SurfaceInfo[];
}

export interface LoadedModel {
  kind: 'step' | 'stl' | 'glb';
  fileName: string;
  root: THREE.Object3D;
  parts: PartInfo[];
  triangleCount: number;
}

/** A LoadedModel that has been added to the assembled scene. Part ids are
 * namespaced with the document id so surfaces stay addressable even when
 * several files (or the same file twice) are loaded together. */
export interface SceneDocument extends LoadedModel {
  docId: string;
}
