import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { LoadedModel, PartInfo, SurfaceInfo } from '../model/types';
import { defaultColorFor } from '../model/palette';
import { groupTrianglesIntoSurfaces } from './surfaceGrouping';

const loader = new STLLoader();

/** Angle (degrees) between adjacent triangle normals beyond which we treat
 * them as different surfaces. Loose enough to merge a tessellated cylinder
 * or fillet into one patch, tight enough to separate it from a neighboring
 * flat face at a real edge. */
const SURFACE_ANGLE_THRESHOLD_DEG = 20;

export async function loadStlFile(file: File): Promise<LoadedModel> {
  const buffer = await file.arrayBuffer();
  const parsed = loader.parse(buffer);

  const rawPositions = parsed.getAttribute('position').array as Float32Array;
  const triangleCount = rawPositions.length / 9;
  if (triangleCount === 0) {
    throw new Error('This STL file contains no triangles.');
  }

  const { patches } = groupTrianglesIntoSurfaces(rawPositions, SURFACE_ANGLE_THRESHOLD_DEG);

  // List larger surfaces first; they're usually the ones a user cares about.
  const patchOrder = patches
    .map((triangles, patchId) => ({ patchId, triangles }))
    .sort((a, b) => b.triangles.length - a.triangles.length);

  const newPositions = new Float32Array(rawPositions.length);
  const geometry = new THREE.BufferGeometry();
  const materials: THREE.MeshStandardMaterial[] = [];
  const surfaces: SurfaceInfo[] = [];

  let vertexCursor = 0;
  patchOrder.forEach(({ triangles }, materialIndex) => {
    const startVertex = vertexCursor;
    for (const t of triangles) {
      newPositions.set(rawPositions.subarray(t * 9, t * 9 + 9), vertexCursor * 3);
      vertexCursor += 3;
    }
    const vertexCount = triangles.length * 3;
    geometry.addGroup(startVertex * 3, vertexCount, materialIndex);

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(defaultColorFor(materialIndex)),
      roughness: 0.6,
      metalness: 0.08,
      // STL winding is frequently inconsistent; render both sides so badly
      // wound facets don't show up as holes.
      side: THREE.DoubleSide,
    });
    materials.push(material);
    surfaces.push({
      materialIndex,
      name: `Surface ${materialIndex + 1}`,
      triangleCount: triangles.length,
      material,
      originalColor: material.color.clone(),
    });
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]);
  const baseName = file.name.replace(/\.[^./]+$/, '');
  mesh.name = baseName;

  const part: PartInfo = {
    id: 'part-0',
    name: baseName,
    mesh,
    surfaces,
  };

  const root = new THREE.Group();
  root.add(mesh);

  return {
    kind: 'stl',
    fileName: file.name,
    root,
    parts: [part],
    triangleCount,
  };
}
