// 姿态解算数学验证 (node): W3C 矩阵 / 四元数往返 / Mahony 融合跟踪
import {
  DEG, w3cMatrix, quatFromDeviceEuler, eulerFromQuat, matFromQuat, matMul3,
  matTranspose, qRotate, qInvert, qMul, upInDevice, Mahony, GyroIntegrator,
  quatFromAccel, accelStaticEuler, wrapDeg,
} from './attitude.js';

let fail = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fail++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function quatToMat(q) { return matFromQuat(q); }

console.log('== W3C 矩阵 = 标准旋转(正交, det=+1) ==');
for (let i = 0; i < 200; i++) {
  const a = Math.random() * 360, b = Math.random() * 170 - 85, g = Math.random() * 170 - 85;
  const m = w3cMatrix(a, b, g);
  const mt = matTranspose(m);
  const I = matMul3(m, mt);
  let ortho = true;
  for (let k = 0; k < 9; k++) {
    const want = k % 4 === 0 ? 1 : 0;
    if (!near(I[k], want, 1e-9)) { ortho = false; break; }
  }
  if (!ortho) { ok(`ortho ${a},${b},${g}`, false); break; }
}
  ok('200 组随机角正交性 M·Mᵀ=I', true);

console.log('== 四元数 <-> W3C 角 往返 ==');
{
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * 360, b = Math.random() * 160 - 80, g = Math.random() * 160 - 80;
    const q = quatFromDeviceEuler(a, b, g);
    const e = eulerFromQuat(q);
    const q2 = quatFromDeviceEuler(e.alpha, e.beta, e.gamma);
    const d = Math.abs(q.w - q2.w) + Math.abs(q.x - q2.x) + Math.abs(q.y - q2.y) + Math.abs(q.z - q2.z);
    if (d > 1e-6) { bad++; ok(`roundtrip ${a},${b},${g}`, false, `d=${d}`); }
  }
  ok(`200 组随机角 角->四元数->角 误差 < 1e-6 (失败 ${bad})`, bad === 0);
}

console.log('== W3C 规范示例 ==');
// 例1: 平放桌面, 屏幕朝上, 顶边朝西 -> alpha=90,beta=0,gamma=0
{
  const q = quatFromDeviceEuler(90, 0, 0);
  const top = qRotate(q, { x: 0, y: 1, z: 0 });   // 设备 y(顶边)
  const out = qRotate(q, { x: 0, y: 0, z: 1 });   // 设备 z(屏幕法线)
  ok('平放顶朝西: 顶边->西(-X)', near(top.x, -1, 1e-9) && near(top.y, 0, 1e-9), `(${top.x.toFixed(3)},${top.y.toFixed(3)},${top.z.toFixed(3)})`);
  ok('平放顶朝西: 屏幕法线->天(+Z)', near(out.z, 1, 1e-9) && near(out.x, 0, 1e-9), `(${out.x.toFixed(3)},${out.y.toFixed(3)},${out.z.toFixed(3)})`);
  const u = upInDevice(q);
  ok('平放顶朝西: 上方向=(0,0,1) (加速度计读数)', near(u.x, 0, 1e-9) && near(u.y, 0, 1e-9) && near(u.z, 1, 1e-9), `(${u.x.toFixed(3)},${u.y.toFixed(3)},${u.z.toFixed(3)})`);
}
// 例2: 屏幕竖直, 顶边朝上 -> beta=90 (与 alpha,gamma 无关)
{
  const q = quatFromDeviceEuler(0, 90, 0);
  const top = qRotate(q, { x: 0, y: 1, z: 0 });
  const out = qRotate(q, { x: 0, y: 0, z: 1 });
  ok('竖立顶朝上: 顶边->天(+Z)', near(top.z, 1, 1e-9) && near(top.x, 0, 1e-9) && near(top.y, 0, 1e-9), `(${top.x.toFixed(3)},${top.y.toFixed(3)},${top.z.toFixed(3)})`);
  ok('竖立顶朝上(alpha=0): 屏幕法线->南(-Y)', near(out.y, -1, 1e-9) && near(out.x, 0, 1e-9) && near(out.z, 0, 1e-9), `(${out.x.toFixed(3)},${out.y.toFixed(3)},${out.z.toFixed(3)})`);
  const u = upInDevice(q);
  ok('竖立顶朝上: 上方向=(0,1,0) (加速度计读数)', near(u.x, 0, 1e-9) && near(u.y, 1, 1e-9) && near(u.z, 0, 1e-9), `(${u.x.toFixed(3)},${u.y.toFixed(3)},${u.z.toFixed(3)})`);
}
// 例3: upInDevice = Mᵀ·(0,0,1) (含重力加速度计读数方向)
{
  const q = quatFromDeviceEuler(30, 45, 20);
  const u = upInDevice(q);
  const m = matFromQuat(q);
  ok('upInDevice = Mᵀ·(0,0,1)', near(u.x, m[6], 1e-9) && near(u.y, m[7], 1e-9) && near(u.z, m[8], 1e-9), `u=(${u.x.toFixed(3)},${u.y.toFixed(3)},${u.z.toFixed(3)})`);
}

