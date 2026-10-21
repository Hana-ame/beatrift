# beatrift (my-node-app)

体感光剑节奏击打游戏。vite 前端 + PeerJS(移动端当手柄) + Three.js 3D 场景。HTML 页面有 `/sword/` 调试页。

## 环境与启动
- 项目名 `beatrift`（package.json）。远程 git@github.com:Hana-ame/beatrift.git，分支 `main`（曾用 proj/webrtc，已改名）。
- dev server: `( setsid npx -- vite --port 5173 </dev/null >/tmp/vite.log 2>&1 & )`；验证 `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/`。
- 注意 `:5173` 可能被 /home/lumin/Hana-ame(gsap-framework) 抢占；隧道 `wsl-5173.moonchan.xyz` → :5173。
- e2e: `timeout 150 node e2e/e2e.mjs`（Playwright，连本机浏览器 CDP 9222）。
- 语法检查: `node --check <file>`。

## 架构与坐标系
- 世界 z-up；INTO=(0,-1,0)；SWORD_PIVOT=(0,0.5,1.4)；NOTE_PLANE_Y=-4.4、NOTE_SPAWN_Y=-56；SWORD_LEN=5.6、SWORD_OFFSET=0.7。
- `/sword/` 调试页保持不动（commit 22988c0 之后用户明确"不要还原"）；游戏与它同用 INTO=(0,-1,0)。
- 主文件: `src/game/index.js`、`src/game/gameplay.js`、`src/game/music.js`、`src/game/physics.js`、`src/motion/sensor.js`、`src/ui/pc.js`、`src/ui/mobile.js`、`src/lib/attitude.js`。

## 关键设计约定
- 校准: PC 端 calibState{mapQ,ref,flips{x/y/z},top}，`mapQ=shortestArc(ref,INTO)`，每帧 `dir=qRotate(mapQ,top)` 乘 flips；#calib-overlay 有反转 x/y/z、设为正面、开始。
- 手机端只流原始 `top=qRotate(q,{x:0,y:1,z:0})`+omega；encodeMotion f[0..2]=top、f[3]=omega、f[4]=hit?omega:0。
- 命中=**纯接触**（与速度无关）: 剑刃线段(枢轴→剑尖)到音符中心距离 ≤ HIT_RADIUS(1.2)；时机窗口 |step−target|≤4.5 step。
- 碎裂: SHARD_COUNT=2，OctahedronGeometry 非均匀缩放（音符碎片，不是方块），**无地面/墙交互**，只受重力+沿剑刃切向散开、淡出删除；splitNote(pos,color,cutDir,scene)。
- 漂移修复: sensor.js 加 deviceorientation 监听 → `_deviceQ=quatFromDeviceEuler(a,b,g)`，有则用绝对姿态，否则回退 Mahony。
- 三首歌: SONGS=[pulse 霓虹脉冲 song1 bpm128 / rush 激光冲刺 song2 bpm150 / void 深空回响 song3 bpm96]；chart JSON 支持 `{song:{name,bpm,synth,url?},notes:[...]}`；外链 url 在 beginPlay `await music.loadSong(url)`(fetch cors→decodeAudioData→循环)，失败回退合成；music.js 三风格 buildPattern(STYLES)，有真歌时 _scheduleStep 提前 return。
- 难度按钮暂时隐藏（diff-row hidden），"不要与速度扯上关系"。
- 退出/重开: `#hud-exit`/`#end-exit` → cleanup+showScreen('screen-pc')；`#end-replay` → startGame({keepCalib:true}) 保校准立即 beginPlay()。
- 全景按钮已整套删除（#debugcam-toggle/#debugcam-badge/C 键）。
- 谱面: `public/charts/default.json`(x±2.6,y 0.3~3.0)、song1.json(70 音)、song2.json(93 音)、song3.json(41 音)。

## 文档
- `docs/MATCHING-FLOW.md` 剑方向匹配、`docs/PEERJS-CONNECTION.md` 连接流程、`docs/CHART-GUIDE.md` 谱面指南。

## 部署
- Cloudflare Pages 项目 `hana-ame`，域名 `beatrift.moonchan.xyz`，构建 `CI=false npm run build` 输出 `dist`。
- **API 无法切换 git 源**（见全局 AGENTS.md）；改源/重连只能在面板: Settings → Connect to Git → Hana-ame/beatrift → main。
- 仓库 `Hana-ame/beatrift`（新建，独立于旧的 Hana-ame/Hana-ame）。

## git 现状
- 分支 `main`，跟踪 origin/main。提交/推送前先 `git status`/`git diff` 确认。
