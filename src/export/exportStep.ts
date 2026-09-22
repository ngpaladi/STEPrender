import * as THREE from 'three';
import type { SceneDocument } from '../model/types';
import { saveFile } from './saveFile';

/**
 * Writes the scene as an AP214 STEP file.
 *
 * What we hold in the browser is tessellated triangles — the loader discards
 * the original B-rep — so every triangle becomes a planar ADVANCED_FACE. The
 * file opens in CAD and carries the per-surface colors and the arrangement,
 * but curved surfaces stay faceted and the file is large. For exact CAD
 * surfaces the original STEP is still the source of truth.
 */

/** Past this the output is big enough to hang the tab while serializing. */
const MAX_TRIANGLES = 300_000;

interface Triangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  materialIndex: number;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0.';
  let text = String(parseFloat(value.toPrecision(12)));
  if (text.includes('e')) {
    text = text.replace('e', 'E');
    if (!text.includes('.')) text = text.replace('E', '.E');
  } else if (!text.includes('.')) {
    text += '.';
  }
  return text;
}

function str(value: string): string {
  // STEP strings are single-quoted with '' as the escape, and the base
  // character set is ASCII.
  return value.replace(/[^\x20-\x7E]/g, '_').replace(/'/g, "''");
}

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, '');
}

/** Walks a mesh's draw groups, yielding world-space triangles tagged with the
 * material (i.e. the surface) they belong to. Indexed and non-indexed
 * geometry both address triangles as start/3 .. (start+count)/3. */
function* worldTriangles(mesh: THREE.Mesh): Generator<Triangle> {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];

  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld;

  const vertexAt = (vertexIndex: number) =>
    new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix);

  for (const group of groups) {
    const firstTriangle = group.start / 3;
    const lastTriangle = (group.start + group.count) / 3;
    for (let t = firstTriangle; t < lastTriangle; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      yield {
        a: vertexAt(i0),
        b: vertexAt(i1),
        c: vertexAt(i2),
        materialIndex: group.materialIndex ?? 0,
      };
    }
  }
}

function materialColorHex(mesh: THREE.Mesh, materialIndex: number): string {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const material = materials[materialIndex] ?? materials[0];
  const color = (material as THREE.MeshStandardMaterial).color;
  return color ? color.getHexString() : 'cccccc';
}

class StepWriter {
  private lines: string[] = [];
  private nextId = 1;

  emit(body: string): number {
    const id = this.nextId++;
    this.lines.push(`#${id}=${body};`);
    return id;
  }

  body(): string {
    return this.lines.join('\n');
  }
}

