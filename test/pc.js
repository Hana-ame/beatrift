// PC 端: 主机, 接收手机原始传感器, 姿态解算(系统解/Mahony/纯陀螺/仅重力), 3D 长方体 + 曲线
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $, showScreen, navigate } from '../src/ui/screens.js';
import { genRoomCode } from '../src/constants.js';
import { P, createHost, renderQr, pcAnnounce, discoveryReady, discoveryClose } from './net.js';
import {
  DEG, wrapDeg, quatFromDeviceEuler, quatFromAccel, eulerFromQuat, Mahony, GyroIntegrator,
} from './attitude.js';

const GRAVITY = 9.8;
const CHART_SECONDS = 10;

function adaptiveGains(accel) {
  const mag = Math.hypot(accel.x, accel.y, accel.z);
  const still = mag > GRAVITY * 0.92 && mag < GRAVITY * 1.08;
  return still ? { kp: 0.8, ki: 0.2 } : { kp: 0.15, ki: 0.0 };
}

const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '--' : `${v.toFixed(d)}°`);
const fmtQ = (q) => (q ? `${q.w.toFixed(3)} ${q.x.toFixed(3)} ${q.y.toFixed(3)} ${q.z.toFixed(3)}` : '--');

export function initPc() {
  const els = {
    status: $('#pc-status'),
    code: $('#pc-roomcode'),
    qr: $('#pc-qr'),
    device: $('#pc-device'),
    ping: $('#pc-ping'),
    hz: $('#pc-hz'),
    frames: $('#pc-frames'),
    newcode: $('#pc-newcode'),
    reset: $('#pc-reset'),
    fusionNote: $('#pc-fusion-note'),
    yawflip: $('#pc-yawflip'),
    oa: $('#s-oa'), ob: $('#s-ob'), og: $('#s-og'), oabs: $('#s-oabs'),
    ax: $('#s-ax'), ay: $('#s-ay'), az: $('#s-az'), amag: $('#s-amag'),
    lx: $('#s-lx'), ly: $('#s-ly'), lz: $('#s-lz'), lmag: $('#s-lmag'),
    gx: $('#s-gx'), gy: $('#s-gy'), gz: $('#s-gz'), gmag: $('#s-gmag'),
    iv: $('#s-iv'), so: $('#s-so'), t: $('#s-t'), seq: $('#s-seq'),
    chart: $('#pc-chart'),
    chartTabs: [...document.querySelectorAll('.chart-tabs button')],
    srcRadios: [...document.querySelectorAll('input[name="src"]')],
  };

  let roomCode = genRoomCode();
  let host = null;
  let stopAnnounce = null;
  let connected = false;
  let frames = 0;
  let lastQ = null;
  let lastAig = { x: 0, y: 0, z: 9.8 };
  let lastAlpha = 0;
  let lastO = null;
  let recvWindow = [];

  // ---- 解算选项 ----
  let yawFlip = false;    // 反转偏航方向 (个别设备 alpha 方向与 W3C 相反)
  const useAlpha = (a) => (yawFlip ? wrapDeg(-a) : a);

  // ---- 解算状态 ----
  const mah = new Mahony({ kp: 0.5, ki: 0.05 });
  const gyroInt = new GyroIntegrator();
  let inited = false;
  let lastRecv = 0;
  let gainsNow = { kp: 0.8, ki: 0.2 };

  function reinit() {
    if (!lastQ) return;
    mah.setOrientation(lastQ);
    gyroInt.setOrientation(lastQ);
    inited = true;
    chart.clear();
  }

  function onSensor(snap) {
    frames++;
    const now = performance.now();
    recvWindow.push(now);
    while (recvWindow.length && now - recvWindow[0] > 1000) recvWindow.shift();

    const o = snap.o;
    const aig = snap.aig;
    const gyr = snap.gyr;
    if (o) {
      els.oa.textContent = fmt(o.a);
      els.ob.textContent = fmt(o.b);
      els.og.textContent = fmt(o.g);
      els.oabs.textContent = o.abs ? '绝对' : '相对';
    }
    if (aig) {
      lastAig = aig;
      const m = Math.hypot(aig.x, aig.y, aig.z);
      els.ax.textContent = aig.x.toFixed(2);
      els.ay.textContent = aig.y.toFixed(2);
      els.az.textContent = aig.z.toFixed(2);
      els.amag.textContent = m.toFixed(2);
    }
    if (o) { lastO = o; lastAlpha = useAlpha(o.a) ?? lastAlpha; }
    if (snap.al) {
      const m = Math.hypot(snap.al.x, snap.al.y, snap.al.z);
      els.lx.textContent = snap.al.x.toFixed(2);
      els.ly.textContent = snap.al.y.toFixed(2);
      els.lz.textContent = snap.al.z.toFixed(2);
      els.lmag.textContent = m.toFixed(2);
    }
    if (gyr) {
      const m = Math.hypot(gyr.x, gyr.y, gyr.z);
      els.gx.textContent = gyr.x.toFixed(1);
      els.gy.textContent = gyr.y.toFixed(1);
      els.gz.textContent = gyr.z.toFixed(1);
      els.gmag.textContent = m.toFixed(1);
    }
    if (snap.iv) els.iv.textContent = `${snap.iv} ms`;
    if (snap.so != null) els.so.textContent = `${snap.so}°`;
    if (snap.ts) els.t.textContent = snap.ts;
    if (snap.seq) els.seq.textContent = snap.seq;

    if (!o || !aig || !gyr) return;
    if (o.a == null || o.b == null || o.g == null) return;

    const dt = Math.max(0.001, Math.min(0.1, (now - lastRecv) / 1000));
    lastRecv = now;

    // ---- 四路姿态解算 ----
    const alpha = useAlpha(o.a);
    lastQ = quatFromDeviceEuler(alpha, o.b, o.g);
    if (!inited) {
      mah.setOrientation(lastQ);
      gyroInt.setOrientation(lastQ);
      inited = true;
    }

    const gyrRad = { x: gyr.x * DEG, y: gyr.y * DEG, z: gyr.z * DEG };
    gainsNow = adaptiveGains(aig);
    mah.kp = gainsNow.kp;
    mah.ki = gainsNow.ki;
    mah.update(dt, gyrRad, aig);
    gyroInt.update(dt, gyrRad);

    const sols = {
      device: { q: lastQ },
      fuse: { q: mah.q },
      gyro: { q: gyroInt.q },
      accel: { q: quatFromAccel(aig, lastAlpha) },
    };
    for (const key of Object.keys(sols)) {
      const e = eulerFromQuat(sols[key].q);
      sols[key].e = e;
      setRow(key, fmt(e.alpha), fmt(e.beta), fmt(e.gamma), fmtQ(sols[key].q));
    }

    // 融合状态说明
    const still = gainsNow.ki > 0;
    els.fusionNote.textContent = inited
      ? `状态: ${still ? '静止 → 快速收敛(Kp 0.8, Ki 0.2, 积分消零偏)' : '运动 → 低增益跟手(Kp 0.15, 防线性加速度污染)'} · `
        + `偏航${yawFlip ? '反转' : '正常'}`
      : '等待有效帧…';

    // 曲线
    chart.push('device', alpha, o.b, o.g);
    chart.push('fuse', sols.fuse.e.alpha, sols.fuse.e.beta, sols.fuse.e.gamma);
    chart.push('gyro', sols.gyro.e.alpha, sols.gyro.e.beta, sols.gyro.e.gamma);
    chart.push('accel', sols.accel.e.alpha, sols.accel.e.beta, sols.accel.e.gamma);

    // 3D 长方体
    setCube(sols[srcNow].q);

    els.hz.textContent = `${recvWindow.length} Hz`;
    els.frames.textContent = frames;

    window.__attitudeTest = {
      frames, inited, src: srcNow, yawFlip,
      device: sols.device.e, fuse: sols.fuse.e, gyro: sols.gyro.e, accel: sols.accel.e,
      gains: gainsNow,
    };
  }

  function setRow(key, a, b, g, q) {
    const tr = els.attRows.get(key);
    if (!tr) return;
    tr.querySelector('.a').textContent = a;
    tr.querySelector('.b').textContent = b;
    tr.querySelector('.g').textContent = g;
    tr.querySelector('.q').textContent = q;
  }

  function handlers() {
    return {
      onData(d) {
        if (!d || typeof d !== 'object') return;
        if (d.t === P.SENSOR) onSensor(d);
        else if (d.t === P.PING) host?.send({ t: P.PONG, ts: d.ts });
        else if (d.t === P.PONG) {
          const dt = Date.now() - d.ts;
          els.ping.textContent = `${Math.max(0, dt)} ms`;
        } else if (d.t === P.RESET) {
          reinit();
        }
      },
      onOpen() {
        connected = true;
        els.device.textContent = '手机已连接';
        els.device.classList.remove('muted');
        els.device.classList.add('ok');
        els.status.textContent = '已连接';
        els.status.classList.add('ok');
      },
      onClose() {
        connected = false;
        els.device.textContent = '手机已断开, 等待重连…';
        els.device.classList.add('muted');
        els.status.textContent = '等待手机';
        els.status.classList.remove('ok');
      },
      onError(e) { console.error('[pc] conn error', e); },
    };
  }

  function refreshQr() {
    els.code.textContent = roomCode;
    renderQr(els.qr, roomCode).catch((e) => console.error('qr', e));
  }

  async function makeHost(attempt = 0) {
    if (host) { try { host.close(); } catch { /* noop */ } }
    els.status.textContent = attempt > 0 ? `重连信令 (${attempt}/2)…` : '生成房间中…';
    try {
      host = await createHost(roomCode, handlers());
      await discoveryReady();
      stopAnnounce?.();
      stopAnnounce = pcAnnounce(roomCode, host.id);
      els.status.textContent = '房间已广播, 等待手机…';
    } catch (e) {
      if (e?.type === 'unavailable-id') {
        roomCode = genRoomCode();
        refreshQr();
        await makeHost(0);
        return;
      }
      if (attempt < 2) {
        setTimeout(() => makeHost(attempt + 1), 800);
        return;
      }
      console.error(e);
      els.status.textContent = '信令不可用, 点「换一个」重试';
    }
  }

  // ---- 3D 场景 ----
  const renderer = new THREE.WebGLRenderer({ canvas: $('#pc3d'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b18);
  scene.up.set(0, 0, 1);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
  camera.up.set(0, 0, 1);
  camera.position.set(2.4, -2.4, 1.5);
  camera.lookAt(0, 0, 0.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.25);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(1, -1.5, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
  fill.position.set(-1.5, 1, 0.5);
  scene.add(fill);

  const grid = new THREE.GridHelper(4.4, 22, 0x4a4a72, 0x262642);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  // 重力箭头(世界 -Z 下)
  const gravArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-0.95, 0.95, 0.55), 0.55, 0x8899aa, 0.14, 0.08);
  scene.add(gravArrow);

  // 手机长方体
  const cubeGroup = new THREE.Group();
  cubeGroup.position.set(0, 0, 0.5);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23232f, roughness: 0.55, metalness: 0.45 });
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0c3340, emissive: 0x16c3f0, emissiveIntensity: 0.5, roughness: 0.25, metalness: 0.05,
  });
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.32, 0.014),
    [bodyMat, bodyMat, bodyMat, bodyMat, screenMat, bodyMat],
  );
  cubeGroup.add(cube);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x7a8bb0 }),
  );
  cubeGroup.add(edges);
  const axes = [
    new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 0.34, 0xff4d5e, 0.12, 0.06),
    new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 0.46, 0x3ddc84, 0.12, 0.06),
    new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 0.34, 0x3f9bff, 0.12, 0.06),
  ];
  for (const a of axes) cubeGroup.add(a);
  scene.add(cubeGroup);

  function setCube(q) {
    cube.quaternion.set(q.x, q.y, q.z, q.w);
  }

  function onResize() {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    chart.draw();
    renderer.render(scene, camera);
  };

  // ---- 曲线图 ----
  const chart = new MiniChart(els.chart, CHART_SECONDS * 60);
  chart.addSource('device', '#ffd166');
  chart.addSource('fuse', '#4de3ff');
  chart.addSource('gyro', '#ff6b81');
  chart.addSource('accel', '#b48cff');
  els.chartTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      els.chartTabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      chart.setAngle(btn.dataset.ang);
    });
  });

  // ---- 3D 跟随来源 ----
  let srcNow = 'fuse';
  els.srcRadios.forEach((r) => {
    r.addEventListener('change', () => {
      srcNow = r.value;
      const q = srcNow === 'device' ? lastQ
        : srcNow === 'fuse' ? mah.q
          : srcNow === 'gyro' ? gyroInt.q
            : srcNow === 'accel' ? quatFromAccel(lastAig, lastAlpha)
              : null;
      if (q) setCube(q);
    });
  });

  // ---- 绑定 ----
  els.attRows = new Map();
  document.querySelectorAll('.att tbody tr[data-src]').forEach((tr) => {
    els.attRows.set(tr.dataset.src, tr);
  });
  els.newcode.addEventListener('click', () => {
    roomCode = genRoomCode();
    refreshQr();
    makeHost();
  });
  els.reset.addEventListener('click', reinit);
  els.yawflip.addEventListener('change', () => {
    yawFlip = els.yawflip.checked;
    // 切换偏航方向后重算基准, 避免融合解和系统解方向不一致
    if (lastO) {
      lastQ = quatFromDeviceEuler(useAlpha(lastO.a), lastO.b, lastO.g);
      mah.setOrientation(lastQ);
      gyroInt.setOrientation(lastQ);
      chart.clear();
    }
  });
  $('#pc-back').addEventListener('click', () => navigate('/'));

  showScreen('screen-pc');
  onResize();
  refreshQr();
  makeHost();
  loop();

  return () => {
    cancelAnimationFrame(raf);
    stopAnnounce?.();
    discoveryClose();
    if (host) { try { host.close(); } catch { /* noop */ } }
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    controls.dispose();
  };
}

