import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';

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
  readonly transformControls: TransformControls;
  /** The gizmo's drawable half; kept out of exported images. */
  readonly transformHelper: THREE.Object3D;
  readonly modelGroup: THREE.Group;
  /** Ground grid, hidden for clean product renders. */
  readonly grid: THREE.GridHelper;
  /** Invisible plane that catches the key light's shadow. */
  readonly shadowGround: THREE.Mesh;

  /** Corner axis widget; click an axis to swing the camera to that view. */
  readonly viewHelper: ViewHelper;

  private raycaster = new THREE.Raycaster();
  private canvas: HTMLCanvasElement;
  private keyLight: THREE.DirectionalLight;
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1d22);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    this.camera.position.set(5, 4, 7);

    // preserveDrawingBuffer keeps the frame readable for image export; alpha
    // lets renders be saved with a transparent background.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral: rolls off highlights without shifting hues, so a
    // surface still reads as the color the user picked.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // Snapping stays off (translationSnap/rotationSnap default to null) so
    // parts move freely.
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      // Orbiting while dragging the gizmo would fight the drag.
      this.controls.enabled = !(event as unknown as { value: boolean }).value;
    });
    this.transformHelper = this.transformControls.getHelper();
    this.transformHelper.visible = false;
    this.scene.add(this.transformHelper);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();

    const ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(ambient);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
    this.keyLight.position.set(5, 8, 6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-6, -3, -4);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(20, 20, 0x3a3d46, 0x2a2c33);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

    this.shadowGround = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.42 }),
    );
    this.shadowGround.rotation.x = -Math.PI / 2;
    this.shadowGround.receiveShadow = true;
    this.scene.add(this.shadowGround);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    // Sharing the reference keeps the widget orbiting whatever the controls
    // are currently centred on.
    this.viewHelper.center = this.controls.target;

    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();

    this.startLoop();
  }

  startLoop(): void {
    this.renderer.setAnimationLoop(() => {
      const delta = this.clock.getDelta();
      if (this.viewHelper.animating) this.viewHelper.update(delta);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      // Drawn as an overlay after the scene, and only from this loop — so it
      // never lands in an exported image.
      this.renderer.autoClear = false;
      this.viewHelper.render(this.renderer);
      this.renderer.autoClear = true;
    });
  }

  /** Returns true when the click was consumed by the axis widget. */
  handleViewHelperClick(event: PointerEvent): boolean {
    return this.viewHelper.handleClick(event);
  }

  /** Swaps left-drag between orbiting and panning, for pointers that have no
   * comfortable right-drag or two-finger pan (an iPad trackpad, say). */
  setPanMode(enabled: boolean): void {
    this.controls.mouseButtons.LEFT = enabled ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = enabled ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  }

  frameAll(): void {
    this.frameObject(this.modelGroup);
  }

  stopLoop(): void {
    this.renderer.setAnimationLoop(null);
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
    root.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
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

    this.fitLighting(box, center, radius);
  }

  /** Directional-light shadows need a shadow camera sized to the model, and
   * models here range from millimetre parts to metre-scale assemblies, so both
   * the light rig and the shadow catcher are re-fitted whenever the scene
   * changes. */
  private fitLighting(box: THREE.Box3, center: THREE.Vector3, radius: number): void {
    const keyDir = new THREE.Vector3(0.55, 1, 0.42).normalize();
    this.keyLight.position.copy(center).addScaledVector(keyDir, radius * 4);
    this.keyLight.target.position.copy(center);
    this.keyLight.target.updateMatrixWorld();

    const shadowCam = this.keyLight.shadow.camera;
    const extent = radius * 1.15;
    shadowCam.left = -extent;
    shadowCam.right = extent;
    shadowCam.top = extent;
    shadowCam.bottom = -extent;
    shadowCam.near = radius * 0.5;
    shadowCam.far = radius * 8;
    shadowCam.updateProjectionMatrix();
    this.keyLight.shadow.normalBias = radius * 0.01;

    this.shadowGround.position.set(center.x, box.min.y, center.z);
    this.shadowGround.scale.setScalar(Math.max(radius * 8, 1e-6));
  }

  attachGizmo(object: THREE.Object3D, mode: 'translate' | 'rotate'): void {
    this.transformControls.setMode(mode);
    // Rotation snaps to 45° steps (so 90° and 180° land exactly); position
    // stays free. The snap applies to the angle turned during a drag, and
    // files start unrotated, so orientations stay on clean multiples.
    this.transformControls.translationSnap = null;
    this.transformControls.rotationSnap = mode === 'rotate' ? Math.PI / 4 : null;
    this.transformControls.attach(object);
    this.transformHelper.visible = true;
  }

  detachGizmo(): void {
    this.transformControls.detach();
    this.transformHelper.visible = false;
  }

  get gizmoTarget(): THREE.Object3D | undefined {
    return this.transformControls.object;
  }

  get isGizmoDragging(): boolean {
    return this.transformControls.dragging;
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
        // Disposing a material does not release the textures it references.
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    }
  });
}
