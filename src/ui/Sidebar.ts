import * as THREE from 'three';
import type { LoadedModel, PartInfo } from '../model/types';

export type SurfaceKey = string; // `${partId}:${materialIndex}`

export function surfaceKey(partId: string, materialIndex: number): SurfaceKey {
  return `${partId}:${materialIndex}`;
}

export interface SidebarCallbacks {
  onSurfaceColorInput: (partId: string, materialIndex: number, hex: string) => void;
  onSurfaceClick: (partId: string, materialIndex: number) => void;
  onPartColorAll: (partId: string, hex: string) => void;
}

export class Sidebar {
  private infoEl: HTMLElement;
  private listEl: HTMLElement;
  private callbacks: SidebarCallbacks;

  private swatchInputs = new Map<SurfaceKey, HTMLInputElement>();
  private rowEls = new Map<SurfaceKey, HTMLElement>();
  private selectedKey: SurfaceKey | null = null;

  constructor(infoEl: HTMLElement, listEl: HTMLElement, callbacks: SidebarCallbacks) {
    this.infoEl = infoEl;
    this.listEl = listEl;
    this.callbacks = callbacks;
  }

  showEmpty(): void {
    this.infoEl.innerHTML = '<p class="empty-msg">No model loaded yet.</p>';
    this.listEl.innerHTML = '';
    this.swatchInputs.clear();
    this.rowEls.clear();
    this.selectedKey = null;
  }

  render(model: LoadedModel): void {
    this.swatchInputs.clear();
    this.rowEls.clear();
    this.selectedKey = null;

    this.infoEl.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Model';
    this.infoEl.appendChild(title);

    const rows: [string, string][] = [
      ['File', model.fileName],
      ['Format', model.kind.toUpperCase()],
      ['Parts', String(model.parts.length)],
      ['Surfaces', String(model.parts.reduce((n, p) => n + p.surfaces.length, 0))],
      ['Triangles', model.triangleCount.toLocaleString()],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'info-row';
      row.innerHTML = `<span>${label}</span><span>${value}</span>`;
      this.infoEl.appendChild(row);
    }

    this.listEl.innerHTML = '';
    for (const part of model.parts) {
      this.listEl.appendChild(this.buildPartGroup(part));
    }
  }

  private buildPartGroup(part: PartInfo): HTMLElement {
    const group = document.createElement('div');
    group.className = 'part-group';

    const titleRow = document.createElement('div');
    titleRow.className = 'part-title';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '▾';
    titleRow.appendChild(chevron);

    const name = document.createElement('span');
    name.textContent = part.name;
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    titleRow.appendChild(name);

    const colorAll = document.createElement('input');
    colorAll.type = 'color';
    colorAll.className = 'part-color-all swatch';
    colorAll.title = 'Set color for every surface in this part';
    colorAll.value = rgbToHex(part.surfaces[0]?.material.color ?? new THREE.Color(0xffffff));
    colorAll.addEventListener('click', (e) => e.stopPropagation());
    colorAll.addEventListener('input', () => {
      this.callbacks.onPartColorAll(part.id, colorAll.value);
      for (const surface of part.surfaces) {
        const input = this.swatchInputs.get(surfaceKey(part.id, surface.materialIndex));
        if (input) input.value = colorAll.value;
      }
    });
    titleRow.appendChild(colorAll);

    titleRow.addEventListener('click', () => {
      group.classList.toggle('collapsed');
    });
    group.appendChild(titleRow);

    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'surface-rows';

    for (const surface of part.surfaces) {
      const key = surfaceKey(part.id, surface.materialIndex);
      const row = document.createElement('div');
      row.className = 'surface-row';

      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.className = 'swatch';
      swatch.value = rgbToHex(surface.material.color);
      swatch.addEventListener('click', (e) => e.stopPropagation());
      swatch.addEventListener('input', () => {
        this.callbacks.onSurfaceColorInput(part.id, surface.materialIndex, swatch.value);
      });
      row.appendChild(swatch);

      const label = document.createElement('span');
      label.className = 'surface-name';
      label.textContent = surface.name;
      row.appendChild(label);

      const count = document.createElement('span');
      count.className = 'tri-count';
      count.textContent = `${surface.triangleCount}`;
      row.appendChild(count);

      row.addEventListener('click', () => {
        this.callbacks.onSurfaceClick(part.id, surface.materialIndex);
      });

      this.swatchInputs.set(key, swatch);
      this.rowEls.set(key, row);
      rowsWrap.appendChild(row);
    }

    group.appendChild(rowsWrap);
    return group;
  }

  setSwatch(partId: string, materialIndex: number, hex: string): void {
    const input = this.swatchInputs.get(surfaceKey(partId, materialIndex));
    if (input) input.value = hex;
  }

  select(partId: string, materialIndex: number): void {
    if (this.selectedKey) {
      this.rowEls.get(this.selectedKey)?.classList.remove('selected');
    }
    const key = surfaceKey(partId, materialIndex);
    this.selectedKey = key;
    const row = this.rowEls.get(key);
    row?.classList.add('selected');
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  clearSelection(): void {
    if (this.selectedKey) {
      this.rowEls.get(this.selectedKey)?.classList.remove('selected');
    }
    this.selectedKey = null;
  }
}

export function rgbToHex(color: THREE.Color): string {
  return `#${color.getHexString()}`;
}
