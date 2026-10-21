// /test/ 的传感器采集: deviceorientation(+absolute) + devicemotion
// 输出统一快照 { t, o, aig, al, gyr, iv, so }; sim=1 时用内置模拟器生成物理自洽的数据
import { quatFromDeviceEuler, upInDevice, DEG } from './attitude.js';

function withTimeout(p, ms = 1500) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r('denied'), ms))]);
}

export class TestSensor {
  constructor({ sim = false } = {}) {
    this.sim = sim;
    this.enabled = false;
    this.latest = null;
    this._cb = [];
    this._timer = null;
    this._sim = null;
    this._handlers = [];
  }

  static get supported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && 'DeviceMotionEvent' in window;
  }

  async requestPermission() {
    if (this.sim) return true;
    const calls = [];
    if (window.DeviceOrientationEvent?.requestPermission) {
      calls.push('orientation');
    }
    if (window.DeviceMotionEvent?.requestPermission) {
      calls.push('motion');
    }
    for (const kind of calls) {
      try {
        const r = await withTimeout(kind === 'motion'
          ? window.DeviceMotionEvent.requestPermission()
          : window.DeviceOrientationEvent.requestPermission());
        if (r !== 'granted') return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  start(cb) {
    this._cb.push(cb);
    if (this.enabled) return;

    if (this.sim || !TestSensor.supported) {
      console.warn('[test/sensor] 无传感器或 sim=1, 使用模拟器');
      this._sim = new SensorSimulator();
      this._sim.start((s) => this._push(s));
      this.enabled = true;
      return;
    }

    const onOrient = (e) => this._orient(e);
    const onOrientAbs = (e) => this._orient(e, true);
    const onMotion = (e) => this._motion(e);
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('deviceorientationabsolute', onOrientAbs);
    window.addEventListener('devicemotion', onMotion);
    this._handlers = [
      ['deviceorientation', onOrient],
      ['deviceorientationabsolute', onOrientAbs],
      ['devicemotion', onMotion],
    ];

    // 以固定频率合并输出最新快照 (deviceorientation 与 devicemotion 不同步)
    this._timer = setInterval(() => {
      if (this.latest) this._emit(this.latest);
    }, 16);
    this.enabled = true;
  }

  _orient(e, absolute = e?.absolute) {
    if (e?.alpha == null || e?.beta == null || e?.gamma == null) return;
    if (absolute && !e.absolute) return;
    this.latest = {
      ...(this.latest || {}),
      ts: Math.round(performance.now()),
      o: { a: e.alpha, b: e.beta, g: e.gamma, abs: !!e.absolute },
    };
  }

  _motion(e) {
    const aig = e.accelerationIncludingGravity;
    const al = e.acceleration;
    const gyr = e.rotationRate;
    if (!aig && !gyr) return;
    this.latest = {
      ...(this.latest || {}),
      ts: Math.round(performance.now()),
      aig: aig ? { x: aig.x ?? 0, y: aig.y ?? 0, z: aig.z ?? 0 } : this.latest?.aig,
      al: al ? { x: al.x ?? 0, y: al.y ?? 0, z: al.z ?? 0 } : this.latest?.al,
      gyr: gyr ? { x: gyr.alpha ?? 0, y: gyr.beta ?? 0, z: gyr.gamma ?? 0 } : this.latest?.gyr,
      iv: e.interval || this.latest?.iv || 0,
      so: window.screen?.orientation?.angle ?? 0,
    };
  }

  _push(s) {
    this.latest = s;
    this._emit(s);
  }

  _emit(s) {
    for (const cb of this._cb) {
      try { cb(s); } catch (err) { console.error(err); }
    }
  }

  stop() {
    this._sim?.stop();
    this._sim = null;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    for (const [name, fn] of this._handlers) window.removeEventListener(name, fn);
    this._handlers = [];
    this.enabled = false;
  }
}

// 模拟器: 生成 W3C 规范的欧拉角轨迹, 反推一致的重力加速度计读数与陀螺角速度
export class SensorSimulator {
  constructor() {
    this._timer = null;
    this._qPrev = null;
  }

  start(cb) {
    let t = 0;
    this._timer = setInterval(() => {
      t += 1 / 60;
      const alpha = 120 + 55 * Math.sin(0.22 * t);      // 偏航缓慢摆动 (罗盘式)
      const beta = 90 + 42 * Math.sin(0.7 * t + 1.0);   // 俯仰: 围绕竖直位 ±42°
      const gamma = 38 * Math.sin(1.05 * t);            // 横滚 ±38°
      const q = quatFromDeviceEuler(alpha, beta, gamma);

      // 陀螺 = 上一帧到本帧的四元数差 (设备系角速度, deg/s)
      let gyr = { x: 0, y: 0, z: 0 };
      if (this._qPrev) {
        const dq = {
          w: this._qPrev.w * q.w + this._qPrev.x * q.x + this._qPrev.y * q.y + this._qPrev.z * q.z,
          x: this._qPrev.w * q.x - this._qPrev.x * q.w - this._qPrev.y * q.z + this._qPrev.z * q.y,
          y: this._qPrev.w * q.y + this._qPrev.x * q.z - this._qPrev.y * q.w - this._qPrev.z * q.x,
          z: this._qPrev.w * q.z - this._qPrev.x * q.y + this._qPrev.y * q.x - this._qPrev.z * q.w,
        };
        const ang = 2 * Math.acos(Math.max(-1, Math.min(1, dq.w)));
        const n = Math.hypot(dq.x, dq.y, dq.z);
        if (n > 1e-9) {
          const mag = ang / (1 / 60) / DEG;
          gyr = { x: dq.x / n * mag, y: dq.y / n * mag, z: dq.z / n * mag };
        }
      }
      this._qPrev = q;

      // 加速度计 (含重力) = 世界"上"方向在设备系投影; 线性加速度近似 0 + 抖动
      const u = upInDevice(q);
      const noise = () => (Math.random() - 0.5) * 0.4;
      cb({
        ts: Math.round(performance.now()),
        o: { a: alpha, b: beta, g: gamma, abs: true },
        aig: { x: u.x * 9.8 + noise(), y: u.y * 9.8 + noise(), z: u.z * 9.8 + noise() },
        al: { x: noise(), y: noise(), z: noise() },
        gyr: {
          x: gyr.x + (Math.random() - 0.5) * 0.3,
          y: gyr.y + (Math.random() - 0.5) * 0.3,
          z: gyr.z + (Math.random() - 0.5) * 0.3,
        },
        iv: 16,
        so: 0,
      });
    }, 1000 / 60);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
