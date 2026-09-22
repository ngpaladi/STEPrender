/**
 * STL files carry no notion of "surfaces" — just a soup of triangles. To let
 * users click and recolor a surface the way they would on a STEP model, we
 * reconstruct surface patches heuristically: triangles that share an edge and
 * whose normals stay within an angle threshold of each other are merged into
 * the same patch. A tight threshold isolates flat faces; a looser one also
 * merges the many small triangles used to tessellate a single curved
 * surface (a cylinder, a fillet) into one patch, as long as there's no sharp
 * edge (a real feature line) between them.
 */

class UnionFind {
  private parent: Int32Array;
  private rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra] += 1;
    }
  }
}

export interface TrianglePatchResult {
  /** For each original triangle index, which patch id it belongs to. */
  patchOf: Int32Array;
  /** Triangle indices grouped by patch, in patch order. */
  patches: number[][];
}

function computeTriangleNormal(positions: Float32Array, t: number, out: [number, number, number]): void {
  const base = t * 9;
  const ax = positions[base], ay = positions[base + 1], az = positions[base + 2];
  const bx = positions[base + 3], by = positions[base + 4], bz = positions[base + 5];
  const cx = positions[base + 6], cy = positions[base + 7], cz = positions[base + 8];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / len;
  out[1] = ny / len;
  out[2] = nz / len;
}

/**
 * Groups triangles of a non-indexed position buffer (3 unique vertices per
 * triangle, as produced by three's STLLoader) into surface patches.
 *
 * @param angleThresholdDeg maximum angle between adjacent triangle normals to
 *   still be considered the same surface.
 */
export function groupTrianglesIntoSurfaces(
  positions: Float32Array,
  angleThresholdDeg = 20,
): TrianglePatchResult {
  const triangleCount = positions.length / 9;
  const uf = new UnionFind(triangleCount);

  // Quantize vertex positions to a grid derived from the model's own scale so
  // coincident STL vertices (which are never exactly bit-identical) hash to
  // the same key.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const eps = diagonal * 1e-5;
  const quant = (v: number) => Math.round(v / eps);

  const edgeMap = new Map<string, number[]>();
  const vertexKey = (i: number) => {
    const x = quant(positions[i]);
    const y = quant(positions[i + 1]);
    const z = quant(positions[i + 2]);
    return `${x}_${y}_${z}`;
  };

  for (let t = 0; t < triangleCount; t++) {
    const base = t * 9;
    const k0 = vertexKey(base);
    const k1 = vertexKey(base + 3);
    const k2 = vertexKey(base + 6);
    const edges: [string, string][] = [
      [k0, k1],
      [k1, k2],
      [k2, k0],
    ];
    for (const [a, b] of edges) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      let list = edgeMap.get(key);
      if (!list) {
        list = [];
        edgeMap.set(key, list);
      }
      list.push(t);
    }
  }

  const cosThreshold = Math.cos((angleThresholdDeg * Math.PI) / 180);
  const na: [number, number, number] = [0, 0, 0];
  const nb: [number, number, number] = [0, 0, 0];
  const normalCache = new Map<number, [number, number, number]>();
  const getNormal = (t: number): [number, number, number] => {
    let n = normalCache.get(t);
    if (!n) {
      computeTriangleNormal(positions, t, na);
      n = [na[0], na[1], na[2]];
      normalCache.set(t, n);
    }
    return n;
  };

  for (const list of edgeMap.values()) {
    if (list.length !== 2) continue; // skip non-manifold / boundary edges
    const [t0, t1] = list;
    const n0 = getNormal(t0);
    const n1 = getNormal(t1);
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (dot >= cosThreshold) {
      uf.union(t0, t1);
    }
  }
  void nb;

  const rootToPatchId = new Map<number, number>();
  const patchOf = new Int32Array(triangleCount);
  const patches: number[][] = [];
  for (let t = 0; t < triangleCount; t++) {
    const root = uf.find(t);
    let patchId = rootToPatchId.get(root);
    if (patchId === undefined) {
      patchId = patches.length;
      rootToPatchId.set(root, patchId);
      patches.push([]);
    }
    patchOf[t] = patchId;
    patches[patchId].push(t);
  }

  return { patchOf, patches };
}
