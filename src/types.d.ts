declare module 'occt-import-js' {
  export interface OcctBrepFace {
    first: number;
    last: number;
    color?: [number, number, number];
  }

  export interface OcctMeshAttribute {
    array: number[] | Float32Array;
  }

  export interface OcctResultMesh {
    name: string;
    color?: [number, number, number];
    brep_faces?: OcctBrepFace[];
    attributes: {
      position: OcctMeshAttribute;
      normal?: OcctMeshAttribute;
    };
    index: OcctMeshAttribute;
  }

  export interface OcctReadResult {
    success: boolean;
    meshes: OcctResultMesh[];
  }

  export interface OcctImportJsInstance {
    ReadStepFile(buffer: Uint8Array, params: unknown): OcctReadResult;
    ReadIgesFile(buffer: Uint8Array, params: unknown): OcctReadResult;
  }

  export interface OcctImportJsOptions {
    locateFile?: (path: string, prefix: string) => string;
  }

  export default function occtimportjs(
    options?: OcctImportJsOptions,
  ): Promise<OcctImportJsInstance>;
}
