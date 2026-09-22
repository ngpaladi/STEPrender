import * as THREE from 'three';
import './style.css';
import { Viewer, disposeObject3D } from './viewer/Viewer';
import { Sidebar } from './ui/Sidebar';
import { HighlightManager } from './ui/Highlight';
import { loadStepFile } from './loaders/loadStep';
import { loadStlFile } from './loaders/loadStl';
import { loadGlbFile } from './loaders/loadGlb';
import { exportModelAsGlb } from './export/exportGlb';
import { exportSceneAsStep } from './export/exportStep';
import { RenderDialog } from './ui/RenderDialog';
import { clampRenderSize, renderProductImage } from './render/renderImage';
import { recenterDocumentOnItself } from './model/recenter';
import type { LoadedModel, SceneDocument, SurfaceInfo } from './model/types';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const viewportWrap = document.getElementById('viewport-wrap') as HTMLElement;
const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
const loadingText = document.getElementById('loading-text') as HTMLElement;
const resetBtn = document.getElementById('reset-colors-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const exportStepBtn = document.getElementById('export-step-btn') as HTMLButtonElement;
const clearSceneBtn = document.getElementById('clear-scene-btn') as HTMLButtonElement;
const panBtn = document.getElementById('pan-btn') as HTMLButtonElement;
const fitBtn = document.getElementById('fit-btn') as HTMLButtonElement;
const moveBtn = document.getElementById('move-btn') as HTMLButtonElement;
const rotateBtn = document.getElementById('rotate-btn') as HTMLButtonElement;
const hintEl = document.getElementById('hint') as HTMLElement;
const modelInfoEl = document.getElementById('model-info') as HTMLElement;
const surfaceListEl = document.getElementById('surface-list') as HTMLElement;

const viewer = new Viewer(canvas);
const highlight = new HighlightManager();

// The assembled scene: every file the user has added, kept side by side.
let documents: SceneDocument[] = [];
let docCounter = 0;
const meshToPartId = new Map<THREE.Mesh, string>();

type TransformMode = 'none' | 'translate' | 'rotate';
let transformMode: TransformMode = 'none';
/** Files the user has moved by hand; auto-layout leaves these where they are. */
const userPlacedDocs = new Set<string>();

const DEFAULT_HINT = hintEl.textContent ?? '';

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

function sceneBaseName(): string {
  if (documents.length === 0) return 'model';
  if (documents.length === 1) return documents[0].fileName.replace(/\.[^./]+$/, '');
  return 'assembly';
}

const renderDialog = new RenderDialog({
  getViewportSize: () => {
    const size = viewer.renderer.getSize(new THREE.Vector2());
    return { width: size.x, height: size.y };
  },
  clampSize: (width, height) => clampRenderSize(viewer, width, height),
  getBaseName: sceneBaseName,
  render: async (options) => {
    // The selection glow is a UI affordance, not part of the product shot.
    highlight.suspend();
    try {
      return await renderProductImage(viewer, options);
    } finally {
      highlight.restore();
    }
  },
  onError: (message) => showError(message),
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
  attachGizmoForPart(partId);
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
  exportStepBtn.disabled = !hasDocs;
  clearSceneBtn.disabled = !hasDocs;
  fitBtn.disabled = !hasDocs;
  moveBtn.disabled = !hasDocs;
  rotateBtn.disabled = !hasDocs;
  renderDialog.setEnabled(hasDocs);
  if (!hasDocs) setTransformMode('none');
}

function setTransformMode(mode: TransformMode): void {
  transformMode = mode;
  moveBtn.classList.toggle('active', mode === 'translate');
  rotateBtn.classList.toggle('active', mode === 'rotate');

  if (mode === 'none') {
    viewer.detachGizmo();
    hintEl.textContent = DEFAULT_HINT;
    return;
  }

  hintEl.textContent =
    mode === 'translate'
      ? 'Click a file, then drag an arrow to move all of it · Esc to finish'
      : 'Click a file, then drag a ring to rotate in 45° steps · Esc to finish';

  // Keep working on whatever is already selected rather than making the user
  // re-pick it when switching between move and rotate.
  const target = viewer.gizmoTarget;
  if (target) viewer.attachGizmo(target, mode);
}

/** The gizmo moves a whole file, so a click anywhere on it grabs its root. */
function attachGizmoForPart(partId: string): void {
  if (transformMode === 'none') return;
  const doc = documents.find((d) => d.parts.some((p) => p.id === partId));
  if (doc) viewer.attachGizmo(doc.root, transformMode);
}

/** Rebuilds the three.js scene and sidebar from the current `documents`
 * list, and reframes the camera around everything that's loaded. */
function rebuildScene(refreshSidebar = true): void {
  layoutDocuments();
  viewer.detachGizmo();
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
    if (userPlacedDocs.has(doc.docId)) {
      // Hand-placed: leave it exactly where it was put, but still reserve the
      // space it occupies so auto-placed files don't land on top of it.
      doc.root.updateMatrixWorld(true);
      const placedBox = new THREE.Box3().setFromObject(doc.root);
      if (!placedBox.isEmpty()) {
        const placedSize = placedBox.getSize(new THREE.Vector3());
        cursorX = Math.max(cursorX, placedBox.max.x + Math.max(placedSize.length() * 0.2, 1e-6));
      }
      continue;
    }

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
  userPlacedDocs.delete(docId);
  highlight.clear();
  sidebar.clearSelection();
  disposeObject3D(doc.root);
  rebuildScene();
}

function clearScene(): void {
  documents = [];
  userPlacedDocs.clear();
  highlight.clear();
  sidebar.clearSelection();
  rebuildScene();
}

const LOADERS: Record<string, (file: File) => Promise<LoadedModel>> = {
  step: loadStepFile,
  stp: loadStepFile,
  stl: loadStlFile,
  glb: loadGlbFile,
};

async function loadOneFile(file: File): Promise<SceneDocument | null> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const load = LOADERS[ext];
  if (!load) {
    showError(`Unsupported file type ".${ext}". Please choose a .step, .stp, .stl, or .glb file.`);
    return null;
  }

  const model = await load(file);
  const docId = `doc-${docCounter++}`;
  for (const part of model.parts) {
    part.id = `${docId}::${part.id}`;
  }
  recenterDocumentOnItself(model.root);
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
        : `Parsing ${file.name}…`,
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
  if (viewer.isGizmoDragging) {
    pointerDownPos = null;
    return;
  }
  // The axis widget owns its corner of the canvas.
  if (viewer.handleViewHelperClick(e)) {
    pointerDownPos = null;
    return;
  }
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

exportStepBtn.addEventListener('click', async () => {
  if (documents.length === 0) return;
  exportStepBtn.disabled = true;
  const prevLabel = exportStepBtn.textContent;
  exportStepBtn.textContent = 'Writing…';
  try {
    await exportSceneAsStep(documents, sceneBaseName());
  } catch (err) {
    console.error(err);
    showError(err instanceof Error ? err.message : 'Failed to write the STEP file.');
  } finally {
    exportStepBtn.disabled = false;
    exportStepBtn.textContent = prevLabel ?? 'Export STEP';
  }
});

clearSceneBtn.addEventListener('click', () => {
  clearScene();
});

let panning = false;
panBtn.addEventListener('click', () => {
  panning = !panning;
  panBtn.classList.toggle('active', panning);
  viewer.setPanMode(panning);
});

fitBtn.addEventListener('click', () => {
  viewer.frameAll();
});

moveBtn.addEventListener('click', () => {
  setTransformMode(transformMode === 'translate' ? 'none' : 'translate');
});

rotateBtn.addEventListener('click', () => {
  setTransformMode(transformMode === 'rotate' ? 'none' : 'rotate');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && transformMode !== 'none') setTransformMode('none');
});

// A file that's been placed by hand stays put, so the next file added to the
// scene doesn't re-flow it back into the row.
viewer.transformControls.addEventListener('objectChange', () => {
  const target = viewer.gizmoTarget;
  if (!target) return;
  const doc = documents.find((d) => d.root === target);
  if (doc) userPlacedDocs.add(doc.docId);
});

sidebar.showEmpty();
