import type { SurfaceInfo } from '../model/types';

export interface TextureDialogDeps {
  /** The surface the panel acts on, or null when nothing is selected. */
  getSelected: () => { surface: SurfaceInfo; label: string } | null;
  applyImage: (surface: SurfaceInfo, file: File) => Promise<void>;
  updateTransform: (surface: SurfaceInfo) => void;
  removeTexture: (surface: SurfaceInfo) => void;
  onError: (message: string) => void;
}

export class TextureDialog {
  private panel = document.getElementById('texture-panel') as HTMLElement;
  private openBtn = document.getElementById('texture-btn') as HTMLButtonElement;
  private target = document.getElementById('texture-target') as HTMLElement;
  private input = document.getElementById('texture-input') as HTMLInputElement;
  private current = document.getElementById('texture-current') as HTMLElement;
  private thumb = document.getElementById('texture-thumb') as HTMLImageElement;
  private modeSelect = document.getElementById('texture-mode') as HTMLSelectElement;
  private scaleField = document.getElementById('texture-scale-field') as HTMLElement;
  private scaleInput = document.getElementById('texture-scale') as HTMLInputElement;
  private rotationInput = document.getElementById('texture-rotation') as HTMLInputElement;
  private removeBtn = document.getElementById('texture-remove') as HTMLButtonElement;

  private thumbUrl: string | null = null;
  private deps: TextureDialogDeps;

  constructor(deps: TextureDialogDeps) {
    this.deps = deps;

    this.openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.panel.hidden) {
        this.refresh();
        this.panel.hidden = false;
      } else {
        this.close();
      }
    });
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    // Deliberately not closed by an outside click: the panel acts on whatever
    // surface is selected, and picking the next surface is an outside click.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });

    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0];
      this.input.value = '';
      if (file) this.applyImage(file);
    });

    this.modeSelect.addEventListener('change', () => this.commitSettings());
    this.scaleInput.addEventListener('input', () => this.commitSettings());
    this.rotationInput.addEventListener('input', () => this.commitSettings());
    this.removeBtn.addEventListener('click', () => {
      const selected = this.deps.getSelected();
      if (!selected) return;
      this.deps.removeTexture(selected.surface);
      this.setThumb(null);
      this.refresh();
    });
  }

  setEnabled(enabled: boolean): void {
    this.openBtn.disabled = !enabled;
    if (!enabled) this.close();
  }

  close(): void {
    this.panel.hidden = true;
  }

  /** Re-reads the selected surface; call whenever selection changes. */
  refresh(): void {
    const selected = this.deps.getSelected();
    if (!selected) {
      this.target.textContent = 'Select a surface first';
      this.current.hidden = true;
      return;
    }

    this.target.textContent = selected.label;
    const texture = selected.surface.texture;
    this.current.hidden = !texture;
    if (!texture) return;

    this.modeSelect.value = texture.mode;
    this.scaleField.hidden = texture.mode !== 'tile';
    this.scaleInput.value = String(roundForDisplay(texture.scale));
    this.rotationInput.value = String(texture.rotation);
  }

  private async applyImage(file: File): Promise<void> {
    const selected = this.deps.getSelected();
    if (!selected) return;
    try {
      await this.deps.applyImage(selected.surface, file);
      this.setThumb(file);
      this.refresh();
    } catch (err) {
      console.error(err);
      this.deps.onError(err instanceof Error ? err.message : 'Could not load that image.');
    }
  }

  private commitSettings(): void {
    const selected = this.deps.getSelected();
    const texture = selected?.surface.texture;
    if (!selected || !texture) return;

    texture.mode = this.modeSelect.value === 'fit' ? 'fit' : 'tile';
    this.scaleField.hidden = texture.mode !== 'tile';
    const scale = parseFloat(this.scaleInput.value);
    if (Number.isFinite(scale) && scale > 0) texture.scale = scale;
    const rotation = parseFloat(this.rotationInput.value);
    texture.rotation = Number.isFinite(rotation) ? rotation : 0;

    this.deps.updateTransform(selected.surface);
  }

  private setThumb(file: File | null): void {
    if (this.thumbUrl) URL.revokeObjectURL(this.thumbUrl);
    this.thumbUrl = file ? URL.createObjectURL(file) : null;
    this.thumb.src = this.thumbUrl ?? '';
  }
}

function roundForDisplay(value: number): number {
  if (value >= 100) return Math.round(value);
  if (value >= 1) return Math.round(value * 100) / 100;
  return Math.round(value * 10000) / 10000;
}
