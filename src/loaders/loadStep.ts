import * as THREE from 'three';
import occtimportjs, { OcctImportJsInstance, OcctResultMesh } from 'occt-import-js';
import type { LoadedModel, PartInfo, SurfaceInfo } from '../model/types';
import { defaultColorFor } from '../model/palette';

let occtPromise: Promise<OcctImportJsInstance> | null = null;

function getOcct(): Promise<OcctImportJsInstance> {
  if (!occtPromise) {
    occtPromise = occtimportjs({
      locateFile: (path: string) =>
        path.endsWith('.wasm') ? `${import.meta.env.BASE_URL}occt-import-js.wasm` : path,
    });
  }
  return occtPromise;
}

function makeMaterial(color: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.08 });
}

function buildPartFromResultMesh(resultMesh: OcctResultMesh, partIndex: number): PartInfo {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(resultMesh.attributes.position.array as ArrayLike<number>, 3),
  );
  if (resultMesh.attributes.normal) {
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(resultMesh.attributes.normal.array as ArrayLike<number>, 3),
    );
  } else {
    geometry.computeVertexNormals();
  }
  const indexArray = Uint32Array.from(resultMesh.index.array as ArrayLike<number>);
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  const triangleCount = indexArray.length / 3;

  const baseColor = resultMesh.color
    ? new THREE.Color(resultMesh.color[0], resultMesh.color[1], resultMesh.color[2])
    : new THREE.Color(defaultColorFor(partIndex));

  // materials[0] is a fallback for any triangle ranges not covered by a
  // named brep face; materials[i+1] corresponds to brep_faces[i].
  const materials: THREE.MeshStandardMaterial[] = [makeMaterial(baseColor)];
  const triCountByMaterial = new Map<number, number>();

  const brepFaces = resultMesh.brep_faces ?? [];
  let triangleIndex = 0;
  let faceGroupIndex = 0;
  while (triangleIndex < triangleCount) {
    let lastIndex: number;
    let materialIndex: number;

    if (faceGroupIndex >= brepFaces.length) {
      lastIndex = triangleCount;
      materialIndex = 0;
    } else if (triangleIndex < brepFaces[faceGroupIndex].first) {
      lastIndex = brepFaces[faceGroupIndex].first;
      materialIndex = 0;
    } else {
      const face = brepFaces[faceGroupIndex];
      lastIndex = face.last + 1;
      materialIndex = materials.length;
      const color = face.color
        ? new THREE.Color(face.color[0], face.color[1], face.color[2])
        : new THREE.Color(defaultColorFor(materialIndex - 1));
      materials.push(makeMaterial(color));
      faceGroupIndex += 1;
    }

    geometry.addGroup(triangleIndex * 3, (lastIndex - triangleIndex) * 3, materialIndex);
    triCountByMaterial.set(materialIndex, (triCountByMaterial.get(materialIndex) ?? 0) + (lastIndex - triangleIndex));
    triangleIndex = lastIndex;
  }

  const surfaces: SurfaceInfo[] = [];
  materials.forEach((material, materialIndex) => {
    const count = triCountByMaterial.get(materialIndex) ?? 0;
    if (count === 0) return; // unused fallback material, nothing to list
    surfaces.push({
      materialIndex,
      name: materialIndex === 0 && brepFaces.length > 0 ? 'Surface (other)' : `Surface ${surfaces.length + 1}`,
      triangleCount: count,
      material,
      originalColor: material.color.clone(),
    });
  });

  const mesh = new THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]);
  mesh.name = resultMesh.name || `Part ${partIndex + 1}`;

  return {
    id: `part-${partIndex}`,
    name: mesh.name,
    mesh,
    surfaces,
  };
}

export async function loadStepFile(file: File): Promise<LoadedModel> {
  const occt = await getOcct();
  const buffer = new Uint8Array(await file.arrayBuffer());
  const result = occt.ReadStepFile(buffer, null);

  if (!result.success || result.meshes.length === 0) {
    throw new Error('Could not parse this STEP file. It may be malformed or use unsupported entities.');
  }

  const root = new THREE.Group();
  const parts: PartInfo[] = [];
  let triangleCount = 0;

  result.meshes.forEach((resultMesh, i) => {
    const part = buildPartFromResultMesh(resultMesh, i);
    root.add(part.mesh);
    parts.push(part);
    const idx = part.mesh.geometry.index;
    triangleCount += idx ? idx.count / 3 : 0;
  });

  return {
    kind: 'step',
    fileName: file.name,
    root,
    parts,
    triangleCount,
  };
}
