import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PickResult {
  object: THREE.Mesh;
  materialIndex: number;
  point: THREE.Vector3;
}

export class Viewer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly modelGroup: THREE.Group;

  private raycaster = new THREE.Raycaster();
  private canvas: HTMLCanvasElement;
  private grid: THREE.GridHelper;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1d22);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    this.camera.position.set(5, 4, 7);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(5, 8, 6);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-6, -3, -4);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(20, 20, 0x3a3d46, 0x2a2c33);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();

    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  handleResize(): void {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  clearModel(): void {
    for (const child of [...this.modelGroup.children]) {
      this.modelGroup.remove(child);
      disposeObject3D(child);
    }
  }

  addModel(root: THREE.Object3D): void {
    this.modelGroup.add(root);
  }

  frameObject(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.001);

    const fitDist = radius / Math.sin((Math.PI * this.camera.fov) / 360);
    const direction = new THREE.Vector3(1, 0.8, 1).normalize();

    this.camera.near = Math.max(radius / 100, 0.001);
    this.camera.far = Math.max(radius * 100, 1000);
    this.camera.updateProjectionMatrix();

    this.camera.position.copy(center).addScaledVector(direction, fitDist * 1.4);
    this.camera.lookAt(center);

    this.controls.target.copy(center);
    this.controls.update();

    this.grid.scale.setScalar(Math.max(radius / 10, 0.01) * 2);
    this.grid.position.y = box.min.y;
  }

  /** Raycast from a pointer event (client coords) against the model group. */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.modelGroup, true);
    for (const hit of hits) {
      if (hit.object instanceof THREE.Mesh && hit.face) {
        const materialIndex = hit.face.materialIndex ?? 0;
        return { object: hit.object, materialIndex, point: hit.point };
      }
    }
    return null;
  }
}

export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        mat.dispose();
      }
    }
  });
}