// 轻量多序列折线图 (自动解开 360° 回绕)
class MiniChart {
  constructor(canvas, maxPoints) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.series = {};
    this.angle = 'beta';
    this._raf = null;
  }

  addSource(name, color) {
    this.series[name] = { color, data: [], off: 0, lastDelta: 0, lastRaw: null };
  }

  setAngle(a) {
    if (a === this.angle) return;
    this.angle = a;
    this.clear();
  }

  clear() {
    for (const s of Object.values(this.series)) {
      s.data = [];
      s.off = 0;
      s.lastDelta = 0;
      s.lastRaw = null;
    }
  }

  push(name, alpha, beta, gamma) {
    const s = this.series[name];
    if (!s) return;
    const v = this.angle === 'alpha' ? alpha : this.angle === 'beta' ? beta : gamma;
    // 用"原始 v 与上一个原始值"判断是否跨过 ±180(不能用已加 off 的存储值, 否则 off 非零后
    // 差值恒 >180, 每帧累加导致数值跑飞, 曾到 20 万度)。
    if (s.lastRaw != null && Math.abs(v - s.lastRaw) > 180) {
      // 跨过 ±180: 真实旋转时相邻两次过界方向一致, 持续累加一圈;
      // 万向锁区 α/γ 会在 ±180 来回抖(方向反复) -> 撤销上一次累加, off 不会无限增大。
      const delta = v > s.lastRaw ? -360 : 360;
      if (s.lastDelta === 0 || s.lastDelta === delta) {
        s.off += delta;
        s.lastDelta = delta;
      } else {
        s.off -= s.lastDelta;
        s.lastDelta = 0;
      }
    }
    s.lastRaw = v;
    s.data.push(v + s.off);
    if (s.data.length > this.maxPoints) s.data.shift();
  }

  draw() {
    const cvs = this.canvas;
    const w = cvs.clientWidth, h = cvs.clientHeight;
    if (cvs.width !== w * devicePixelRatio || cvs.height !== h * devicePixelRatio) {
      cvs.width = w * devicePixelRatio;
      cvs.height = h * devicePixelRatio;
    }
    const ctx = this.ctx;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 6, padR = 46, padT = 8, padB = 8;
    const iw = w - padL - padR, ih = h - padT - padB;

    // 范围
    let min = Infinity, max = -Infinity;
    for (const s of Object.values(this.series)) {
      for (const v of s.data) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) return;
    let span = max - min;
    if (span < 1) { span = 1; const mid = (min + max) / 2; min = mid - 0.5; max = mid + 0.5; }
    min -= span * 0.08; max += span * 0.08;

    const X = (i) => padL + (i / (this.maxPoints - 1)) * iw;
    const Y = (v) => padT + (1 - (v - min) / (max - min)) * ih;

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.fillStyle = '#7b88a8';
    ctx.font = '10px ui-monospace, monospace';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = padT + (g / 4) * ih;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      const val = max - (g / 4) * (max - min);
      ctx.fillText(val.toFixed(0), w - padR + 4, y + 3);
    }

    for (const s of Object.values(this.series)) {
      const n = s.data.length;
      if (n < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = padL + (n - 1 - i) * (iw / (this.maxPoints - 1));
        const y = Y(s.data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
