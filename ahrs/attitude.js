// 手机姿态解算核心数学 (纯 JS, 无外部依赖, 可在 node 中直接验证)
//
// 坐标系约定 (与 W3C Device Orientation and Motion 规范一致):
//   - 设备系: x=屏幕右, y=屏幕顶, z=垂直于屏幕向外
//   - 地球系: X=东, Y=北, Z=天(上), 重力方向 = -Z
//   - alpha/beta/gamma 为 Z - X' - Y'' 内旋 Tait-Bryan 角:
//     先绕 z 转 alpha, 再绕新 x 转 beta, 再绕新 y 转 gamma
//   - quaternion q 表示 设备系 -> 地球系 (body -> world) 的旋转
//   - 静止时加速度计读数(含重力)指向"上", 即世界 +Z 在设备系中的方向

export const DEG = Math.PI / 180;

// 角度归一化到 [-180, 180)
export function wrapDeg(a) {
  return ((a % 360) + 540) % 360 - 180;
}

// ---------- 向量 ----------
export function vec3(x, y, z) {
  return { x, y, z };
}

export function normalize3(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// ---------- 四元数 ----------
export function qIdentity() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function qNormalize(q) {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

// 右乘 q ⊗ p
export function qMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qConjugate(q) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function qInvert(q) {
  const n = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w || 1;
  const c = qConjugate(q);
  return { x: c.x / n, y: c.y / n, z: c.z / n, w: c.w / n };
}

// 用四元数旋转向量 (body -> world)
export function qRotate(q, v) {
  const r = qMul(qMul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), qConjugate(q));
  return { x: r.x, y: r.y, z: r.z };
}

// ---------- 旋转矩阵 (row-major, 9 元数组) ----------
// 标准 四元数->旋转矩阵 (设备系->地球系)
export function matFromQuat(q) {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ];
}

// 旋转矩阵 -> 四元数 (Shoemake)
export function quatFromMat(m) {
  const t = m[0] + m[4] + m[8];
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = { w: 0.25 * s, x: (m[7] - m[5]) / s, y: (m[2] - m[6]) / s, z: (m[3] - m[1]) / s };
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = { w: (m[7] - m[5]) / s, x: 0.25 * s, y: (m[1] + m[3]) / s, z: (m[2] + m[6]) / s };
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = { w: (m[2] - m[6]) / s, x: (m[1] + m[3]) / s, y: 0.25 * s, z: (m[5] + m[7]) / s };
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = { w: (m[3] - m[1]) / s, x: (m[2] + m[6]) / s, y: (m[5] + m[7]) / s, z: 0.25 * s };
  }
  return qNormalize(q);
}

export function matMul3(a, b) {
  const o = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

export function matTranspose(m) {
  return [
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8],
  ];
}

// W3C Z - X' - Y'' 内旋角 -> 设备系->地球系 旋转矩阵
export function w3cMatrix(alphaDeg, betaDeg, gammaDeg) {
  const ca = Math.cos(alphaDeg * DEG), sa = Math.sin(alphaDeg * DEG);
  const cb = Math.cos(betaDeg * DEG), sb = Math.sin(betaDeg * DEG);
  const cg = Math.cos(gammaDeg * DEG), sg = Math.sin(gammaDeg * DEG);
  return [
    ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg,
    sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg,
    -cb * sg, sb, cb * cg,
  ];
}

// W3C 角 -> 四元数 (设备系->地球系)
export function quatFromDeviceEuler(alphaDeg, betaDeg, gammaDeg) {
  return quatFromMat(w3cMatrix(alphaDeg, betaDeg, gammaDeg));
}

// 四元数(设备系->地球系) -> W3C 角, 与设备自身报出的 alpha/beta/gamma 可比
export function eulerFromQuat(q) {
  const m = matFromQuat(q);
  const beta = Math.asin(Math.max(-1, Math.min(1, m[7]))) / DEG;
  let alpha = Math.atan2(-m[1], m[4]) / DEG;
  let gamma = Math.atan2(-m[6], m[8]) / DEG;
  alpha = (alpha % 360 + 360) % 360;
  gamma = (gamma % 360 + 540) % 360 - 180;
  return { alpha, beta, gamma };
}

// 世界 +Z(上) 方向在设备系中的表示 (静止加速度计读数归一化后应等于它)
export function upInDevice(q) {
  const up = { x: 0, y: 0, z: 1 };
  const inv = qInvert(q);
  return qRotate(inv, up);
}

