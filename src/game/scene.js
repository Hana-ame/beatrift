import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GAME } from '../constants.js';

const SWORD_PIVOT = new THREE.Vector3(0, 0.5, 1.4);
const SWORD_LEN = 5.6;
const SWORD_OFFSET = 0.7;
const TRAIL_LEN = 16;
const NOTE_SPAWN_Y = GAME.NOTE_SPAWN_Y;
const NOTE_PLANE_Y = GAME.NOTE_PLANE_Y;

export function createGameScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080814);
  scene.fog = new THREE.Fog(0x080814, 42, 130);
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

  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(3, 6, 4);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x4de3ff, 0.45);
  rim.position.set(-4, -10, 3);
  scene.add(rim);

  addStars(scene);
  const stage = createStage(scene);
  const noteScreen = createNoteScreen(scene);

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
    stage,
    notePool,
    noteScreen,
    getSword() {
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(sword.group.quaternion);
      const tip = SWORD_PIVOT.clone().addScaledVector(dir, SWORD_LEN);
      return { pivot: SWORD_PIVOT, dir, tip };
    },
    setFeverVisual(active) {
      const bladeHex = active ? 0xffd166 : 0x4de3ff;
      const glowHex = active ? 0xff2d78 : 0x9ff6ff;
      sword.blade.material.color.setHex(bladeHex);
      sword.glow.material.color.setHex(glowHex);
      sword.tipLight.color.setHex(bladeHex);
      trail.line.material.color.setHex(active ? 0xffd166 : 0x7df0ff);
      stage.judgmentBorder.material.color.setHex(active ? 0xffd166 : 0x4de3ff);
    },
    resize: onResize,
    dispose() {
      window.removeEventListener('resize', onResize);
      debugControls.dispose();
      renderer.dispose();
    },
  };
}

function addStars(scene) {
  const geo = new THREE.BufferGeometry();
  const n = 450;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 120;
    arr[i * 3 + 1] = -5 - Math.random() * 85;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 50 + 15;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x8899ff, size: 0.09, transparent: true, opacity: 0.72,
  })));
}

