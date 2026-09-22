import * as THREE from 'three';

const HIGHLIGHT_EMISSIVE = 0x5b3f00;

/** Tracks which single material is currently "selected" and gives it an
 * emissive glow, restoring the previous emissive color when deselected or
 * when selection moves elsewhere. */
export class HighlightManager {
  private current: THREE.MeshStandardMaterial | null = null;
  private previousEmissive = 0x000000;

  set(material: THREE.MeshStandardMaterial): void {
    if (this.current === material) return;
    this.clear();
    this.previousEmissive = material.emissive.getHex();
    material.emissive.setHex(HIGHLIGHT_EMISSIVE);
    this.current = material;
  }

  clear(): void {
    if (this.current) {
      this.current.emissive.setHex(this.previousEmissive);
      this.current = null;
    }
  }
}
