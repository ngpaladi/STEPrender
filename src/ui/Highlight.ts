import * as THREE from 'three';

const HIGHLIGHT_EMISSIVE = 0x5b3f00;

/** Tracks which single material is currently "selected" and gives it an
 * emissive glow, restoring the previous emissive color when deselected or
 * when selection moves elsewhere. */
export class HighlightManager {
  private current: THREE.MeshStandardMaterial | null = null;
  private previousEmissive = 0x000000;
  private suspended = false;

  set(material: THREE.MeshStandardMaterial): void {
    if (this.current === material && !this.suspended) return;
    this.clear();
    this.previousEmissive = material.emissive.getHex();
    material.emissive.setHex(HIGHLIGHT_EMISSIVE);
    this.current = material;
    this.suspended = false;
  }

  clear(): void {
    if (this.current) {
      this.current.emissive.setHex(this.previousEmissive);
      this.current = null;
    }
    this.suspended = false;
  }

  /** Drops the glow without forgetting the selection, so an exported image
   * doesn't show the highlight. */
  suspend(): void {
    if (!this.current || this.suspended) return;
    this.current.emissive.setHex(this.previousEmissive);
    this.suspended = true;
  }

  restore(): void {
    if (!this.current || !this.suspended) return;
    this.current.emissive.setHex(HIGHLIGHT_EMISSIVE);
    this.suspended = false;
  }
}
