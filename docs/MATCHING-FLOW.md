# 光剑方向匹配流程

核心概念：**"屏幕即前方"**。手机顶边(长轴, +Y)就像光剑，指向哪里、剑就指向哪里。
通过**单点基准校准**把"校准时刻手机顶边的指向"重映射为"指向屏幕内部(INTO)"，之后每帧都用手机实时顶边方向换算成剑方向。

## 坐标约定

- 世界系：**z-up**(scene.up=(0,0,1))。
- 屏幕内部方向：`INTO = (0,-1,0)`（剑尖基准朝向，水平、与重力垂直）。
- 剑旋转枢轴：`SWORD_PIVOT = (0, 0.5, 1.4)`；剑长 `SWORD_LEN = 5.6`。
- 音符判定平面：`y = NOTE_PLANE_Y = -4.4`，出生在 `y = NOTE_SPAWN_Y = -56`，沿 +Y 飞向平面。
- 注释/代码里统一称"顶边方向" = 手机长轴在世界系的单位方向。

## 手机端（只管发，不做校准）

`src/ui/mobile.js` + `src/motion/sensor.js`：

1. 姿态来源用 `deviceorientation` 绝对 alpha/beta/gamma → `quatFromDeviceEuler` 得到 `this.q`，并用它 **锚定 Mahony**（与 `/sword/` 同一套，偏航全程被钉住、不漂移）；无 `deviceorientation` 时才回退"重力初始化 + 陀螺积分"。
2. 每帧 `top = qRotate(q, {x:0, y:1, z:0})`（手机长轴在世界系方向）。
3. 通过 `encodeMotion(top, omega, hit)` 打包成 6 个 float 的二进制帧发出（`f[0..2]=top`，`f[3]=omega`，`f[4]=hit>0?omega:0`）。

手机完全不做校准/反转/难度，只把原始姿态流给 PC。

## PC 端校准与匹配

`src/game/index.js`：

### 校准状态

```
calibState = { mapQ, ref, flips:{x,y,z}, top }
```

- `flips` 分量反转（默认 +1，可 ±1），用于修正左右/上下/正反握持习惯。
- `setFront()`（"设为正面"按钮，或首帧无基准时自动）：

```js
calibState.ref = calibState.top;
calibState.mapQ = shortestArc(calibState.ref, INTO);   // 基准顶边 -> 屏幕内
```

- 每帧的剑方向 `applyCalib()`：

```js
base = qRotate(mapQ, top);                 // 实时顶边经基准重映射
dir  = { flips.x*base.x, flips.y*base.y, flips.z*base.z };
```

即：**校准瞬间手机顶边所指 → 令剑朝 INTO**；此后顶边相对该校准姿态的运动，原样映射成剑的指向。

### 入口流程

1. 手机连接 → `pc.js` `onOpen` → `startGame({host, roomCode, diff, calibrate:true})` + 显示 `screen-game`。
2. 出现 `#calib-overlay`：可点"反转左右/上下/正反"(改 flips)、"设为正面"(setFront)；首帧 motion 到达会自动 setFront。
3. 点"光剑 OK · 开始游戏" → `beginPlay()`：去掉浮层、`music.start()`、向手机发 `P.START`。
4. 游戏期每帧 `handleMotion(frame)`：`calibState.top = frame.dir` → `applyCalib()` → `game.setSwordDir(dir, omega)`；`frame.hit>0` 额外触发 `onSwing`。

### 剑的渲染

`scene.js` → `sword.group.quaternion.setFromUnitVectors(UP, dir)`，UP=(0,1,0)；相机第一人称贴在枢轴上方，`followView` 让视线半跟随剑方向 + 延迟。

## 命中判定（纯接触，与速度无关）

`gameplay.js` `_collideNotes`：取剑刃绳段（枢轴→剑尖），对每个在窗口内的音符求**点到线段最近距离**，`<= HIT_RADIUS` 即命中。不要求挥动速度/位移——剑停着碰到音符也立刻砍碎。

命中 → `_hit`：清音符 + 计分连击 + `physics.splitNote(pos, color, cutDir, scene)` 碎裂：
- **碎成 2 块**，用音符本体的**八面体形状**随机压扁（不是方块）。
- 两块沿垂直剑刃的切向各自飞开，主要受重力向下，**不与地面/墙壁碰撞**（世界不再加任何静态刚体），淡出后从场景删除。

## 重新开始 / 退出

- `#hud-exit`（游戏中退出）、`#end-exit`（回房间）：`cleanup()` 后回 `screen-pc`。
- `#end-replay`（再来一次）：`startGame({..., keepCalib:true})`——保留 `calibState`（不再重置），跳过校准立即重开一整局。