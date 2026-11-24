// VRM avatar: loads the model, converts keypoint clips into bone rotations, renders a pose.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { Retargeter } from './retarget.js';

export class Avatar {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(1, 3, 3);
    this.scene.add(light);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const half = 0.5; // half height in metres: waist to above the head
    Object.assign(this.camera, { top: half, bottom: -half, left: -half * w / h, right: half * w / h });
    this.camera.position.set(0, 1.2, 4);
    this.camera.lookAt(0, 1.2, 0);
    this.camera.updateProjectionMatrix();
  }

  async load(url, onProgress) {
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url, e => e.total && onProgress?.(e.loaded / e.total));
    this.vrm = gltf.userData.vrm;
    this.scene.add(this.vrm.scene);
    this.vrm.update(0);
    this.scene.updateMatrixWorld(true);
    this.solver = new Retargeter(this.vrm);
    this.solver.reset();
    this.rest = this.solver.driven.map(n => n.quaternion.clone());
  }

  // Keypoint frames -> per-frame rotations of the driven bones.
  convert(clip) {
    const frames = clip.frames.map(f => {
      this.solver.apply(f);
      return { t: f.t, rotations: this.solver.driven.map(n => n.quaternion.clone().normalize()) };
    });
    this.solver.reset();
    return { duration: clip.duration, frames, source: clip.source };
  }

  setPose(rotations) {
    this.vrm.humanoid.autoUpdateHumanBones = false;
    this.solver.driven.forEach((n, i) => n.quaternion.copy(rotations[i]));
  }

  render(dt) {
    if (this.vrm) this.vrm.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
