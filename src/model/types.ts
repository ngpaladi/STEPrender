import * as THREE from 'three';

export interface SurfaceTexture {
  /** 'tile' repeats every `scale` model units; 'fit' spans the surface once. */
  mode: 'tile' | 'fit';
  /** Model units covered by one tile, in tile mode. */
  scale: number;
  /** Degrees the image is turned on the surface. */
  rotation: number;
  /** Planar projection extent of the surface, in model units. */
  minU: number;
  minV: number;
  extentU: number;
  extentV: number;
  sourceName: string;
}

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
  /** present only while an image texture is applied to this surface */
  texture?: SurfaceTexture;
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
