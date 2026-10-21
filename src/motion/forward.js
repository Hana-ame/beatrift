import { qRotate, qInvert, qMul, qNormalize, normalize3 } from '../../lib/attitude.js';

// 世界系: z 向上, 重力 down = (0,0,-1); 设备系 x=右, y=顶, z=屏幕法线(拍面)
// 姿态四元数 q (设备系->地球系), 屏幕法线 = qRotate(q, {0,0,1})。
// 与 test/attitude.js (lib/attitude.js) 的 quatFromDeviceEuler 保持一致。

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// 由姿态四元数解出屏幕法线(forward)与长轴(top)方向 (世界系)
export function quatAxes(q) {
  const n = qNormalize(q);
  return {
    forward: qRotate(n, { x: 0, y: 0, z: 1 }),
    top: qRotate(n, { x: 0, y: 1, z: 0 }),
  };
}

// 相对旋转: 当前姿态 q 相对基准姿态 refQ 的偏移, 返回应用在基准姿态上的相对旋转
// 即 qRel = refQ⁻¹ ⊗ q, 表示"手机从基准姿态转到当前姿态的相对转动"
export function relQuat(refQ, q) {
  return qNormalize(qMul(qInvert(refQ), q));
}

// 相对游戏屏平面分解
// refDir: 校准时「正前」对应的 forward(指向屏幕中心), 定义屏幕平面的法线
export function screenRel(dir, refDir) {
  const n = normalize3(refDir);
  const up = { x: 0, y: 0, z: 1 };
  const right = normalize3(cross(n, up));
  const vert = cross(right, n);

  const dp = dot(dir, n);
  const angleToPlane = Math.asin(Math.max(-1, Math.min(1, dp)));

  const inPlane = { x: dir.x - dp * n.x, y: dir.y - dp * n.y, z: dir.z - dp * n.z };
  return {
    angleToPlane,
    onScreen: { x: dot(inPlane, right), y: dot(inPlane, vert) },
  };
}