console.log('== 仅重力(静态)解算 ==');
{
  const e = accelStaticEuler({ x: 0, y: 0, z: -9.8 }, 0);
  ok('平放屏上(0,0,-9.8) -> beta=0,gamma=0', near(e.beta, 0, 1e-9) && near(e.gamma, 0, 1e-9), `β=${e.beta.toFixed(2)} γ=${e.gamma.toFixed(2)}`);
  const e1b = accelStaticEuler({ x: 0, y: 0, z: 9.8 }, 0);
  ok('平放屏下(0,0,9.8) -> beta=0,gamma=±180', near(e1b.beta, 0, 1e-9) && near(Math.abs(e1b.gamma), 180, 1e-6), `β=${e1b.beta.toFixed(2)} γ=${e1b.gamma.toFixed(2)}`);
  const e2 = accelStaticEuler({ x: 0, y: -9.8, z: 0 }, 0);
  ok('竖立顶朝上(0,-9.8,0) -> beta=90', near(e2.beta, 90, 1e-6), `β=${e2.beta.toFixed(2)}`);
  const e3 = accelStaticEuler({
    x: 9.8 * Math.cos(45 * DEG) * Math.sin(30 * DEG),
    y: -9.8 * Math.sin(45 * DEG),
    z: -9.8 * Math.cos(45 * DEG) * Math.cos(30 * DEG),
  }, 0);
  ok('beta=45,gamma=30 读回一致', near(e3.beta, 45, 1e-6) && near(e3.gamma, 30, 1e-6), `β=${e3.beta.toFixed(2)} γ=${e3.gamma.toFixed(2)}`);
}

// 自适应增益 (与 PC 端一致): 静止时大 Kp 快速收敛 + Ki 消零偏; 运动时降低, 避免线性加速度污染
function adaptiveGains(accel) {
  const mag = Math.hypot(accel.x, accel.y, accel.z);
  const still = mag > 9.0 && mag < 10.6;
  return still ? { kp: 0.8, ki: 0.2 } : { kp: 0.15, ki: 0.0 };
}

console.log('== Mahony 融合跟踪 (陀螺噪声 + 恒定零偏, 20s) ==');
{
  const { angles, gyros, accels, dt } = simulateTrajectory();
  const mah = new Mahony({ kp: 0.5, ki: 0.05 });
  const gyroInt = new GyroIntegrator();
  mah.setOrientation(angles[0].q);
  gyroInt.setOrientation(angles[0].q);
  let maxMah = 0, maxGyro = 0;
  const err = (q, gt) => {
    const d = qMul(qInvert(q), gt);
    return 2 * Math.acos(Math.max(-1, Math.min(1, Math.abs(d.w)))) / DEG;
  };
  const warmup = 1.0; // 秒
  for (let i = 1; i < angles.length; i++) {
    const t = i * dt;
    // 恒定陀螺零偏 0.2°/s/轴
    const bias = { x: 0.2 * DEG, y: -0.15 * DEG, z: 0.1 * DEG };
    const g = { x: gyros[i].x + bias.x, y: gyros[i].y + bias.y, z: gyros[i].z + bias.z };
    const { kp, ki } = adaptiveGains(accels[i]);
    mah.kp = kp; mah.ki = ki;
    mah.update(dt, g, accels[i]);
    gyroInt.update(dt, g);
    if (t < warmup) continue;
    maxMah = Math.max(maxMah, err(mah.q, angles[i].q));
    maxGyro = Math.max(maxGyro, err(gyroInt.q, angles[i].q));
  }
  ok(`Mahony 融合(自适应增益+零偏) 最大姿态误差 < 3°`, maxMah < 3, `max=${maxMah.toFixed(2)}°`);
  ok(`纯陀螺积分(带零偏) 明显漂移(> Mahony + 3°)`, maxGyro > maxMah + 3, `max=${maxGyro.toFixed(2)}°`);
}

console.log('== 陀螺零偏抑制 (Ki>0 的积分项, 静态场景) ==');
{
  const dt = 1 / 60, N = 20 * 60;
  // 手机静止, 恒定姿态
  const q0 = quatFromDeviceEuler(60, 40, -20);
  const up0 = upInDevice(q0);
  const accel = { x: up0.x * 9.8, y: up0.y * 9.8, z: up0.z * 9.8 };
  // 恒定陀螺零偏 0.5°/s (各轴)
  const bias = { x: 0.5 * DEG, y: -0.3 * DEG, z: 0.2 * DEG };
  const mah = new Mahony({ kp: 0.8, ki: 0.2 });
  const gyroInt = new GyroIntegrator();
  mah.setOrientation(q0);
  gyroInt.setOrientation(q0);
  // 只度量"上方向"倾角误差: 绕重力轴的偏航零偏不可观测(无磁力计), 会表现为偏航漂移, 属物理极限
  const tiltErr = (q) => {
    const u = upInDevice(q);
    const cross = Math.hypot(
      u.y * up0.z - u.z * up0.y,
      u.z * up0.x - u.x * up0.z,
      u.x * up0.y - u.y * up0.x,
    );
    return Math.asin(Math.max(-1, Math.min(1, cross))) / DEG;
  };
  for (let i = 1; i <= N; i++) {
    mah.update(dt, bias, accel);
    gyroInt.update(dt, bias);
  }
  const finalMah = tiltErr(mah.q);
  const finalGyro = tiltErr(gyroInt.q);
  ok(`带零偏陀螺静止 20s: Mahony 上方向倾角误差 < 0.1° (积分项消零偏)`, finalMah < 0.1, `err=${finalMah.toFixed(3)}°`);
  ok(`带零偏陀螺静止 20s: 纯陀螺积分倾角漂移明显(> 1°)`, finalGyro > 1, `err=${finalGyro.toFixed(2)}°`);
}

