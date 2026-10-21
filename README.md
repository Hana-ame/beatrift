# BeatRift · 体感节奏击打

一个 **3D 体感节奏游戏** —— 用手机当作光剑控制器，挥舞它击打飞来的音符方块。

PC 端运行游戏画面，手机端通过 IMU 传感器捕捉姿态并通过 WebRTC 实时同步。无需任何实体手柄，一部手机就是一把光剑。

![BeatRift 游戏画面](docs/gameplay.png)

## 功能特性

### 🎮 游戏体验

- **3D 光剑**：基于 Three.js 的全 3D 场景，光剑跟随手机朝向实时摆动，带拖尾轨迹和粒子特效
- **方向判定**：8 方向挥砍（上/下/左/右/左上/右上/左下/右下），基于时间窗口的总体速度方向判定，支持慢挥
- **命中评级**：PERFECT / GOOD / MISS / WRONG（方向错误），连击倍率计分
- **碎裂物理**：音符被砍中后碎成两半，cannon-es 物理引擎模拟下落、翻滚、淡出
- **多难度**：Easy / Normal / Hard，影响命中半径和时机窗口
- **无敌模式**：默认开启，专注练习不扣命

### 🎵 音乐系统

- **Web Audio 合成**：内置三首原创合成曲目（脉冲/冲刺/回响），各有独立的和弦进行、旋律和节奏密度
- **Lookahead 调度**：提前 120ms 排好音符，20ms 定时器推动，保证节拍精确同步
- **外链歌曲**：支持加载外部 MP3 文件（CORS），自动回退合成器
- **实时时钟**：`currentStep` / `currentBeat` 精确到 16 分音符，游戏判定与音乐完美对齐

### 📱 手机控制器

- **姿态解算**：基于 W3C Device Orientation + Device Motion 规范，使用四元数表示设备→世界旋转
- **Mahony 互补滤波**：陀螺仪积分 + 加速度计重力修正，可选融合模式（陀螺+加速）或系统解
- **校准流程**：像握光剑一样手持手机，顶边指向屏幕，一键设为基准方向
- **轴翻转修正**：反转 X/Y/Z 轴，无需重新校准即可适配不同握法
- **震动反馈**：命中时手机端振动

### 📡 网络连接

- **MQTT 房间发现**：通过公共 MQTT broker 广播房间码，手机自动发现可用的 PC 房间
- **PeerJS WebRTC**：P2P 直连传输姿态数据，低延迟（通常 <50ms）
- **QR 码分享**：PC 端生成二维码，手机一扫即连
- **房间码**：5 位唯一码（排除易混字符），也支持手动输入

### 📝 谱面编辑器

- **2D 编辑**：拖拽音符移动、框选、缩放、双击添加
- **3D 视图**：按 x 水平 / y 高度 / beat 纵深排列，直观预览
- **自动配色**：按 x 坐标自动分配颜色，也可手动指定
- **换位演出**：音符在飞行途中平滑移动到目标位置（smoothstep 缓动）
- **自动生成**：按密度、方向、位置规则批量生成音符
- **实时预览**：边编辑边播放，支持时间轴跳转
- **导入/导出**：JSON 格式，复制粘贴或下载文件

## 技术栈

| 类别 | 技术 |
|------|------|
| 3D 渲染 | Three.js (WebGL) |
| 物理引擎 | cannon-es |
| 音频 | Web Audio API |
| 网络 | PeerJS (WebRTC), MQTT |
| 传感器 | W3C Device Orientation/Motion, Mahony 互补滤波 |
| 构建 | Vite |
| 测试 | Playwright (E2E) |
| 二维码 | qrcode |
| 包管理 | npm |

## 安装

```bash
git clone https://github.com/Hana-ame/beatrift.git
cd beatrift
npm install
```

## 使用

### 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:5173/`

### 游戏流程

1. **PC 端**：打开网页 → 点击「我是 PC 显示器」→ 自动生成房间码和二维码
2. **手机端**：打开同一网页（手机浏览器）→ 点击「我是手机控制器」→ 扫码或输入房间码
3. **校准**：像握光剑一样手持手机，手机顶边指向 PC 屏幕中心 → 点击「设为正面」
4. **开始**：校准完成后点击「光剑 OK · 开始游戏」→ 选择难度 → 击打音符！

### 谱面编辑器

访问 `/editor/`，选择或新建谱面，编辑音符后下载 JSON 到 `charts/` 目录。

### 构建生产版本

```bash
npm run build
```

输出到 `dist/` 目录。

### 运行 E2E 测试

```bash
npm run test:e2e
```

### 可用的子应用

| 路径 | 说明 |
|------|------|
| `/` | 主游戏（PC + 手机） |
| `/editor/` | 谱面编辑器 |
| `/sword/` | 光剑调试（纯视觉） |
| `/ahrs/` | AHRS 姿态测试台 |
| `/gamepad/` | 万向摇柄测试 |
| `/pad/` | 手柄测试 |
| `/music/` | 音乐播放器 |
| `/test/` | 测试台 |

## 谱面格式

谱面为 JSON 文件，放在 `charts/` 目录：

```json
{
  "song": {
    "name": "星光练习",
    "bpm": 120,
    "synth": "pulse"
  },
  "notes": [
    { "beat": 0, "x": -1, "y": 1, "dir": "up" },
    { "beat": 1, "x": 1, "y": 1, "dir": "left" },
    { "beat": 2, "x": 0, "y": 2, "move": { "beat": 2, "to": { "x": -2, "y": 2 }, "dur": 2 } }
  ]
}
```

- `beat`：音符到达判定平面的拍数
- `x` / `y`：判定平面上的坐标
- `dir`：要求的挥砍方向（可选，缺省任意方向）
- `move`：换位演出（可选），音符在飞行途中从当前位置平滑移动到目标位置

## 项目结构

```
beatrift/
├── src/                    # 主游戏源码
│   ├── game/               # 游戏核心
│   │   ├── scene.js        # Three.js 场景装配
│   │   ├── gameplay.js     # 音符碰撞、方向判定、计分
│   │   ├── music.js        # Web Audio 合成器
│   │   ├── fx.js           # 粒子特效
│   │   ├── physics.js      # cannon-es 碎裂物理
│   │   └── index.js        # 游戏主控、校准、主循环
│   ├── ui/                 # UI 层
│   │   ├── screens.js      # 路由与屏幕切换
│   │   ├── pc.js           # PC 端房间管理
│   │   ├── mobile.js       # 手机端连接与传感器
│   │   └── joinUrl.js      # 分享链接生成
│   ├── constants.js        # 全局常量
│   ├── version.js          # 版本信息（自动生成）
│   └── main.js             # 入口
├── lib/                    # 独立工具库
│   └── attitude.js         # 姿态解算（四元数、Mahony 滤波）
├── charts/                 # 谱面文件
├── editor/                 # 谱面编辑器
├── sword/                  # 光剑调试
├── ahrs/                   # AHRS 测试
├── gamepad/                # 万向摇柄
├── pad/                    # 手柄测试
├── music/                  # 音乐播放器
├── test/                   # 测试台
├── e2e/                    # E2E 测试
├── docs/                   # 文档
└── .github/workflows/      # CI/CD
```

## 校准指南

详见 [IMU-CALIBRATION-CHECK.md](docs/IMU-CALIBRATION-CHECK.md)，包含手机姿态自检步骤和判定标准。

## 许可

MIT License