// 最短弧旋转: 从 from 单位向量转到 to 单位向量的四元数
export function shortestArc(from, to) {
  const f = normalize3(from), t = normalize3(to);
  const d = f.x * t.x + f.y * t.y + f.z * t.z;
  if (d > 1 - 1e-10) return { x: 0, y: 0, z: 0, w: 1 };
  if (d < -1 + 1e-10) {
    const ax = Math.abs(f.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const c = normalize3({
      x: f.y * ax.z - f.z * ax.y,
      y: f.z * ax.x - f.x * ax.z,
      z: f.x * ax.y - f.y * ax.x,
    });
    return { x: c.x, y: c.y, z: c.z, w: 0 };
  }
  const s = Math.sqrt((1 + d) * 2);
  const v = {
    x: (f.y * t.z - f.z * t.y) / s,
    y: (f.z * t.x - f.x * t.z) / s,
    z: (f.x * t.y - f.y * t.x) / s,
  };
  return qNormalize({ x: v.x, y: v.y, z: v.z, w: s / 2 });
}

// ---------- 仅重力(静态)解算 ----------
// 静止/慢速时由加速度计读数直接估计俯仰角 beta 与横滚角 gamma; 偏航 alpha 不可观测(需罗盘)。
// 原理: 加速度计(含重力)测的是"上"方向, 先由最短弧转到世界+Z, 解出 beta/gamma。
// 注意旧实现 gamma=atan2(-a.x,a.z) 在屏幕水平(平放)时会把平放屏上/屏下颠倒, 已废弃。
export function accelStaticEuler(accel, alphaHint) {
  const a = normalize3(accel);
  const u = { x: -a.x, y: -a.y, z: -a.z };   // 世界"上"在设备系中的方向
  const e = eulerFromQuat(shortestArc(u, { x: 0, y: 0, z: 1 }));
  return { alpha: alphaHint ?? 0, beta: e.beta, gamma: e.gamma };
}

export function quatFromAccel(accel, alphaHint) {
  const { beta, gamma } = accelStaticEuler(accel, alphaHint);
  return quatFromDeviceEuler(alphaHint ?? 0, beta, gamma);
}

// ---------- Mahony 互补滤波 (ahrs 包实现) ----------
// 包装 npm 包 ahrs 的 Mahony 算法: update(gyro rad/s, accel 含重力) -> q (body->world)。
// 与 test/attitude.js 的自研实现保持同一接口(q/reset/setOrientation/update), 便于无缝替换。
// 说明:
//   - ahrs 输入 accel 单位为 g, 此处已换算; 磁力计走 IMU-only 分支(与无罗盘一致)。
//   - ahrs 的 doInitialisation 在无磁力计时会 NaN (eulerAnglesFromImuRad 里 mx/undefined),
//     故关闭自动初始化, 首帧用本文件的 quatFromAccel(仅重力) 初始化姿态。
//   - 运行期调 kp/ki 需重建实例, 重建后首帧重新用 accel 初始化。
import AHRS from 'ahrs';

export class Mahony {
  constructor({ kp = 0.5, ki = 0.0 } = {}) {
    this._kp = kp;
    this._ki = ki;
    this._inited = false;
    this._ahrs = null;
    this.q = qIdentity();
    this._rebuild();
  }

  // 运行期调增益 (ahrs 的 kp/ki 是构造参数, 只能重建实例)
  // 重建会丢内部姿态; 若已初始化, 立即用当前 q 重新 init, 保持融合基准不跳变。
  set kp(v) { if (v !== this._kp) { this._kp = v; this._rebuild(); if (this._inited) this._reinitCurrent(); } }
  get kp() { return this._kp; }
  set ki(v) { if (v !== this._ki) { this._ki = v; this._rebuild(); if (this._inited) this._reinitCurrent(); } }
  get ki() { return this._ki; }

  _reinitCurrent() {
    const accel = upInDevice(this.q);
    const mag = qRotate(qInvert(this.q), { x: 1, y: 0, z: 0 });
    this._ahrs.init(accel.x, accel.y, accel.z, mag.x, mag.y, mag.z);
    this._inited = true;
  }

  _rebuild() {
    this._ahrs = new AHRS({
      algorithm: 'Mahony',
      sampleInterval: 60,
      kp: this._kp,
      ki: this._ki,
      doInitialisation: false,
    });
    this._inited = false;
  }

  reset() {
    this.q = qIdentity();
    this._rebuild();
  }

  setOrientation(q) {
    // ahrs 无姿态 setter, 但可用 init(accel, magneto) 精确设初始姿态:
    // accel = 静止时重力方向(设备系) = upInDevice(q); 伪造磁力计读数 = 把世界 +X
    // 经 q⁻¹ 旋转到设备系, 使 ahrs 重建出四元数 q (坐标系一致, 已 node 验证 0.000°)。
    const accel = upInDevice(q);
    const mag = qRotate(qInvert(q), { x: 1, y: 0, z: 0 });
    this._rebuild();
    this._ahrs.init(accel.x, accel.y, accel.z, mag.x, mag.y, mag.z);
    this.q = qNormalize(q);
    this._inited = true;
  }

  // gyro: 角速度 rad/s {x,y,z}(设备系, 右手规则); accel: 加速度 m/s² {x,y,z}(含重力)
  update(dt, gyro, accel) {
    if (!this._inited) {
      // 首帧: 用仅重力解算给 ahrs 一个可用的初始姿态 (对无磁力计场景, 相当于设基准)。
      this.setOrientation(quatFromAccel(accel, 0));
      this._inited = true;
    }
    // ahrs 加速度计期望单位 g; 9.8 m/s² = 1 g
    this._ahrs.update(
      gyro.x, gyro.y, gyro.z,
      accel.x / 9.8, accel.y / 9.8, accel.z / 9.8,
      undefined, undefined, undefined,
      dt,
    );
    const q = this._ahrs.getQuaternion();
    this.q = qNormalize({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.q;
  }
}

// 纯陀螺仪积分 (演示漂移)
export class GyroIntegrator {
  constructor() {
    this.q = qIdentity();
  }

  reset() {
    this.q = qIdentity();
  }

  setOrientation(q) {
    this.q = qNormalize(q);
  }

update(dt, gyro) {
    const { x, y, z, w } = this.q;
    const dq = {
      x: 0.5 * dt * (w * gyro.x + y * gyro.z - z * gyro.y),
      y: 0.5 * dt * (w * gyro.y - x * gyro.z + z * gyro.x),
      z: 0.5 * dt * (w * gyro.z + x * gyro.y - y * gyro.x),
      w: 0.5 * dt * (-x * gyro.x - y * gyro.y - z * gyro.z),
    };
    this.q = qNormalize({
      x: x + dq.x, y: y + dq.y, z: z + dq.z, w: w + dq.w,
    });
    return this.q;
  }
}