import { saveFile } from '../export/saveFile';
import type { BackgroundStyle, RenderOptions, RenderResult } from '../render/renderImage';

export interface RenderDialogDeps {
  /** Viewport drawing-buffer size, used by the "Viewport ×N" presets. */
  getViewportSize: () => { width: number; height: number };
  /** Applies the driver/memory clamp so the panel shows the size actually used. */
  clampSize: (width: number, height: number) => { width: number; height: number };
  /** Base filename for the download, without extension. */
  getBaseName: () => string;
  render: (options: RenderOptions) => Promise<RenderResult>;
  onError: (message: string) => void;
}

export class RenderDialog {
  private panel = document.getElementById('render-panel') as HTMLElement;
  private openBtn = document.getElementById('render-btn') as HTMLButtonElement;
  private goBtn = document.getElementById('render-go') as HTMLButtonElement;
  private cancelBtn = document.getElementById('render-cancel') as HTMLButtonElement;
  private resSelect = document.getElementById('render-res') as HTMLSelectElement;
  private bgSelect = document.getElementById('render-bg') as HTMLSelectElement;
  private shadowCheck = document.getElementById('render-shadow') as HTMLInputElement;
  private gridCheck = document.getElementById('render-grid') as HTMLInputElement;
  private sizeNote = document.getElementById('render-size-note') as HTMLElement;

  private resultModal = document.getElementById('render-result') as HTMLElement;
  private resultImage = document.getElementById('render-image') as HTMLImageElement;
  private resultMeta = document.getElementById('render-meta') as HTMLElement;
  private downloadBtn = document.getElementById('render-download') as HTMLButtonElement;
  private closeBtn = document.getElementById('render-close') as HTMLButtonElement;

  private objectUrl: string | null = null;
  private lastResult: { blob: Blob; fileName: string } | null = null;
  private deps: RenderDialogDeps;

  constructor(deps: RenderDialogDeps) {
    this.deps = deps;

    this.openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.cancelBtn.addEventListener('click', () => this.close());
    this.goBtn.addEventListener('click', () => this.run());
    this.resSelect.addEventListener('change', () => this.updateSizeNote());
    this.panel.addEventListener('click', (e) => e.stopPropagation());

    this.closeBtn.addEventListener('click', () => this.closeResult());
    this.downloadBtn.addEventListener('click', () => this.download());
    this.resultModal.addEventListener('click', (e) => {
      if (e.target === this.resultModal) this.closeResult();
    });

    document.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this.resultModal.hidden) this.closeResult();
      else this.close();
    });
  }

  setEnabled(enabled: boolean): void {
    this.openBtn.disabled = !enabled;
    if (!enabled) this.close();
  }

  private toggle(): void {
    if (this.panel.hidden) {
      this.updateSizeNote();
      this.panel.hidden = false;
    } else {
      this.close();
    }
  }

  private close(): void {
    this.panel.hidden = true;
  }

  private resolveSize(): { width: number; height: number } {
    const value = this.resSelect.value;
    if (value.startsWith('viewport:')) {
      const multiplier = Number(value.split(':')[1]);
      const { width, height } = this.deps.getViewportSize();
      return { width: Math.round(width * multiplier), height: Math.round(height * multiplier) };
    }
    const [, w, h] = value.split(':');
    return { width: Number(w), height: Number(h) };
  }

  private updateSizeNote(): void {
    const requested = this.resolveSize();
    const actual = this.deps.clampSize(requested.width, requested.height);
    const clamped = actual.width !== requested.width || actual.height !== requested.height;
    this.sizeNote.textContent = clamped
      ? `${actual.width} × ${actual.height} px (reduced to fit this device's limits)`
      : `${actual.width} × ${actual.height} px`;
  }

  private currentOptions(): RenderOptions {
    const { width, height } = this.resolveSize();
    return {
      width,
      height,
      background: this.bgSelect.value as BackgroundStyle,
      showGrid: this.gridCheck.checked,
      showShadow: this.shadowCheck.checked,
    };
  }

  private async run(): Promise<void> {
    this.goBtn.disabled = true;
    this.goBtn.textContent = 'Rendering…';
    try {
      const result = await this.deps.render(this.currentOptions());
      this.close();
      this.showResult(result);
    } catch (err) {
      console.error(err);
      this.deps.onError(err instanceof Error ? err.message : 'Rendering failed.');
    } finally {
      this.goBtn.disabled = false;
      this.goBtn.textContent = 'Render';
    }
  }

  private showResult(result: RenderResult): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(result.blob);

    const fileName = `${this.deps.getBaseName()}-render.png`;
    this.lastResult = { blob: result.blob, fileName };
    this.resultImage.src = this.objectUrl;
    this.resultMeta.textContent = `${result.width} × ${result.height} px · ${formatBytes(result.blob.size)}`;
    this.resultModal.hidden = false;
  }

  private async download(): Promise<void> {
    if (!this.lastResult) return;
    this.downloadBtn.disabled = true;
    try {
      await saveFile(this.lastResult.blob, this.lastResult.fileName);
    } catch (err) {
      console.error(err);
      this.deps.onError(err instanceof Error ? err.message : 'Could not save the image.');
    } finally {
      this.downloadBtn.disabled = false;
    }
  }

  private closeResult(): void {
    this.resultModal.hidden = true;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
