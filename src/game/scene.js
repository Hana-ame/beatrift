import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SWORD_PIVOT = new THREE.Vector3(0, 0.5, 1.4);
const SWORD_LEN = 5.6;
const SWORD_OFFSET = 0.7;
const TRAIL_LEN = 14;
const NOTE_SPAWN_Y = -56;

export function createGameScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a16);
  scene.fog = new THREE.Fog(0x0a0a16, 45, 140);
  scene.up.set(0, 0, 1);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.up.set(0, 0, 1);
  camera.position.set(0, 0.85, 2.0);
  camera.lookAt(0, -3.6, 1.6);

  const debugCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  debugCamera.up.set(0, 0, 1);
  const debugControls = new OrbitControls(debugCamera, renderer.domElement);
  debugControls.target.set(0, -0.5, 1.4);
  debugCamera.position.set(9, 4, 7);
  debugControls.enabled = false;
  debugControls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 6, 4);
  scene.add(key);

  addStars(scene);
  createNoteScreen(scene);

  const sword = createSword();
  scene.add(sword.group);

  const trail = createTrail();
  scene.add(trail.line);

  const notePool = createNotePool(scene);

  window.addEventListener('resize', onResize);
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    debugCamera.aspect = window.innerWidth / window.innerHeight;
    debugCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  return {
    scene,
    camera,
    renderer,
    debugCamera,
    debugControls,
    sword,
    trail,
    notePool,
    getSword() {
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(sword.group.quaternion);
      const tip = SWORD_PIVOT.clone().addScaledVector(dir, SWORD_LEN);
      return { pivot: SWORD_PIVOT, dir, tip };
    },
    resize: onResize,
    dispose() {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}

function addStars(scene) {
  const geo = new THREE.BufferGeometry();
  const n = 400;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 120;
    arr[i * 3 + 1] = -5 - Math.random() * 80;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 50 + 15;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x8899ff, size: 0.08, transparent: true, opacity: 0.7,
  })));
}

function createNoteScreen(scene) {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 384;
  const g = cv.getContext('2d');
  g.fillStyle = '#0b0b1a';
  g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#4de3ff';
  g.lineWidth = 10;
  g.strokeRect(16, 16, cv.width - 32, cv.height - 32);
  g.fillStyle = '#9ff6ff';
  g.font = 'bold 96px "PingFang SC","Microsoft YaHei",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('此面向敌', cv.width / 2, cv.height / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 5.2),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.set(0, NOTE_SPAWN_Y, 0);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function createSword() {
  const group = new THREE.Group();
  group.position.copy(SWORD_PIVOT);

  // 旋转轴(枢轴)放在光剑之外: 剑身整体偏移枢轴 SWORD_OFFSET, 枢轴处只有握持圆钮,
  // 于是绕枢轴摆动时剑尖扫过的弧更大, 命中更跟手。
  const body = new THREE.Group();
  body.position.y = SWORD_OFFSET;
  group.add(body);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x8899bb, roughness: 0.5, metalness: 0.6 }),
  );
  group.add(knob);

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.11, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.7, metalness: 0.6 }),
  );
  handle.position.y = -0.1;
  body.add(handle);

  const bladeLen = SWORD_LEN - SWORD_OFFSET;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, bladeLen, 0.09),
    new THREE.MeshBasicMaterial({
      color: 0x4de3ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  blade.position.y = bladeLen / 2;
  body.add(blade);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, bladeLen),
    new THREE.MeshBasicMaterial({
      color: 0x9ff6ff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glow.position.y = bladeLen / 2;
  body.add(glow);

  const tipLight = new THREE.PointLight(0x4de3ff, 1.2, 6);
  tipLight.position.y = SWORD_LEN;
  body.add(tipLight);

  group.visible = false;
  return { group, blade, tipLight };
}

function createTrail() {
  const positions = new Float32Array(TRAIL_LEN * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({
      color: 0x7df0ff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  line.frustumCulled = false;
  return { line, pts: [] };
}

function createNotePool(scene) {
  const geo = new THREE.OctahedronGeometry(0.95, 0);
  const free = [];
  const active = [];

  function spawn(pos, color) {
    let mesh = free.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          roughness: 0.3,
          metalness: 0.2,
          transparent: true,
          opacity: 1,
        }),
      );
      mesh.scale.set(1.35, 1.85, 0.8);
      mesh.frustumCulled = false;
    } else {
      mesh.material.color.set(color);
      mesh.material.emissive.set(color);
      mesh.material.opacity = 1;
    }
    mesh.position.copy(pos);
    scene.add(mesh);
    active.push(mesh);
    return mesh;
  }

  function release(mesh) {
    scene.remove(mesh);
    const i = active.indexOf(mesh);
    if (i >= 0) active.splice(i, 1);
    free.push(mesh);
  }

  return { spawn, release, active };
}

export { SWORD_PIVOT, SWORD_LEN, TRAIL_LEN };
