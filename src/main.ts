import * as THREE from 'three';
import './style.css';
import { Viewer } from './viewer/Viewer';
import { Sidebar } from './ui/Sidebar';
import { HighlightManager } from './ui/Highlight';
import { loadStepFile } from './loaders/loadStep';
import { loadStlFile } from './loaders/loadStl';
import { exportModelAsGlb } from './export/exportGlb';
import type { LoadedModel, SurfaceInfo } from './model/types';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const viewportWrap = document.getElementById('viewport-wrap') as HTMLElement;
const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
const loadingText = document.getElementById('loading-text') as HTMLElement;
const resetBtn = document.getElementById('reset-colors-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const modelInfoEl = document.getElementById('model-info') as HTMLElement;
const surfaceListEl = document.getElementById('surface-list') as HTMLElement;

const viewer = new Viewer(canvas);
const highlight = new HighlightManager();

let currentModel: LoadedModel | null = null;
const meshToPartId = new Map<THREE.Mesh, string>();

const sidebar = new Sidebar(modelInfoEl, surfaceListEl, {
  onSurfaceColorInput: (partId, materialIndex, hex) => {
    const surface = findSurface(partId, materialIndex);
    if (surface) surface.material.color.set(hex);
  },
  onSurfaceClick: (partId, materialIndex) => {
    selectSurface(partId, materialIndex, false);
  },
  onPartColorAll: (partId, hex) => {
    if (!currentModel) return;
    const part = currentModel.parts.find((p) => p.id === partId);
    if (!part) return;
    for (const surface of part.surfaces) {
      surface.material.color.set(hex);
    }
  },
});

function findSurface(partId: string, materialIndex: number): SurfaceInfo | undefined {
  const part = currentModel?.parts.find((p) => p.id === partId);
  return part?.surfaces.find((s) => s.materialIndex === materialIndex);
}

function selectSurface(partId: string, materialIndex: number, fromViewport: boolean): void {
  const surface = findSurface(partId, materialIndex);
  if (!surface) return;
  sidebar.select(partId, materialIndex);
  highlight.set(surface.material);
  if (!fromViewport) {
    // no camera movement needed; selection from the list is just a focus aid
  }
}

function showError(message: string): void {
  let banner = document.getElementById('error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-banner';
    viewportWrap.appendChild(banner);
  }
  banner.textContent = message;
  banner.style.display = 'block';
  window.clearTimeout((banner as any)._hideTimer);
  (banner as any)._hideTimer = window.setTimeout(() => {
    if (banner) banner.style.display = 'none';
  }, 6000);
}

function setLoading(isLoading: boolean, text = 'Loading…'): void {
  loadingText.textContent = text;
  loadingOverlay.classList.toggle('hidden', !isLoading);
}

async function handleFile(file: File): Promise<void> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!['step', 'stp', 'stl'].includes(ext)) {
    showError(`Unsupported file type ".${ext}". Please choose a .step, .stp, or .stl file.`);
    return;
  }

  setLoading(true, ext === 'stl' ? 'Parsing STL…' : 'Parsing STEP geometry…');
  highlight.clear();
  sidebar.clearSelection();

  try {
    const model = ext === 'stl' ? await loadStlFile(file) : await loadStepFile(file);

    meshToPartId.clear();
    for (const part of model.parts) {
      meshToPartId.set(part.mesh, part.id);
    }

    currentModel = model;
    viewer.setModel(model.root);
    sidebar.render(model);
    resetBtn.disabled = false;
    exportBtn.disabled = false;
    dropzone.classList.remove('drag-active');
  } catch (err) {
    console.error(err);
    showError(err instanceof Error ? err.message : 'Failed to load the file.');
  } finally {
    setLoading(false);
  }
}

// --- file input / drag & drop -------------------------------------------

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

let dragDepth = 0;
for (const evt of ['dragenter', 'dragover']) {
  viewportWrap.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === 'dragenter') dragDepth++;
    dropzone.classList.add('drag-active');
  });
}
viewportWrap.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove('drag-active');
});
viewportWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('drag-active');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// --- click-to-select a surface in the viewport ---------------------------

let pointerDownPos: { x: number; y: number } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('pointerup', (e) => {
  if (!pointerDownPos) return;
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  pointerDownPos = null;
  if (Math.hypot(dx, dy) > 5) return; // was a drag/orbit, not a click

  const hit = viewer.pick(e.clientX, e.clientY);
  if (!hit) return;
  const partId = meshToPartId.get(hit.object);
  if (!partId) return;
  selectSurface(partId, hit.materialIndex, true);
});

let hoverPending = false;
canvas.addEventListener('pointermove', (e) => {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    if (!currentModel) return;
    const hit = viewer.pick(e.clientX, e.clientY);
    canvas.style.cursor = hit ? 'pointer' : '';
  });
});

// --- toolbar actions ------------------------------------------------------

resetBtn.addEventListener('click', () => {
  if (!currentModel) return;
  for (const part of currentModel.parts) {
    for (const surface of part.surfaces) {
      surface.material.color.copy(surface.originalColor);
      sidebar.setSwatch(part.id, surface.materialIndex, `#${surface.originalColor.getHexString()}`);
    }
  }
});

exportBtn.addEventListener('click', async () => {
  if (!currentModel) return;
  exportBtn.disabled = true;
  const prevLabel = exportBtn.textContent;
  exportBtn.textContent = 'Exporting…';
  try {
    const baseName = currentModel.fileName.replace(/\.[^./]+$/, '');
    await exportModelAsGlb(currentModel.root, baseName);
  } catch (err) {
    console.error(err);
    showError('Failed to export the model.');
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = prevLabel ?? 'Export GLB';
  }
});

sidebar.showEmpty();
