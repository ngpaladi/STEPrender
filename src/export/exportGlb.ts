import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { saveFile } from './saveFile';

export function exportModelAsGlb(root: THREE.Object3D, baseName: string): Promise<void> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
        saveFile(blob, `${baseName || 'model'}.glb`).then(resolve, reject);
      },
      (error) => reject(error),
      { binary: true },
    );
  });
}
