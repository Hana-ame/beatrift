# 谱面编写指南（BeatMap）

谱面就是一个 JSON 数组：每个音符用 **"在哪一拍拍到判定平面"** + **"在平面上的位置"** 描述。
游戏只有一张谱：`public/charts/default.json`，由 `loadChart('default')` 在 `src/game/index.js` 里加载。

## 文件格式

```json
[
  { "beat": 8,   "x": 0,    "y": 1.6 },
  { "beat": 9,   "x": -1.9, "y": 0.9 },
  { "beat": 10,  "x": 1.9,  "y": 2.4 }
]
```

每个音符一个对象，三个字段：

| 字段 | 含义 | 建议范围（当前谱面） |
|------|------|----------------------|
| `beat` | 音符**到达判定平面的拍数**（128 BPM 的 4 分音符） | 从 ~8 开始（给开头留白），按 0.5/1 拍步进 |
| `x` | 平面上**水平**位置（世界 X） | `-2.6 ~ 2.6` |
| `y` | 平面上**垂直**位置（世界 Z，z-up，越大越高） | `0.3 ~ 3.0` |
| `color`（可选） | 音符颜色（0xRRGGBB 数字） | 省略时按 x 位置自动配色（`pickColor(x)`） |

## 音符怎么"动"

- 内部换算：`step = beat * 4`（每拍 4 个 step）。
- 音符在 `TRAVEL_STEPS ≈ 37 step`（约 9.25 拍 / 3.9 秒）前从远处出生，沿 +Y 飞向判定平面（`y=-4.4`）。
- **`beat` 就是它飞抵平面、该被砍中的那一拍**，所以编谱时 `beat` 要对准音乐节拍。
- 判定窗口：
  - 纯接触命中：剑刃（枢轴→剑尖）距音符 ≤ `HIT_RADIUS=1.2` 即碎，与挥动速度无关。
  - 时机窗口：`|当前step − 目标step| ≤ 4.5 step`（≈±1.1 拍）；`≤ 2 step` 为 PERFECT。
  - 超出窗口未砍到 → MISS。

## 编谱建议

1. **先踩拍**：用 DAW/节拍器对 BPM 128，把重拍标出来；第一个音符建议 `beat≥8`（开场约 3.7s 留白）。
2. **节奏密度**：
   - 慢段：每拍 1 个（`beat` 步进 1）。
   - 快段：半拍 1 个（步进 0.5），注意留够挥动空间，别两连音符贴太近。
3. **空间铺开**：左右（x）+ 上下（y）交替，制造挥剑动作；参考当前谱面的 `x` 正负交替、`y` 高-低-高。
4. **别堆在同一位置**：相邻音符最好间隔 ≥1 个单位，否则同一剑"砍到两个"体验差。
5. **颜色**：省略即自动按 x 渐变配色；也可手写 `color: 0xff2d78` 固定。

## 怎么用多张谱

`loadChart(name)` 接收谱面名，目前 `src/game/index.js` 里 `await loadChart()`（默认 `default`）。
想加第二张：新建 `public/charts/xxx.json`，再把 `loadChart()` 改成 `loadChart('xxx')`（或按需切换）。

## 相关代码

- `src/game/gameplay.js`：`loadChart()`（解析格式）、`_spawnNote`、`_collideNotes`（判定）
- `public/charts/default.json`：当前谱面
- `src/constants.js`：`GAME.BPM / NOTE_PLANE_Y / NOTE_SPAWN_Y / NOTE_SPEED` 等
