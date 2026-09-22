import * as THREE from 'three';
import type { SurfaceInfo, SurfaceTexture } from '../model/types';

/**
 * Image textures for a single surface.
 *
 * None of the formats we read supply UVs — STEP and STL have no notion of
 * them, and a GLB may or may not — so a surface's UVs are generated here by
 * projecting its vertices onto a plane perpendicular to its average normal.
 * The projection is in model units, which lets both modes be expressed purely
 * as a texture transform: tiling divides by a tile size, fitting divides by
 * the surface's own extent.
 *
 * Each surface's vertices belong to it alone (OCCT meshes each face
 * separately, and the STL loader reorders triangles so patches are
 * contiguous), so writing UVs per surface never disturbs a neighbour.
 */

export interface SurfaceProjection {
  minU: number;
  minV: number;
  extentU: number;
  extentV: number;
}

function triangleRanges(
  geometry: THREE.BufferGeometry,
  materialIndex: number,
): { first: number; last: number }[] {
  const index = geometry.getIndex();
  const total = index ? index.count : geometry.getAttribute('position').count;
  if (geometry.groups.length === 0) return [{ first: 0, last: total / 3 }];
  return geometry.groups
    .filter((group) => (group.materialIndex ?? 0) === materialIndex)
    .map((group) => ({ first: group.start / 3, last: (group.start + group.count) / 3 }));
}

/**
 * Writes UVs for one surface and returns the extent it occupies.
 *
 * Rotation turns the projection basis rather than using `texture.rotation`,
 * so the extent is measured in the rotated frame. That keeps full-size mode
 * exact at any angle — turning the image inside a fixed box would otherwise
 * leave it overflowing on two sides and short on the other two.
 */
export function projectSurfaceUVs(
  mesh: THREE.Mesh,
  materialIndex: number,
  rotationDegrees = 0,
): SurfaceProjection | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return null;
  const index = geometry.getIndex();

  let uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== position.count) {
    uv = new THREE.BufferAttribute(new Float32Array(position.count * 2), 2);
    geometry.setAttribute('uv', uv);
  }

  const vertexIndices = new Set<number>();
  const normal = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (const range of triangleRanges(geometry, materialIndex)) {
    for (let t = range.first; t < range.last; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      vertexIndices.add(i0);
      vertexIndices.add(i1);
      vertexIndices.add(i2);

      a.fromBufferAttribute(position, i0);
      b.fromBufferAttribute(position, i1);
      c.fromBufferAttribute(position, i2);
      // Un-normalized cross products area-weight the average for free, so
      // large faces dominate the projection plane of a curved surface.
      normal.add(ab.subVectors(b, a).cross(ac.subVectors(c, a)));
    }
  }

  if (vertexIndices.size === 0) return null;
  if (normal.lengthSq() === 0) normal.set(0, 0, 1);
  normal.normalize();

  const axisU = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(axisU)) > 0.9) axisU.set(0, 1, 0);
  axisU.cross(normal).normalize();
  const axisV = new THREE.Vector3().crossVectors(normal, axisU).normalize();

  if (rotationDegrees !== 0) {
    // Negated so a positive angle turns the image the way it reads, rather
    // than turning the frame the image is measured against.
    const radians = -(rotationDegrees * Math.PI) / 180;
    axisU.applyAxisAngle(normal, radians);
    axisV.applyAxisAngle(normal, radians);
  }

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const point = new THREE.Vector3();

  for (const vertexIndex of vertexIndices) {
    point.fromBufferAttribute(position, vertexIndex);
    const u = point.dot(axisU);
    const v = point.dot(axisV);
    uv.setXY(vertexIndex, u, v);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  uv.needsUpdate = true;

  return {
    minU,
    minV,
    extentU: maxU - minU || 1,
    extentV: maxV - minV || 1,
  };
}

/** Both modes are just a transform over the model-unit UVs. */
export function applyTextureTransform(texture: THREE.Texture, state: SurfaceTexture): void {
  const wrap = state.mode === 'fit' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (texture.wrapS !== wrap) {
    // Wrapping is set when the texture is uploaded, so it needs a re-upload;
    // repeat and offset alone do not.
    texture.wrapS = wrap;
    texture.wrapT = wrap;
    texture.needsUpdate = true;
  }

  if (state.mode === 'fit') {
    texture.repeat.set(1 / state.extentU, 1 / state.extentV);
    texture.offset.set(-state.minU / state.extentU, -state.minV / state.extentV);
  } else {
    const tile = state.scale > 0 ? state.scale : 1;
    texture.repeat.set(1 / tile, 1 / tile);
    texture.offset.set(0, 0);
  }
}

export async function loadTextureFromFile(
  file: File,
  maxAnisotropy: number,
): Promise<THREE.Texture> {
  const url = URL.createObjectURL(file);
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function setSurfaceTexture(
  mesh: THREE.Mesh,
  surface: SurfaceInfo,
  texture: THREE.Texture,
  sourceName: string,
): void {
  const projection = projectSurfaceUVs(mesh, surface.materialIndex);
  if (!projection) throw new Error('This surface has no geometry to map a texture onto.');

  // A tile spanning roughly a quarter of the surface reads as a texture
  // rather than as one stretched image or a moiré of tiny repeats.
  const suggested = Math.max(projection.extentU, projection.extentV) / 4;

  surface.texture = {
    ...projection,
    mode: 'tile',
    scale: suggested > 0 ? suggested : 1,
    rotation: 0,
    sourceName,
  };

  surface.material.map?.dispose();
  surface.material.map = texture;
  // The map multiplies with the base color, so a tinted surface would stain
  // the image.
  surface.material.color.set('#ffffff');
  surface.material.needsUpdate = true;
  applyTextureTransform(texture, surface.texture);
}

/**
 * Re-applies a surface's texture settings after they change. The projection
 * is only redone when the angle moved, since re-measuring every vertex on a
 * dense surface is wasted work for a tile-size tweak.
 */
export function refreshSurfaceTexture(mesh: THREE.Mesh, surface: SurfaceInfo): void {
  const state = surface.texture;
  const map = surface.material.map;
  if (!state || !map) return;

  if (state.rotation !== appliedRotations.get(surface)) {
    const projection = projectSurfaceUVs(mesh, surface.materialIndex, state.rotation);
    if (projection) Object.assign(state, projection);
    appliedRotations.set(surface, state.rotation);
  }

  applyTextureTransform(map, state);
}

const appliedRotations = new WeakMap<SurfaceInfo, number>();

export function clearSurfaceTexture(surface: SurfaceInfo): void {
  surface.material.map?.dispose();
  surface.material.map = null;
  surface.material.color.copy(surface.originalColor);
  surface.material.needsUpdate = true;
  surface.texture = undefined;
}
