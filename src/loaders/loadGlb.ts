import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LoadedModel, PartInfo, SurfaceInfo } from '../model/types';

const loader = new GLTFLoader();

/**
 * glTF carries its own materials, so unlike STL we keep what the file says
 * rather than re-deriving surfaces from geometry — a mesh's material is the
 * author's intent, and re-splitting it would throw away the colors someone
 * exported. Each mesh becomes a part; a mesh with several materials exposes
 * one surface per material.
 */
export async function loadGlbFile(file: File): Promise<LoadedModel> {
  const buffer = await file.arrayBuffer();
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer, '', resolve, (err) => reject(asError(err, file.name)));
  });

  const root = new THREE.Group();
  root.add(gltf.scene);

  const parts: PartInfo[] = [];
  let triangleCount = 0;

  gltf.scene.traverse((object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) return;
    const part = buildPart(object, parts.length);
    if (!part) return;
    parts.push(part);
    triangleCount += countTriangles(object.geometry);
  });

  if (parts.length === 0) {
    throw new Error('This glTF file contains no meshes to display.');
  }

  return {
    kind: 'glb',
    fileName: file.name,
    root,
    parts,
    triangleCount,
  };
}

function asError(err: unknown, fileName: string): Error {
  const message = (err as { message?: string } | null)?.message;
  return new Error(
    message
      ? `Could not read ${fileName}: ${message}`
      : `Could not read ${fileName}. Compressed glTF (Draco or KTX2) isn't supported.`,
  );
}

function countTriangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  const count = index ? index.count : geometry.getAttribute('position')?.count ?? 0;
  return Math.floor(count / 3);
}

/**
 * Surface selection, recoloring and the highlight all assume a standard
 * material (they touch `color` and `emissive`), so anything else — an unlit
 * material, say — is converted while keeping its look.
 */
function toStandardMaterial(material: THREE.Material): THREE.MeshStandardMaterial {
  if (material instanceof THREE.MeshStandardMaterial) return material;

  const source = material as THREE.MeshBasicMaterial;
  const converted = new THREE.MeshStandardMaterial({
    color: source.color ? source.color.clone() : new THREE.Color(0xcccccc),
    map: source.map ?? null,
    transparent: material.transparent,
    opacity: material.opacity,
    side: material.side,
    roughness: 0.6,
    metalness: 0.05,
  });
  converted.name = material.name;
  return converted;
}

function buildPart(mesh: THREE.Mesh, partIndex: number): PartInfo | null {
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.count === 0) return null;

  if (!mesh.geometry.getAttribute('normal')) {
    mesh.geometry.computeVertexNormals();
  }

  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const materials = sourceMaterials.map(toStandardMaterial);
  mesh.material = materials.length > 1 ? materials : materials[0];

  const totalTriangles = countTriangles(mesh.geometry);
  const groups = mesh.geometry.groups;

  const surfaces: SurfaceInfo[] = materials.map((material, materialIndex) => {
    const groupTriangles = groups
      .filter((group) => (group.materialIndex ?? 0) === materialIndex)
      .reduce((sum, group) => sum + group.count / 3, 0);
    return {
      materialIndex,
      name: materials.length > 1 ? `Surface ${materialIndex + 1}` : material.name || 'Surface 1',
      triangleCount: groups.length > 0 ? groupTriangles : totalTriangles,
      material,
      originalColor: material.color.clone(),
    };
  });

  return {
    id: `part-${partIndex}`,
    name: mesh.name || `Part ${partIndex + 1}`,
    mesh,
    surfaces,
  };
}
