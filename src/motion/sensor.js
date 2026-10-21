import { SENSOR } from '../constants.js';
import { Mahony, quatFromAccel, quatFromDeviceEuler, qNormalize, qRotate, DEG } from '../../lib/attitude.js';

const JUMP_GUARD = 300;

export class Sensor {
  constructor({ forceSim = false } = {}) {
    this.enabled = false;
    this.q = null;               // 当前姿态四元数 (设备系->世界系)
    this.forward = null;         // 屏幕法线方向 (世界系)
    this.top = null;             // 手机长轴方向 (世界系)
    this.omega = 0;              // 角速度 (rad/s)
    this.calibrated = false;
    this.forceSim = forceSim;

    this._mahony = new Mahony({ kp: 0.5, ki: 0.05 });
    this._prevTs = 0;
    this._prevAccel = null;
    this._deviceQ = null;       // 设备绝对姿态 (deviceorientation), 与 /sword/ 一致, 全程锚定遏漂移
    this._peak = SENSOR.SWING_PEAK;
    this._min = SENSOR.SWING_MIN;
    this._lastSwingTs = 0;
    this._armed = false;
    this._motionHandler = null;
    this._orientationHandler = null;
    this._listeners = { frame: [], swing: [] };
    this._simTimer = null;
  }

  static get supported() {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  async requestPermission() {
    if (this.forceSim) return true;
    const withTimeout = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('denied'), 1500))]);
    try {
      if (window.DeviceMotionEvent && typeof window.DeviceMotionEvent.requestPermission === 'function') {
        const res = await withTimeout(window.DeviceMotionEvent.requestPermission());
        if (res !== 'granted') return false;
      }
      if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const res = await withTimeout(window.DeviceOrientationEvent.requestPermission());
        if (res !== 'granted') return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  start(onFrame, onSwing) {
    if (onFrame) this._listeners.frame.push(onFrame);
    if (onSwing) this._listeners.swing.push(onSwing);
    if (this.enabled) return;

    if (this.forceSim || !window.DeviceMotionEvent || !window.DeviceOrientationEvent) {
      console.warn('[sensor] 使用模拟器 (无陀螺仪/加速度计或 forceSim)');
      this.enabled = true;
      this._startSimulator();
      return;
    }
    this._motionHandler = (e) => this._onMotion(e);
    this._orientationHandler = (e) => this._onOrientation(e);
    window.addEventListener('devicemotion', this._motionHandler);
    window.addEventListener('deviceorientation', this._orientationHandler);
    this.enabled = true;
  }

  // 与 /sword/ 同一姿态来源: deviceorientation 绝对 alpha/beta/gamma -> 四元数, 全程锚定偏航, 不漂移
  _onOrientation(e) {
    const a = e.alpha, b = e.beta, g = e.gamma;
    if (a == null || b == null || g == null) return;
    this._deviceQ = quatFromDeviceEuler(a, b, g);
    if (!this.q) this.q = qNormalize(this._deviceQ);
  }

  _onMotion(e) {
    const accel = e.accelerationIncludingGravity;
    const gyro = e.rotationRate;
    if (!accel || !gyro) return;
    const now = performance.now();
    const dt = this._prevTs ? (now - this._prevTs) / 1000 : 0.016;

    // 陀螺仪 rotationRate 单位 deg/s -> rad/s
    const g = {
      x: (gyro.alpha ?? 0) * DEG,
      y: (gyro.beta ?? 0) * DEG,
      z: (gyro.gamma ?? 0) * DEG,
    };

    // 角速度跳变 >300°/s 视为噪声/翻转, 抑制; 否则用于挥舞检测
    const dg = Math.hypot(g.x, g.y, g.z);
    this.omega = (dt > 0 && dt < 0.1 && dg <= JUMP_GUARD * DEG) ? dg : 0;

    // 姿态来源: 优先 deviceorientation 绝对姿态(与 /sword/ 同一套, 偏航全程锚定, 不漂移);
    // 无 deviceorientation 时回退重力初始化+陀螺积分的 Mahony。
    if (this._deviceQ) {
      this.q = this._deviceQ;
    } else {
      if (!this.q) {
        this._mahony.setOrientation(quatFromAccel(accel, 0));
      } else {
        this._mahony.update(dt, g, accel);
      }
      this.q = qNormalize(this._mahony.q);
    }
    this.forward = qRotate(this.q, { x: 0, y: 0, z: 1 });
    this.top = qRotate(this.q, { x: 0, y: 1, z: 0 });

    this._prevTs = now;
    this._prevAccel = accel;
    this._checkSwing();
    this._emit('frame', {
      q: this.q,
      forward: this.forward,
      top: this.top,
      omega: this.omega,
    });
  }

  setSwingThresholds(peak, min) {
    this._peak = peak;
    this._min = min;
  }

  _checkSwing() {
    const now = performance.now();
    if (now - this._lastSwingTs < SENSOR.SWING_COOLDOWN_MS) return;
    if (this._armed) {
      if (this.omega < this._min) this._armed = false;
    } else if (this.omega > this._peak) {
      this._armed = true;
      this._lastSwingTs = now;
      this._emit('swing', { omega: this.omega });
    }
  }

  calibrate() {
    this.calibrated = true;
  }

  recalibrate() {
    this.calibrated = false;
  }

  vibrate(strength = 1) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(Math.round(12 + Math.min(Math.max(strength, 0.1), 1.5) * 55));
      } catch { /* ignore */ }
    }
  }

  stop() {
    if (this._motionHandler) window.removeEventListener('devicemotion', this._motionHandler);
    if (this._orientationHandler) window.removeEventListener('deviceorientation', this._orientationHandler);
    this._motionHandler = null;
    this._orientationHandler = null;
    this._stopSimulator();
    this.enabled = false;
    this._listeners = { frame: [], swing: [] };
  }

  _emit(type, data) {
    for (const fn of this._listeners[type]) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  _startSimulator() {
    let t = 0;
    let lastSwing = 0;
    let boost = 0;
    const startTs = performance.now();
    // 校准初段(前 1.2s)保持中性指向屏幕内部 INTO=(0,-1,0) 对应 W3C 欧拉角 (alpha=180, beta=0, gamma=0),
    // 让 PC 端自动校准基准 mapQ = Identity；随后进入平滑 8 字轨迹挥舞，兼顾手动 ?sim=1 与 e2e 测试。
    this._simTimer = setInterval(() => {
      t += 0.016;
      const now = performance.now();
      if (!this.calibrated && now - startTs > 1200) {
        this.calibrated = true;
      }
      let alpha = 180;
      let beta = 0;
      let gamma = 0;
      let omega = 0.25;

      if (this.calibrated) {
        alpha = 180 + Math.sin(t * 1.4) * 22;
        beta = 4 + Math.sin(t * 0.9) * 14;
        gamma = Math.cos(t * 1.1) * 18;
        omega = 1.0 + Math.abs(Math.cos(t * 1.4)) * 1.0;
        if (now - lastSwing > 1400) {
          boost = 1;
          lastSwing = now;
        }
        alpha += boost * 12;
        boost = Math.max(0, boost - 0.12);
        if (boost > 0.5) omega = SENSOR.SWING_PEAK + 2.2;
      }

      this.q = qNormalize(quatFromDeviceEuler(alpha, beta, gamma));
      this.forward = qRotate(this.q, { x: 0, y: 0, z: 1 });
      this.top = qRotate(this.q, { x: 0, y: 1, z: 0 });
      this.omega = omega;
      this._checkSwing();
      this._emit('frame', { q: this.q, forward: this.forward, top: this.top, omega });
    }, 16);
  }

  _stopSimulator() {
    if (this._simTimer) clearInterval(this._simTimer);
    this._simTimer = null;
  }
}
