import * as THREE from 'three';
import type { Viewer } from '../viewer/Viewer';

export type BackgroundStyle = 'studio-light' | 'studio-dark' | 'transparent' | 'viewport';

export interface RenderOptions {
  width: number;
  height: number;
  background: BackgroundStyle;
  showGrid: boolean;
  showShadow: boolean;
}

export interface RenderResult {
  blob: Blob;
  width: number;
  height: number;
}

const GRADIENTS: Record<'studio-light' | 'studio-dark', [string, string]> = {
  'studio-light': ['#ffffff', '#d3d7de'],
  'studio-dark': ['#31343c', '#0e0f12'],
};

function makeGradientTexture(style: 'studio-light' | 'studio-dark'): THREE.CanvasTexture {
  const [top, bottom] = GRADIENTS[style];
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the rendered image.'));
    }, 'image/png');
  });
}

/** Largest drawing buffer we'll ask for, on top of the driver's own texture
 * size limit — a 40MP render already needs ~160MB of RGBA pixels. */
const MAX_PIXELS = 40_000_000;

export function clampRenderSize(
  viewer: Viewer,
  width: number,
  height: number,
): { width: number; height: number } {
  const maxDimension = viewer.renderer.capabilities.maxTextureSize;
  let scale = Math.min(1, maxDimension / width, maxDimension / height);
  const pixels = width * scale * height * scale;
  if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * Renders the current camera view at an arbitrary resolution and returns it as
 * a PNG. The viewport canvas is reused at a larger drawing-buffer size rather
 * than rendering through an offscreen target, so what's exported matches the
 * on-screen frame exactly (same materials, tone mapping and shadows).
 */
export async function renderProductImage(
  viewer: Viewer,
  options: RenderOptions,
): Promise<RenderResult> {
  const { renderer, scene, camera } = viewer;
  const { width, height } = clampRenderSize(viewer, options.width, options.height);

  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevPixelRatio = renderer.getPixelRatio();
  const prevAspect = camera.aspect;
  const prevBackground = scene.background;
  const prevClearAlpha = renderer.getClearAlpha();
  const prevGridVisible = viewer.grid.visible;
  const prevShadowVisible = viewer.shadowGround.visible;

  let gradientTexture: THREE.CanvasTexture | null = null;

  // The render loop must not draw between the render and the pixel read, or
  // damped camera motion would land a different frame in the file.
  viewer.stopLoop();

  try {
    viewer.grid.visible = options.showGrid;
    viewer.shadowGround.visible = options.showShadow;

    if (options.background === 'transparent') {
      scene.background = null;
      renderer.setClearAlpha(0);
    } else if (options.background !== 'viewport') {
      gradientTexture = makeGradientTexture(options.background);
      scene.background = gradientTexture;
    }

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    const blob = await canvasToBlob(renderer.domElement);
    return { blob, width, height };
  } finally {
    gradientTexture?.dispose();
    scene.background = prevBackground;
    renderer.setClearAlpha(prevClearAlpha);
    viewer.grid.visible = prevGridVisible;
    viewer.shadowGround.visible = prevShadowVisible;
    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    viewer.startLoop();
  }
}
