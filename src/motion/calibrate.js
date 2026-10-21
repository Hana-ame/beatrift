// 光剑校准: 单点基准 + 全 3D 重映射 (与 sword/pc.js 一致)
import { qRotate, shortestArc } from '../../lib/attitude.js';
// 玩家手持手机, 像握光剑一样用手机顶边对准 PC 屏幕中心, 保持约 2 秒。
// 记录手机顶边(设备 +Y)方向为 refTop, 构造重映射旋转 mapQ = shortestArc(refTop, INTO),
// 使校准时(顶边冲向屏幕)剑指 INTO=(0,-1,0)(屏幕内部, 水平, 与重力垂直)。
// 之后: dir = qRotate(mapQ, 实时顶边方向) —— 剑在 3D 中跟随手机顶边, 全自由度。
// 优势: 剑可指向屏幕内/外/上下左右任意方向, 与 sword 调试页行为完全一致。
//
// 方向符号: 手机顶边向右转 -> 剑尖向右; 上抬 -> 剑尖向上; 前倾(顶边指向屏幕)-> 剑指 INTO。

const INTO = { x: 0, y: -1, z: 0 };   // 屏幕内部方向 (剑尖基准朝此, 水平, 与重力垂直)

export class Calib {
  constructor() {
    this.map = null;        // 基准重映射旋转 (四元数): refTop -> INTO
    this.refForward = null; // 基准 forward (屏幕法线, 指向屏幕中心)
  }

  reset() {
    this.map = null;
    this.refForward = null;
  }

  // q: 校准姿态四元数 (设备系->世界系)
  setRef(q, forward) {
    const top = qRotate(q, { x: 0, y: 1, z: 0 });
    this.map = shortestArc(top, INTO);
    this.refForward = forward || qRotate(q, { x: 0, y: 0, z: 1 });
  }

  get complete() {
    return !!this.map;
  }

  // 实时手机顶边方向 (世界系) -> 光剑方向 (全 3D)
  dir(top) {
    if (!this.map) return INTO;
    return qRotate(this.map, top);
  }
}