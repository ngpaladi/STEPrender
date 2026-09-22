import * as THREE from 'three';
import type { PartInfo, SceneDocument } from '../model/types';

export type SurfaceKey = string; // `${partId}:${materialIndex}`

export function surfaceKey(partId: string, materialIndex: number): SurfaceKey {
  return `${partId}:${materialIndex}`;
}

export interface SidebarCallbacks {
  onSurfaceColorInput: (partId: string, materialIndex: number, hex: string) => void;
  onSurfaceClick: (partId: string, materialIndex: number) => void;
  onPartColorAll: (partId: string, hex: string) => void;
  onRemoveDocument: (docId: string) => void;
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

  render(documents: SceneDocument[]): void {
    this.swatchInputs.clear();
    this.rowEls.clear();
    this.selectedKey = null;

    this.infoEl.innerHTML = '';
    if (documents.length === 0) {
      this.showEmpty();
      return;
    }

    const title = document.createElement('h3');
    title.textContent = 'Scene';
    this.infoEl.appendChild(title);

    const totalParts = documents.reduce((n, d) => n + d.parts.length, 0);
    const totalSurfaces = documents.reduce((n, d) => n + d.parts.reduce((m, p) => m + p.surfaces.length, 0), 0);
    const totalTriangles = documents.reduce((n, d) => n + d.triangleCount, 0);

    const rows: [string, string][] = [
      ['Files', String(documents.length)],
      ['Parts', String(totalParts)],
      ['Surfaces', String(totalSurfaces)],
      ['Triangles', totalTriangles.toLocaleString()],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'info-row';
      row.innerHTML = `<span>${label}</span><span>${value}</span>`;
      this.infoEl.appendChild(row);
    }

    this.listEl.innerHTML = '';
    for (const doc of documents) {
      this.listEl.appendChild(this.buildDocGroup(doc));
    }
  }

  private buildDocGroup(doc: SceneDocument): HTMLElement {
    const group = document.createElement('div');
    group.className = 'doc-group';

    const header = document.createElement('div');
    header.className = 'doc-header';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '▾';
    header.appendChild(chevron);

    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = doc.fileName;
    header.appendChild(name);

    const badge = document.createElement('span');
    badge.className = 'doc-badge';
    badge.textContent = doc.kind.toUpperCase();
    header.appendChild(badge);

    const partGroups: HTMLElement[] = [];
    const collapseAllBtn = document.createElement('button');
    collapseAllBtn.className = 'doc-collapse-all';
    // A single part collapses from its own title row, so this only earns its
    // place on an assembly.
    collapseAllBtn.hidden = doc.parts.length < 2;
    const syncCollapseAll = () => {
      const allCollapsed = partGroups.every((el) => el.classList.contains('collapsed'));
      collapseAllBtn.textContent = allCollapsed ? '⊞' : '⊟';
      collapseAllBtn.title = allCollapsed
        ? 'Expand all parts in this file'
        : 'Collapse all parts in this file';
    };
    collapseAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const anyExpanded = partGroups.some((el) => !el.classList.contains('collapsed'));
      for (const el of partGroups) el.classList.toggle('collapsed', anyExpanded);
      syncCollapseAll();
    });
    header.appendChild(collapseAllBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'doc-remove';
    removeBtn.title = 'Remove this file from the scene';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onRemoveDocument(doc.docId);
    });
    header.appendChild(removeBtn);

    header.addEventListener('click', () => {
      group.classList.toggle('collapsed');
    });
    group.appendChild(header);

    const partsWrap = document.createElement('div');
    partsWrap.className = 'doc-parts';
    for (const part of doc.parts) {
      const partGroup = this.buildPartGroup(part);
      partGroups.push(partGroup);
      partsWrap.appendChild(partGroup);
    }
    // Collapsing parts one by one can leave the button's label stale; this
    // fires after the part title's own handler has run.
    partsWrap.addEventListener('click', () => syncCollapseAll());
    group.appendChild(partsWrap);

    syncCollapseAll();
    return group;
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
