import * as THREE from 'three';
import './style.css';
import { Viewer, disposeObject3D } from './viewer/Viewer';
import { Sidebar } from './ui/Sidebar';
import { HighlightManager } from './ui/Highlight';
import { loadStepFile } from './loaders/loadStep';
import { loadStlFile } from './loaders/loadStl';
import { exportModelAsGlb } from './export/exportGlb';
import type { SceneDocument, SurfaceInfo } from './model/types';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const viewportWrap = document.getElementById('viewport-wrap') as HTMLElement;
const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
const loadingText = document.getElementById('loading-text') as HTMLElement;
const resetBtn = document.getElementById('reset-colors-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const clearSceneBtn = document.getElementById('clear-scene-btn') as HTMLButtonElement;
const modelInfoEl = document.getElementById('model-info') as HTMLElement;
const surfaceListEl = document.getElementById('surface-list') as HTMLElement;

const viewer = new Viewer(canvas);
const highlight = new HighlightManager();

// The assembled scene: every file the user has added, kept side by side.
let documents: SceneDocument[] = [];
let docCounter = 0;
const meshToPartId = new Map<THREE.Mesh, string>();

const sidebar = new Sidebar(modelInfoEl, surfaceListEl, {
  onSurfaceColorInput: (partId, materialIndex, hex) => {
    const surface = findSurface(partId, materialIndex);
    if (surface) surface.material.color.set(hex);
  },
  onSurfaceClick: (partId, materialIndex) => {
    selectSurface(partId, materialIndex);
  },
  onPartColorAll: (partId, hex) => {
    const part = documents.flatMap((d) => d.parts).find((p) => p.id === partId);
    if (!part) return;
    for (const surface of part.surfaces) {
      surface.material.color.set(hex);
    }
  },
  onRemoveDocument: (docId) => {
    removeDocument(docId);
  },
});

function findSurface(partId: string, materialIndex: number): SurfaceInfo | undefined {
  const part = documents.flatMap((d) => d.parts).find((p) => p.id === partId);
  return part?.surfaces.find((s) => s.materialIndex === materialIndex);
}

function selectSurface(partId: string, materialIndex: number): void {
  const surface = findSurface(partId, materialIndex);
  if (!surface) return;
  sidebar.select(partId, materialIndex);
  highlight.set(surface.material);
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

function updateToolbarState(): void {
  const hasDocs = documents.length > 0;
  resetBtn.disabled = !hasDocs;
  exportBtn.disabled = !hasDocs;
  clearSceneBtn.disabled = !hasDocs;
}

/** Rebuilds the three.js scene and sidebar from the current `documents`
 * list, and reframes the camera around everything that's loaded. */
function rebuildScene(refreshSidebar = true): void {
  layoutDocuments();
  viewer.clearModel();
  meshToPartId.clear();
  for (const doc of documents) {
    viewer.addModel(doc.root);
    for (const part of doc.parts) {
      meshToPartId.set(part.mesh, part.id);
    }
  }
  viewer.frameObject(viewer.modelGroup);
  if (refreshSidebar) sidebar.render(documents);
  updateToolbarState();
}

/** Lines up every loaded file side by side along X, each resting on the
 * ground plane, like parts laid out on a workbench, instead of letting
 * unrelated files overlap at the origin. Recomputed from scratch on every
 * change so removing a file closes the gap it left behind. */
function layoutDocuments(): void {
  let cursorX = 0;
  for (const doc of documents) {
    doc.root.position.set(0, 0, 0);
    doc.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(doc.root);
    if (box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const gap = Math.max(size.length() * 0.2, 1e-6);

    doc.root.position.set(cursorX - box.min.x, -box.min.y, -center.z);
    doc.root.updateMatrixWorld(true);
    cursorX += size.x + gap;
  }
}

function removeDocument(docId: string): void {
  const doc = documents.find((d) => d.docId === docId);
  if (!doc) return;
  documents = documents.filter((d) => d.docId !== docId);
  highlight.clear();
  sidebar.clearSelection();
  disposeObject3D(doc.root);
  rebuildScene();
}

function clearScene(): void {
  documents = [];
  highlight.clear();
  sidebar.clearSelection();
  rebuildScene();
}

async function loadOneFile(file: File): Promise<SceneDocument | null> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!['step', 'stp', 'stl'].includes(ext)) {
    showError(`Unsupported file type ".${ext}". Please choose a .step, .stp, or .stl file.`);
    return null;
  }

  const model = ext === 'stl' ? await loadStlFile(file) : await loadStepFile(file);
  const docId = `doc-${docCounter++}`;
  for (const part of model.parts) {
    part.id = `${docId}::${part.id}`;
  }
  return { ...model, docId };
}

async function handleFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;

  highlight.clear();
  sidebar.clearSelection();

  let loadedAny = false;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setLoading(
      true,
      files.length > 1
        ? `Loading ${i + 1} of ${files.length}: ${file.name}`
        : `Parsing ${file.name.toLowerCase().endsWith('.stl') ? 'STL' : 'STEP'} geometry…`,
    );
    try {
      const doc = await loadOneFile(file);
      if (doc) {
        documents.push(doc);
        loadedAny = true;
      }
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : `Failed to load ${file.name}.`);
    }
  }

  setLoading(false);
  dropzone.classList.remove('drag-active');
  if (loadedAny) rebuildScene();
}

// --- file input / drag & drop -------------------------------------------

fileInput.addEventListener('change', () => {
  const files = fileInput.files ? Array.from(fileInput.files) : [];
  if (files.length) handleFiles(files);
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
  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length) handleFiles(files);
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
  selectSurface(partId, hit.materialIndex);
});

let hoverPending = false;
canvas.addEventListener('pointermove', (e) => {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    if (documents.length === 0) return;
    const hit = viewer.pick(e.clientX, e.clientY);
    canvas.style.cursor = hit ? 'pointer' : '';
  });
});

// --- toolbar actions ------------------------------------------------------

resetBtn.addEventListener('click', () => {
  for (const doc of documents) {
    for (const part of doc.parts) {
      for (const surface of part.surfaces) {
        surface.material.color.copy(surface.originalColor);
        sidebar.setSwatch(part.id, surface.materialIndex, `#${surface.originalColor.getHexString()}`);
      }
    }
  }
});

exportBtn.addEventListener('click', async () => {
  if (documents.length === 0) return;
  exportBtn.disabled = true;
  const prevLabel = exportBtn.textContent;
  exportBtn.textContent = 'Exporting…';
  try {
    const baseName = documents.length === 1 ? documents[0].fileName.replace(/\.[^./]+$/, '') : 'assembly';
    await exportModelAsGlb(viewer.modelGroup, baseName);
  } catch (err) {
    console.error(err);
    showError('Failed to export the model.');
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = prevLabel ?? 'Export GLB';
  }
});

clearSceneBtn.addEventListener('click', () => {
  clearScene();
});

sidebar.showEmpty();