export function buildStepFile(documents: SceneDocument[], modelName: string): string {
  const totalTriangles = documents.reduce((sum, doc) => sum + doc.triangleCount, 0);
  if (totalTriangles === 0) throw new Error('There is nothing in the scene to export.');
  if (totalTriangles > MAX_TRIANGLES) {
    throw new Error(
      `This scene has ${totalTriangles.toLocaleString()} triangles; STEP export is limited to ` +
        `${MAX_TRIANGLES.toLocaleString()} because every triangle becomes a face. Export GLB instead.`,
    );
  }

  const w = new StepWriter();

  // --- product / context boilerplate -------------------------------------
  const appContext = w.emit(`APPLICATION_CONTEXT('automotive design')`);
  w.emit(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appContext})`,
  );
  const productContext = w.emit(`PRODUCT_CONTEXT('',#${appContext},'mechanical')`);
  const product = w.emit(
    `PRODUCT('${str(modelName)}','${str(modelName)}','',(#${productContext}))`,
  );
  const formation = w.emit(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const definitionContext = w.emit(
    `PRODUCT_DEFINITION_CONTEXT('part definition',#${appContext},'design')`,
  );
  const definition = w.emit(`PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`);

  const lengthUnit = w.emit(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  const angleUnit = w.emit(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const solidAngleUnit = w.emit(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
  const uncertainty = w.emit(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#${lengthUnit},'distance_accuracy_value','')`,
  );
  const context = w.emit(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit})) ` +
      `REPRESENTATION_CONTEXT('','') )`,
  );

  const originPoint = w.emit(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const zDir = w.emit(`DIRECTION('',(0.,0.,1.))`);
  const xDir = w.emit(`DIRECTION('',(1.,0.,0.))`);
  const originPlacement = w.emit(
    `AXIS2_PLACEMENT_3D('',#${originPoint},#${zDir},#${xDir})`,
  );

  // --- geometry -----------------------------------------------------------
  const solidIds: number[] = [];
  /** face id -> color, resolved into styles once every face is written. */
  const faceColors = new Map<number, string>();

  for (const doc of documents) {
    for (const part of doc.parts) {
      const pointIds = new Map<string, number>();
      const vertexIds = new Map<number, number>();
      const edgeIds = new Map<string, number>();
      const faceIds: number[] = [];

      const pointId = (v: THREE.Vector3): number => {
        // Coincident vertices are never bit-identical; snap before hashing so
        // adjacent triangles share points and the shell stays stitched.
        const key = `${v.x.toPrecision(9)},${v.y.toPrecision(9)},${v.z.toPrecision(9)}`;
        let id = pointIds.get(key);
        if (id === undefined) {
          id = w.emit(`CARTESIAN_POINT('',(${num(v.x)},${num(v.y)},${num(v.z)}))`);
          pointIds.set(key, id);
        }
        return id;
      };

      const vertexId = (point: number): number => {
        let id = vertexIds.get(point);
        if (id === undefined) {
          id = w.emit(`VERTEX_POINT('',#${point})`);
          vertexIds.set(point, id);
        }
        return id;
      };

      /** Returns the shared edge plus whether this triangle runs along it.
       * The LINE has to actually run between the two vertices — a placeholder
       * direction parses fine but leaves the face untessellatable. */
      const edgeFor = (
        startPoint: number,
        endPoint: number,
        startVec: THREE.Vector3,
        endVec: THREE.Vector3,
      ): { edge: number; sameSense: boolean } => {
        const forward = startPoint < endPoint;
        const key = forward ? `${startPoint}_${endPoint}` : `${endPoint}_${startPoint}`;
        let edge = edgeIds.get(key);
        if (edge === undefined) {
          const from = forward ? startPoint : endPoint;
          const to = forward ? endPoint : startPoint;
          const fromVec = forward ? startVec : endVec;
          const toVec = forward ? endVec : startVec;

          const along = new THREE.Vector3().subVectors(toVec, fromVec);
          const length = along.length() || 1;
          along.divideScalar(length);

          const direction = w.emit(
            `DIRECTION('',(${num(along.x)},${num(along.y)},${num(along.z)}))`,
          );
          const vector = w.emit(`VECTOR('',#${direction},${num(length)})`);
          const line = w.emit(`LINE('',#${from},#${vector})`);
          edge = w.emit(
            `EDGE_CURVE('',#${vertexId(from)},#${vertexId(to)},#${line},.T.)`,
          );
          edgeIds.set(key, edge);
        }
        return { edge, sameSense: forward };
      };

      for (const tri of worldTriangles(part.mesh)) {
        const pa = pointId(tri.a);
        const pb = pointId(tri.b);
        const pc = pointId(tri.c);
        // A degenerate triangle collapses to fewer than three distinct points
        // and cannot form a loop.
        if (pa === pb || pb === pc || pa === pc) continue;

        const e1 = edgeFor(pa, pb, tri.a, tri.b);
        const e2 = edgeFor(pb, pc, tri.b, tri.c);
        const e3 = edgeFor(pc, pa, tri.c, tri.a);
        const o1 = w.emit(`ORIENTED_EDGE('',*,*,#${e1.edge},${e1.sameSense ? '.T.' : '.F.'})`);
        const o2 = w.emit(`ORIENTED_EDGE('',*,*,#${e2.edge},${e2.sameSense ? '.T.' : '.F.'})`);
        const o3 = w.emit(`ORIENTED_EDGE('',*,*,#${e3.edge},${e3.sameSense ? '.T.' : '.F.'})`);
        const loop = w.emit(`EDGE_LOOP('',(#${o1},#${o2},#${o3}))`);
        const bound = w.emit(`FACE_OUTER_BOUND('',#${loop},.T.)`);

        const normal = new THREE.Vector3()
          .subVectors(tri.b, tri.a)
          .cross(new THREE.Vector3().subVectors(tri.c, tri.a));
        if (normal.lengthSq() === 0) continue;
        normal.normalize();
        // Any direction perpendicular to the normal works as the plane's
        // reference axis; pick the more stable of two candidates.
        const reference = new THREE.Vector3(1, 0, 0);
        if (Math.abs(normal.dot(reference)) > 0.9) reference.set(0, 1, 0);
        reference.cross(normal).normalize();

        const normalDir = w.emit(
          `DIRECTION('',(${num(normal.x)},${num(normal.y)},${num(normal.z)}))`,
        );
        const refDir = w.emit(
          `DIRECTION('',(${num(reference.x)},${num(reference.y)},${num(reference.z)}))`,
        );
        const placement = w.emit(`AXIS2_PLACEMENT_3D('',#${pa},#${normalDir},#${refDir})`);
        const plane = w.emit(`PLANE('',#${placement})`);
        const face = w.emit(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`);

        faceIds.push(face);
        faceColors.set(face, materialColorHex(part.mesh, tri.materialIndex));
      }

      if (faceIds.length === 0) continue;
      const shell = w.emit(`CLOSED_SHELL('',(${faceIds.map((id) => `#${id}`).join(',')}))`);
      solidIds.push(w.emit(`MANIFOLD_SOLID_BREP('${str(part.name)}',#${shell})`));
    }
  }

  if (solidIds.length === 0) throw new Error('There is nothing in the scene to export.');

  const shapeRep = w.emit(
    `ADVANCED_BREP_SHAPE_REPRESENTATION('${str(modelName)}',` +
      `(#${originPlacement},${solidIds.map((id) => `#${id}`).join(',')}),#${context})`,
  );
  const definitionShape = w.emit(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
  w.emit(`SHAPE_DEFINITION_REPRESENTATION(#${definitionShape},#${shapeRep})`);

  // --- colors -------------------------------------------------------------
  // One style chain per distinct color, one styled item per face pointing at it.
  const styleForColor = new Map<string, number>();
  const styledItems: number[] = [];

  for (const [face, hex] of faceColors) {
    let style = styleForColor.get(hex);
    if (style === undefined) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const colour = w.emit(`COLOUR_RGB('',${num(r)},${num(g)},${num(b)})`);
      const fillColour = w.emit(`FILL_AREA_STYLE_COLOUR('',#${colour})`);
      const fillStyle = w.emit(`FILL_AREA_STYLE('',(#${fillColour}))`);
      const fillArea = w.emit(`SURFACE_STYLE_FILL_AREA(#${fillStyle})`);
      const sideStyle = w.emit(`SURFACE_SIDE_STYLE('',(#${fillArea}))`);
      const usage = w.emit(`SURFACE_STYLE_USAGE(.BOTH.,#${sideStyle})`);
      style = w.emit(`PRESENTATION_STYLE_ASSIGNMENT((#${usage}))`);
      styleForColor.set(hex, style);
    }
    styledItems.push(w.emit(`STYLED_ITEM('color',(#${style}),#${face})`));
  }

  if (styledItems.length > 0) {
    w.emit(
      `MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',` +
        `(${styledItems.map((id) => `#${id}`).join(',')}),#${context})`,
    );
  }

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('faceted model with colors'),'2;1');`,
    `FILE_NAME('${str(modelName)}','${timestamp()}',('STEP/STL Viewer'),(''),` +
      `'STEP/STL Viewer','STEP/STL Viewer','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 4 }'));`,
    'ENDSEC;',
    'DATA;',
  ].join('\n');

  return `${header}\n${w.body()}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

export function exportSceneAsStep(documents: SceneDocument[], baseName: string): Promise<void> {
  const text = buildStepFile(documents, baseName || 'model');
  const blob = new Blob([text], { type: 'application/step' });
  return saveFile(blob, `${baseName || 'model'}.step`);
}