console.log('== wrapDeg 归一化 (映射到 [-180,180)) ==');
{
  ok('wrapDeg(370)=10', near(wrapDeg(370), 10));
  ok('wrapDeg(-10)=-10 ≡ 350', near(wrapDeg(-10), -10) || near(wrapDeg(-10), 350));
  ok('wrapDeg(200)=-160', near(wrapDeg(200), -160));
  ok('wrapDeg(-200)=160', near(wrapDeg(-200), 160));
  ok('wrapDeg(180)=180 或 -180', near(Math.abs(wrapDeg(180)), 180));
}

console.log('== Mahony 北向校准 (correctYaw) ==');
{
  // 恒定偏航零偏 2°/s, 融合解绕重力轴漂移; 用罗盘航向校准应把它拉回
  const dt = 1 / 60, N = 30 * 60;
  const q0 = quatFromDeviceEuler(200, 40, -20);   // 起始航向 200°
  const up0 = upInDevice(q0);
  const accel = { x: up0.x * 9.8, y: up0.y * 9.8, z: up0.z * 9.8 };
  const bias = { x: 0.1 * DEG, y: -0.1 * DEG, z: 2.0 * DEG }; // z 轴(偏航)零偏大
  const mahNoCal = new Mahony({ kp: 0.8, ki: 0.2 });
  const mahCal = new Mahony({ kp: 0.8, ki: 0.2 });
  mahNoCal.setOrientation(q0);
  mahCal.setOrientation(q0);
  for (let i = 1; i <= N; i++) {
    mahNoCal.update(dt, bias, accel);
    mahCal.update(dt, bias, accel);
    mahCal.correctYaw(200, { kp: 0.5, ki: 0.05 });   // 每帧用罗盘航向 200° 校准
  }
  const aNo = eulerFromQuat(mahNoCal.q).alpha;
  const aCal = eulerFromQuat(mahCal.q).alpha;
  ok(`未校准: 30s 后偏航漂移 > 20° (${aNo.toFixed(1)}°)`, Math.abs(wrapDeg(aNo - 200)) > 20, `α=${aNo.toFixed(1)}°`);
  ok(`北向校准: 30s 后偏航误差 < 0.5°`, Math.abs(wrapDeg(aCal - 200)) < 0.5, `α=${aCal.toFixed(1)}°`);
}

function simulateTrajectory() {
  // 随时间变化的 W3C 角
  const t0 = 0, t1 = 20, dt = 1 / 60, N = Math.round((t1 - t0) / dt);
  const angles = new Array(N);
  let qPrev = null;
  const gyros = new Array(N);
  const accels = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    const alpha = 40 * Math.sin(0.4 * t) + 90;
    const beta = 45 * Math.sin(0.9 * t) + 45;
    const gamma = 30 * Math.sin(1.3 * t);
    const q = quatFromDeviceEuler(alpha, beta, gamma);
    angles[i] = { alpha, beta, gamma, q };
    if (qPrev) {
      // 数值微分得到设备系角速度: ω = 2·log(q̄⁻¹⊗q)/dt
      const dq = qMul(qInvert(qPrev), q);
      const ang = 2 * Math.acos(Math.max(-1, Math.min(1, dq.w)));
      const n = Math.hypot(dq.x, dq.y, dq.z);
      const axis = n > 1e-9 ? { x: dq.x / n, y: dq.y / n, z: dq.z / n } : { x: 0, y: 0, z: 1 };
      const mag = Math.abs(ang) > 1e-9 ? ang / dt : 0;
      gyros[i] = {
        x: axis.x * mag + (Math.random() - 0.5) * 0.02,   // + 0.01 rad/s 陀螺噪声
        y: axis.y * mag + (Math.random() - 0.5) * 0.02,
        z: axis.z * mag + (Math.random() - 0.5) * 0.02,
      };
    } else {
      gyros[i] = { x: 0, y: 0, z: 0 };
    }
    // 加速度计 = 重力(上方向)投影 + 线性加速度(仅当无剧烈运动时为重力)
    const u = upInDevice(q);
    accels[i] = {
      x: u.x * 9.8 + (Math.random() - 0.5) * 0.3,
      y: u.y * 9.8 + (Math.random() - 0.5) * 0.3,
      z: u.z * 9.8 + (Math.random() - 0.5) * 0.3,
    };
    qPrev = q;
  }
  return { angles, gyros, accels, dt };
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