// 霓虹音轨隧道 + 判定平面框 + 剑尖在判定平面上的实时准星
function createStage(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const minX = -2.9, maxX = 2.9;
  const minZ = 0.15, maxZ = 3.15;
  const centerZ = (minZ + maxZ) / 2;

  // 4 条纵深导轨 (从远处出生平面延伸到判定平面)
  const railPts = [
    new THREE.Vector3(minX, NOTE_SPAWN_Y, minZ), new THREE.Vector3(minX, NOTE_PLANE_Y, minZ),
    new THREE.Vector3(maxX, NOTE_SPAWN_Y, minZ), new THREE.Vector3(maxX, NOTE_PLANE_Y, minZ),
    new THREE.Vector3(minX, NOTE_SPAWN_Y, maxZ), new THREE.Vector3(minX, NOTE_PLANE_Y, maxZ),
    new THREE.Vector3(maxX, NOTE_SPAWN_Y, maxZ), new THREE.Vector3(maxX, NOTE_PLANE_Y, maxZ),
    new THREE.Vector3(-1.0, NOTE_SPAWN_Y, minZ), new THREE.Vector3(-1.0, NOTE_PLANE_Y, minZ),
    new THREE.Vector3(1.0, NOTE_SPAWN_Y, minZ), new THREE.Vector3(1.0, NOTE_PLANE_Y, minZ),
  ];
  const railGeo = new THREE.BufferGeometry().setFromPoints(railPts);
  const rails = new THREE.LineSegments(
    railGeo,
    new THREE.LineBasicMaterial({ color: 0x2b3d66, transparent: true, opacity: 0.55 }),
  );
  group.add(rails);

  // 深度刻度门框 (帮助玩家直观判断音符飞来的距离感)
  const depthGates = [];
  for (const y of [-12, -22, -32, -44, -56]) {
    const gateGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(minX, y, minZ),
      new THREE.Vector3(maxX, y, minZ),
      new THREE.Vector3(maxX, y, maxZ),
      new THREE.Vector3(minX, y, maxZ),
    ]);
    const gate = new THREE.LineLoop(
      gateGeo,
      new THREE.LineBasicMaterial({ color: 0x354d80, transparent: true, opacity: 0.28 }),
    );
    group.add(gate);
    depthGates.push(gate);
  }

  // 判定平面霓虹边框 (y = NOTE_PLANE_Y = -4.4)
  const borderGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(minX, NOTE_PLANE_Y, minZ),
    new THREE.Vector3(maxX, NOTE_PLANE_Y, minZ),
    new THREE.Vector3(maxX, NOTE_PLANE_Y, maxZ),
    new THREE.Vector3(minX, NOTE_PLANE_Y, maxZ),
  ]);
  const judgmentBorder = new THREE.LineLoop(
    borderGeo,
    new THREE.LineBasicMaterial({
      color: 0x4de3ff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(judgmentBorder);

  // 判定平面四角高亮括号
  const cornerPts = [];
  const cw = 0.65, ch = 0.55;
  const corners = [
    [minX, minZ, 1, 1],
    [maxX, minZ, -1, 1],
    [maxX, maxZ, -1, -1],
    [minX, maxZ, 1, -1],
  ];
  for (const [cx, cz, sx, sz] of corners) {
    cornerPts.push(
      new THREE.Vector3(cx, NOTE_PLANE_Y, cz),
      new THREE.Vector3(cx + sx * cw, NOTE_PLANE_Y, cz),
      new THREE.Vector3(cx, NOTE_PLANE_Y, cz),
      new THREE.Vector3(cx, NOTE_PLANE_Y, cz + sz * ch),
    );
  }
  const cornerLines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(cornerPts),
    new THREE.LineBasicMaterial({
      color: 0xff2d78,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(cornerLines);

  // 剑尖在判定平面上的实时投射准星 (让玩家一眼看清当前光剑指向平面何处)
  const reticle = new THREE.Group();
  reticle.position.set(0, NOTE_PLANE_Y, centerZ);
  const rRing = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.31, 28),
    new THREE.MeshBasicMaterial({
      color: 0x4de3ff,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  rRing.rotation.x = Math.PI / 2;
  reticle.add(rRing);
  const rDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  rDot.rotation.x = Math.PI / 2;
  reticle.add(rDot);
  reticle.visible = false;
  group.add(reticle);

  return {
    group,
    judgmentBorder,
    cornerLines,
    depthGates,
    reticle,
    rRing,
    pulseBeat(phase) {
      const k = Math.max(0, 1 - phase * 2.5);
      judgmentBorder.material.opacity = 0.48 + k * 0.42;
      cornerLines.material.opacity = 0.65 + k * 0.35;
    },
    updateReticle(pivot, dir, visible) {
      if (!visible || dir.y >= -0.04) {
        reticle.visible = false;
        return;
      }
      const t = (NOTE_PLANE_Y - pivot.y) / dir.y;
      if (t <= 0 || t > 18) {
        reticle.visible = false;
        return;
      }
      reticle.visible = true;
      const rx = THREE.MathUtils.clamp(pivot.x + dir.x * t, -4.2, 4.2);
      const rz = THREE.MathUtils.clamp(pivot.z + dir.z * t, -0.6, 4.2);
      reticle.position.set(rx, NOTE_PLANE_Y, rz);
    },
  };
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
  g.font = 'bold 88px "PingFang SC","Microsoft YaHei",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('此面向敌 · 剑尖对准此处', cv.width / 2, cv.height / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 4.1),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    }),
  );
  // 居中放置在视野正前方 (z = 1.65 与判定区中心齐平，y = -24 避开远雾遮挡)
  mesh.position.set(0, -24, 1.65);
  mesh.quaternion
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function createSword() {
  const group = new THREE.Group();
  group.position.copy(SWORD_PIVOT);

  // 枢轴球头
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0x8899bb, roughness: 0.45, metalness: 0.7 }),
  );
  group.add(knob);

  // 连接枢轴球头与剑格的完整剑柄（修复原版 knob 与 handle 悬空脱节的显示 bug）
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.105, SWORD_OFFSET, 14),
    new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.55, metalness: 0.75 }),
  );
  handle.position.y = SWORD_OFFSET / 2;
  group.add(handle);

  // 剑格发光护手环
  const guard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.14, 0.09, 16),
    new THREE.MeshStandardMaterial({
      color: 0x4de3ff,
      emissive: 0x4de3ff,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.8,
    }),
  );
  guard.position.y = SWORD_OFFSET;
  group.add(guard);

  const body = new THREE.Group();
  body.position.y = SWORD_OFFSET;
  group.add(body);

  const bladeLen = SWORD_LEN - SWORD_OFFSET;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, bladeLen, 0.09),
    new THREE.MeshBasicMaterial({
      color: 0x4de3ff,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  blade.position.y = bladeLen / 2;
  body.add(blade);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, bladeLen),
    new THREE.MeshBasicMaterial({
      color: 0x9ff6ff,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glow.position.y = bladeLen / 2;
  body.add(glow);

  // 修复原版 tipLight 位置多偏移了 SWORD_OFFSET 的 bug
  const tipLight = new THREE.PointLight(0x4de3ff, 1.2, 6.5);
  tipLight.position.y = bladeLen;
  body.add(tipLight);

  group.visible = false;
  return { group, blade, glow, guard, tipLight };
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
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  line.frustumCulled = false;
  return { line, pts: [] };
}

function createNotePool(scene) {
  const octGeo = new THREE.OctahedronGeometry(0.95, 0);
  const icoGeo = new THREE.IcosahedronGeometry(0.92, 0);
  const ringGeo = new THREE.RingGeometry(1.02, 1.14, 24);
  const free = [];
  const active = [];

  function spawn(pos, color, type = 'normal') {
    let mesh = free.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(
        octGeo,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          roughness: 0.28,
          metalness: 0.25,
          transparent: true,
          opacity: 1,
        }),
      );
      mesh.frustumCulled = false;

      // 缩圈时机环 (Approach Ring): 随音符靠近判定平面从 2.2x 缩至 1.0x
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      mesh.add(ring);

      // 炸弹/黄金音符附加外框
      const wire = new THREE.Mesh(
        icoGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          wireframe: true,
          transparent: true,
          opacity: 0.45,
        }),
      );
      wire.visible = false;
      mesh.add(wire);

      mesh.userData = { ring, wire };
    }

    const { ring, wire } = mesh.userData;
    mesh.geometry = type === 'bomb' ? icoGeo : octGeo;

    const finalColor =
      type === 'bomb' ? 0xff2244 :
      type === 'gold' ? 0xffd166 :
      type === 'chain' ? 0x3ddc84 :
      color;

    mesh.material.color.setHex(finalColor);
    mesh.material.emissive.setHex(finalColor);
    mesh.material.emissiveIntensity = type === 'gold' ? 1.25 : type === 'bomb' ? 1.1 : 0.9;
    mesh.material.opacity = 1;

    if (type === 'chain') {
      mesh.scale.set(0.95, 1.3, 0.65);
    } else if (type === 'bomb') {
      mesh.scale.set(1.15, 1.15, 1.15);
    } else if (type === 'gold') {
      mesh.scale.set(1.48, 1.95, 0.92);
    } else {
      mesh.scale.set(1.35, 1.85, 0.8);
    }

    if (ring) {
      ring.visible = type !== 'bomb';
      ring.material.color.setHex(type === 'gold' ? 0xffd166 : finalColor);
      ring.scale.set(2.0, 2.0, 1);
    }
    if (wire) {
      wire.visible = type === 'bomb' || type === 'gold';
      wire.material.color.setHex(type === 'bomb' ? 0xff0033 : 0xffffff);
      wire.scale.setScalar(type === 'bomb' ? 1.28 : 1.18);
    }

    mesh.position.copy(pos);
    scene.add(mesh);
    active.push(mesh);
    return mesh;
  }

  function release(mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    const i = active.indexOf(mesh);
    if (i >= 0) active.splice(i, 1);
    free.push(mesh);
  }

  return { spawn, release, active };
}

export { SWORD_PIVOT, SWORD_LEN, TRAIL_LEN };
