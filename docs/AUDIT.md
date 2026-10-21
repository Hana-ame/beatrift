# 代码审计与修复计划

审计日期: 2026-08-29
范围: `src/` `lib/` `music/` `editor/` `gamepad/` `pad/` `test/` `ahrs/` + 依赖包 `@hana/link` `@hana/motion`
方法: 逐文件走读 → 扫描危险模式(innerHTML/eval/定时器/监听器/分配点/spread) → 对可疑点写独立脚本**实际执行验证**

标记约定:
- ✅ 已执行验证(有复现输出)
- 🔍 代码走读确认(未执行)
- 每条按 **问题 / 方案 / 修改 / 测试** 四段展开

---

## P0 正确性与安全

### 1. 并列双音符一刃双砍漏判第二个 ✅

**问题**
`gameplay.js` 两处 `for (const n of this.notes)` 遍历中调用 `_hit()`，而 `_hit()` 内部直接改同一个数组:

```
177: for (const n of this.notes) {        // update() 的 pending 复查
201:       this._hit(n, step);
203:       this._hit(n, step, false, true);
249: for (const n of this.notes) {        // _collideNotes
268:       this._hit(n, step);
418:     this.notes.splice(this.notes.indexOf(n), 1);   // _hit 内
```

`for...of` 的迭代器内部用索引前进，`splice(i,1)` 使后面的元素左移，下一次迭代跳到 `i+1` —— **紧随其后的音符被整帧跳过**。

用真实 `Game` 类 + 假 scene 复现(2 音同 beat、x 相邻 `-1.8/0`、dir 同为 `right`，一次横扫，总体速度 `{-7.5,0,0}`):

```
帧1 前 notes=2 good=0 perfect=0
帧1 后 notes=1 good=0 perfect=1   ← 只砍中 1 个
帧2 前(玩家已收手): notes=1
帧2 后 notes=1 good=0             ← 剩下 1 个再无法命中
```

收手后 `hasSpeed` 变 false，第二个音符进不了命中，时机窗口结束判 MISS。这直接违反本仓自定的「不 break：并列方块一次挥剑全部处理」(AGENTS.md 双音条款)。双音是谱面重音强调的**唯一**手段，所以这个 bug 命中的恰好是最常见的演出形态。

**方案**
不用 `slice()` 浅拷贝遍历 —— 那会分配一个新数组(每帧 O(n) 内存)，且 `_hit` 内 `indexOf` 在副本上仍能工作但语义含糊。
采用本文件已有的 `_missLater` 模式: **遍历只收集，循环结束后统一结算**。这样"一帧内的事件集"与"结算顺序"解耦，也天然消除同类隐患(将来再加事件类型不会重犯)。

**修改**
`src/game/gameplay.js` 两处:

```js
// update() 内 pending 复查: 收集后统一结算
const settled = [];
for (const n of this.notes) {
  ...
  if (n.pending) {
    if (this._pendingContact(n) && this._dirOk(n)) settled.push([n, false]);
    else if (Math.abs(step - n.targetStep) > this.hitSteps) settled.push([n, true]);
  }
}
for (const [n, wrong] of settled) this._hit(n, step, false, wrong);
for (const n of this._missLater) this._miss(n);
this._missLater.length = 0;
```

```js
// _collideNotes 内
const hits = [];
for (const n of this.notes) {
  ...
  if (this._dirOk(n)) hits.push(n);
  else if (!n.pending) n.pending = true;
}
for (const n of hits) this._hit(n, step);
```

`_hit`/`_miss` 本体不动(`indexOf`+`splice` 仍在数组上操作，此时已无外层遍历)。
`onSwing` 已是"先收集 best 再结算"的写法，无需改。

**测试**
1. 新增 `e2e/twin.mjs`(或并入 `e2e.mjs`)：注入双音符谱面，一次横扫后断言 `perfect===2 && notes.length===0`。当前实现下该断言必失败(1/2)，修复后必通过 —— 是可回归的硬断言。
2. `node --check src/game/gameplay.js`。
3. `timeout 160 node e2e/e2e.mjs` 保持 11/11(确认未破坏单音路径)。
4. 手测：手机连 PC，选 song1(9 处 move + 多组双音)，砍双音拍确认两音同碎、无残留。

---

### 2. 切后台回来：音乐爆音 + 音符集体 MISS ✅

**问题**
全仓 `grep -rn "visibilitychange\|pagehide\|beforeunload"` → **零匹配**。

切后台时 rAF 停止(`game.update` 冻结，音符不推进、不结算)，但 `AudioContext.currentTime` 和 `Music` 的 `setInterval` 继续走。`_tick()` 的补排逻辑没有积压上限:

```
256: _tick() {
258:   while (this._nextTime < this.ctx.currentTime + LOOKAHEAD) {
259:     this._scheduleStep(this._nextStep, this._nextTime);
```

模拟 20s 后台:

```
前台 4s: 已调度 35 个 step, 正常
后台期间每次 _tick 补排 8~9 个 step, 合计 +171 step
其中调度到"过去时刻"的音色 = 150 个
```

`oscillator.start(t)` 在 `t < currentTime` 时立即触发 → 150 个音色在同一 tick 内同时发声 = 爆音。同时 `currentStep` 已前进 171 step(≈43s 的谱面)，而 `game.update` 一次都没跑 → 回来时音符全部越过判定面，下一帧集中记 MISS，连击清零。

影响面：手机锁屏、切到其他 App、PC 切窗口/切桌面都会触发。这是**最高频**的异常路径，且恢复后不可逆(只能重开)。

**方案**
不依赖 `visibilitychange` 单独兜底 —— 后台节流策略各家浏览器不同(setInterval 节流到 1s 甚至更慢)，且窗口最小化在部分平台不发 visibilitychange。
选择在 `_tick()` 内做**幂等积压丢弃**: 一旦发现 `_nextTime` 已落后当前时刻超过一个容差，直接快进到"现在"并丢弃中间所有 step，让时钟重新对齐。这不改变正常播放行为(正常时 `_nextTime` 永远在未来)，只在异常发生后自愈。

`game.update` 侧另需一个"音符重置": 积压期间的音符不会 MISS(因为没跑 update)，回来时它们仍在场上但 `step` 已远超 → 会在下一帧集体 MISS。修法是把"当前不在窗口内且已超过 MISS 阈值的音符"静默清除而不计 miss。

**修改**
`src/game/music.js`:

```js
_tick() {
  if (!this.started) return;
  const now = this.ctx.currentTime;
  // 后台积压自愈: 落后超过容差就把时钟快进到现在, 丢弃中间 step(避免一次性把整段历史排到过去时刻)
  if (now - this._nextTime > 0.5) {
    this._nextStep = Math.floor((now - this._startCtxTime) * 4 * this.bpm / 60);
    this._nextTime = now;
    return;
  }
  while (this._nextTime < now + LOOKAHEAD) { ... }
}
```

`src/game/gameplay.js` `update()` 里，`p > 1 + MISS_STEPS/TRAVEL_STEPS` 的判定前加"落后保护"：若该音符 `step - n.targetStep` 已超过一个整小节(说明是后台积压而非真实漏砍)，直接 `notePool.release` + 从 notes 移除，**不计 miss、不断连击**。

**测试**
1. 新增 `e2e/background.mjs`：起游戏后 `page.evaluate(() => document.hidden)` 模拟不可行(需真实切页)，改用 `page.context().newPage()` 切焦点 + `page.bringToFront()`，或直接注入 `music._nextTime -= 20` 后跑一次 `_tick`，断言:
   - `Math.abs(music._nextTime - music.ctx.currentTime) < 0.5`
   - `music.ctx` 内已创建的 source 数量未激增(爆音的直接证据)
   - `game.misses` 未因积压增加
2. 手测(必须真机/真窗口)：开游戏 → 切到其他窗口 20s → 切回，确认无爆音、连击未清零、画面连续。
3. `node --check src/game/music.js src/game/gameplay.js`。

---

### 3. 音符系统性早于音乐 60ms ✅

**问题**
`src/game/music.js` 两个锚点不一致:

```
149: this._nextTime      = this.ctx.currentTime + 0.06;   // 音频调度锚点
150: this._startCtxTime  = this.ctx.currentTime;          // 判定时钟锚点
```

`currentStep` 由 `_startCtxTime` 推出，音符在 `currentStep === targetStep` 时到达判定面；但该 step 的音频在 `_nextTime + n*stepDur` 才播放。量化(BPM128):

```
step 0 : 音符到判定面 t=0.0ms   | 音频 t=60.0ms  | 差 60.0ms
step 1 : 音符到判定面 t=117.2ms | 音频 t=177.2ms | 差 60.0ms
step 8 : 音符到判定面 t=937.5ms | 音频 t=997.5ms | 差 60.0ms
=> 60ms = 0.51 step; PERFECT 窗口 ±2 step = ±234ms
```

合成模式与原曲模式都受影响(原曲 `src.start(this._nextTime)` 同样落在 `_nextTime` 上)。玩家按音乐拍点挥砍会系统性"晚"0.51 step，PERFECT 中心被整体拉偏。

历史: commit `0d31e7c` 声称修复 60ms 偏移，实际只改了 `music/synth.js`(编辑器侧)的 `src.start(0)` → `src.start(this._nextTime)`，**只是把偏移方向从"音频早"翻成"音频晚"**，两个锚点的问题原封不动，`src/game/music.js` 完全未动。

**方案**
统一锚点: 只有一个"起播时刻"，音频与判定时钟都从它推导。`+0.06` 的本意是给调度器一个起跑缓冲，应表达为"第一个 step 延迟 60ms 播放"，那就让 `_startCtxTime` 也等于该延迟后的时刻。

不改成 0 —— 立即起播在部分设备上有可闻的 click，保留 60ms 缓冲但让它对齐。

**修改**
`src/game/music.js`:

```js
this._startCtxTime = this.ctx.currentTime + 0.06;   // 唯一锚点
this._nextTime     = this._startCtxTime;
```

`seek()` 同理(240/242 行已是同一时刻推导，`_startCtxTime = startAt - sec`、`_nextTime = startAt`，此处一致，无需改)。

**测试**
1. 新增 `test/music-clock.mjs`(node，用 `AudioContext` 不可用 → 抽 `beatFromTime/stepFromTime` 做纯数学断言，或起 dev server 用 playwright 注入 `__beatriftDebug.getMusic()`)：断言 `music.stepFromTime(music._nextTime) === 0`(修复前为 `0.51`)。
2. 手测：砍固定拍谱面，对比"按箭头到面挥"与"按鼓点挥"的 PERFECT 比例，修复后应一致。
3. `e2e/e2e.mjs` 保持 11/11。

---

### 4. XSS：公共 MQTT broker → innerHTML

**问题**
`src/ui/mobile.js:36`:

```js
row.innerHTML = `<span>房间 <b>${code}</b></span><span class="dot on"></span>`;
```

`code` 来自 `@hana/link/src/discovery.js` 的 `subscribeRooms`:

```js
const code = t.split('/').pop();
handler(code, JSON.parse(payload.toString()));
```

`topic` 直接取自**公共 HiveMQ broker**(`wss://broker.hivemq.com:8884/mqtt`，免注册)，任何可达公网的客户端都能向 `beatrift/rooms/+` 发布。topic 字符串无任何字符白名单，`+`/`#` 之外的字符均可入 topic。`mobile.js` 把它原样拼进 `innerHTML` → 存储型 XSS(攻击者发布一次即可对所有订阅的手机端生效)。

同样代码: `ahrs/phone.js:50`、`test/phone.js:50`。
全仓无 CSP header、无 `Content-Security-Policy` meta(`index.html` 只有 charset/viewport/theme-color)。

注: `els.code.value = normalizeCode(params.get('room'))` 这条路径是安全的(URL 参数已清洗)，`dev.peerId` 未被渲染 —— 攻击面只有 topic 这一处。

**方案**
双层:
1. **根治**: 渲染层不用 `innerHTML` 拼外部数据，改 `createElement` + `textContent`。
2. **纵深**: 入口 `normalizeCode()` 过滤(与手输路径同一白名单，`ABCDEFGHJKMNPQRSTUVWXYZ23456789`)。同时给 `index.html` 加 CSP —— 但需先确认 PeerJS 云信令与 HiveMQ 的 host，否则会把游戏打挂，所以 CSP 作为独立任务，不阻塞第 1 步。

**修改**
`src/ui/mobile.js` `renderList()`:

```js
for (const [code, dev] of known) {
  const row = document.createElement('div');
  row.className = 'device-item';
  const label = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = normalizeCode(code) || code;   // 入口过滤 + textContent 兜底
  label.append('房间 ', b);
  const dot = document.createElement('span');
  dot.className = 'dot on';
  row.append(label, dot);
  row.addEventListener('click', () => doJoin(code));
  els.list.appendChild(row);
}
```

`ahrs/phone.js`、`test/phone.js` 同改。

CSP(独立提交): `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' wss://broker.hivemq.com https://*.peerjs.com wss://*.peerjs.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'">` —— `style-src 'unsafe-inline'` 因为项目大量内联样式与 `canvas` 生成样式；需手测 PeerJS 连接确认 host 通配是否正确。

**测试**
1. 新增 `e2e/xss.mjs`：用 playwright 起一个本地 MQTT 模拟不现实(走公共 broker)，改为**单元断言** `renderList` 的渲染产物 —— 更直接的做法是断言 `mobile.js` 源码中不再出现把 `code` 拼进 `innerHTML` 的模式，并加一条 `test/sanitize.mjs` 断言 `normalizeCode('<img src=x onerror=alert(1)>')` 返回空串。
2. 手测：手机正常发现房间、点击加入流程不变(功能回归)。
3. CSP 加完后 `e2e/e2e.mjs` 必须仍 11/11(否则说明 host 漏配)。

---

### 5. `Sensor.stop()` 漏摘 deviceorientation 监听器 ✅

**问题**
`node_modules/@hana/motion/src/sensor.js`:

```
62: this._motionHandler     = (e) => this._onMotion(e);
63: this._orientationHandler = (e) => this._onOrientation(e);
64: window.addEventListener('devicemotion', this._motionHandler);
65: window.addEventListener('deviceorientation', this._orientationHandler);
...
153: if (this._motionHandler) window.removeEventListener('devicemotion', this._motionHandler);
154: this._motionHandler = null;
// ❌ _orientationHandler 从未 removeEventListener, 也从未置 null
```

`stop()` 把 `enabled` 置 false 后，`_onOrientation` 仍在收事件，只是每次调用被 `if (!this.enabled) return` 之类的守卫(实际是 mobile.js 侧 `onFrame` 判 `streaming`)静默丢弃 —— 监听器永久驻留，事件仍在派发，CPU 持续消耗。

在 hash 路由 SPA 里，`mobile.js` cleanup → `sensor.stop()`，反复进出手机页会累积 N 组监听器。真机 `deviceorientation` 派发频率可达 60Hz，累积后是持续的空转开销。

**方案**
依赖包修正并打新 tag(`@hana/motion` v0.1.1)。这是最干净的修法 —— 监听器的生命周期必须归属创建者。

**修改**
`@hana/motion/src/sensor.js` `stop()`:

```js
stop() {
  if (this._motionHandler) {
    window.removeEventListener('devicemotion', this._motionHandler);
    this._motionHandler = null;
  }
  if (this._orientationHandler) {
    window.removeEventListener('deviceorientation', this._orientationHandler);
    this._orientationHandler = null;
  }
  this._stopSimulator();
  this.enabled = false;
  this._listeners = { frame: [], swing: [] };
}
```

beatrift 侧 `package.json` 改 `github:Hana-ame/hana-motion#v0.1.1`，`rm -f package-lock.json` 后重装(AGENTS.md 约定: stale lockfile 会卡住)。

**测试**
1. `e2e.mjs` 保持 11/11(监听器摘除不应影响正常流程)。
2. 新增断言: 进手机页 → 退出 → 用 `getEventListeners`(playwright `page.addInitScript` 注入计数器)统计 `deviceorientation` 监听器数，进出 3 次后应仍为 0。
3. 依赖包侧 `node --check`。

---

## P1 生命周期与资源泄漏

### 6. `pc.js` cleanup 的 removeEventListener 是空操作

**问题**
`src/ui/pc.js:143-145`:

```js
els.newcode.removeEventListener('click', () => {});                 // 新建匿名函数, 永不匹配
els.start.removeEventListener('click', onStart);                    // ✅ 正确
$('#pc-back').removeEventListener('click', () => navigate('/'));    // 新建闭包, 永不匹配
```

`removeEventListener` 按函数引用匹配，新建的匿名函数与原监听器不是同一引用 → **`newcode` 与 `pc-back` 的监听器每次路由切换都泄漏**。

后果链条：PC → Mobile → PC 三次后，`#newcode` 上有 3 个 handler，点一次「换一个」触发 3 次 `makeHost()` → 3 个并发 `createHost` → 3 个活的 PeerJS host + 3 次 `pcAnnounce` 心跳(旧 cleanup 已 `close()` 过 MQTT，但 signaling 侧是活的)。

**方案**
把 handler 提成命名函数存引用，与原代码 `onStart` 的写法保持一致。

**修改**
`src/ui/pc.js`:

```js
const onNewCode = () => {
  roomCode = genRoomCode();
  refreshCodeUI();
  makeHost();
};
const onBack = () => navigate('/');
els.newcode.addEventListener('click', onNewCode);
$('#pc-back').addEventListener('click', onBack);
// cleanup:
els.newcode.removeEventListener('click', onNewCode);
$('#pc-back').removeEventListener('click', onBack);
```

**测试**
1. 新增 `e2e/route-leak.mjs`：`#/pc → #/ → #/pc ×3`，断言 `document.querySelectorAll` 上 `#newcode` 的监听器数为 1(用 initScript 注入计数器)。
2. 更直接的回归断言：源码扫描 `grep -n "removeEventListener('click', ()" src/ui/pc.js` 应无匹配。
3. `e2e.mjs` 保持 11/11。

---

### 7. 重试 setTimeout 无句柄、cleanup 无法取消

**问题**
```
src/ui/pc.js:82     setTimeout(() => makeHost(attempt + 1), 800);
src/ui/mobile.js:139 setTimeout(() => doJoin(code, attempt + 1), 700);
src/ui/mobile.js:143 setTimeout(() => { showScreen('screen-mobile'); renderList(); }, 1200);
```

三处重试定时器都不存句柄，cleanup 无法 `clearTimeout`。离开页面后定时器仍触发：
- `makeHost` → `createHost` 建出无主 PeerJS host(`close()` 已跑过 MQTT，`announce` 里 `publish()` 因 `isConnected()===false` 静默返回，但 Peer 对象活着)。
- `doJoin` → `joinPeer` 建出无主连接 + `enterRemote()` 改 DOM(此时屏幕已切走)。

**方案**
存句柄 + cleanup 清理，并对回调加"会话有效性"守卫(双重防护：句柄清理防正常路径，守卫防竞态)。

**修改**
`src/ui/pc.js`:

```js
let retryTimer = null;
// makeHost 重试:
clearTimeout(retryTimer);
retryTimer = setTimeout(() => { retryTimer = null; makeHost(attempt + 1); }, 800);
// cleanup:
clearTimeout(retryTimer);
```

`mobile.js` 同理(注意 `mobile.js` 已有 `pingTimer`/`staleTimer` 的存引用范式，照抄即可)。

**测试**
1. `e2e.mjs` 保持 11/11。
2. 手测：信令失败时切走页面，用 PeerJS debug 面板/网络标签确认无残留 peer 连接。
3. 新增源码断言：所有 `setTimeout` 都有对应 `clearTimeout`(可用 `grep` 计数比对)。

---

### 8. `createHost` 无单客户端守卫，重连会中途重启整局

**问题**
`node_modules/@hana/link/src/connection.js:41-42`:

```js
peer.on('connection', (c) => {
  session.conn = c;          // 直接覆盖, 旧 conn 无 onClose 之外的清理
  setup(session, c, handlers);
});
```

`pc.js` 的 `onOpen` 每收到一个新连接就触发一次，其中直接调 `startGame({ ... calibrate: true })` → **中途重启整局**(旧局的 rAF/定时器/物理世界/音符池被 `cleanup()` 拆掉)。且旧连接的 `onData → handleMotion` 仍在，会继续喂剑输入。

触发场景：手机断网重连、两台手机扫同一码、PeerJS 网络抖动导致多次 `connection` 事件。

**方案**
依赖包加"首个连接优先"策略 + beatrift 侧在 `onOpen` 里区分首连与重连。

**修改**
`@hana/link/src/connection.js`:

```js
peer.on('connection', (c) => {
  if (session.conn && session.conn.open) {
    // 已有活跃客户端: 拒绝新连接, 避免中途重启游戏
    try { c.close(); } catch { /* noop */ }
    return;
  }
  session.conn = c;
  setup(session, c, handlers);
});
```

`pc.js` `onOpen`:

```js
onOpen() {
  if (connected) return;      // 重连由 onClose 已展示状态, 不重启整局
  connected = true;
  ...
  startGame({ host, roomCode, diff, song, calibrate: true });
}
```

**测试**
1. 新增 `e2e/double-join.mjs`：两台 mobile context 连同一房间码，断言 PC 端只进入一次校准界面(`#calib-overlay` visible 次数)、第二台的连接被关闭。
2. `e2e.mjs` 保持 11/11。
3. 依赖包打 v0.1.1(与 #5 同 tag)。

---

### 9. `OrbitControls` 永不 dispose，且专为一个禁用对象存在

**问题**
`src/game/scene.js`:

```
 4: import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
33: const debugControls = new OrbitControls(debugCamera, renderer.domElement);
36: debugControls.enabled = false;
82: dispose() {
83:   window.removeEventListener('resize', onResize);
84:   renderer.dispose();
   }
```

`OrbitControls` 构造时即向 `renderer.domElement` 挂 pointerdown/mousemove/wheel 等监听，`dispose()` 里**从未** `debugControls.dispose()`。`renderer.dispose()` 只释放 GL 状态，不摘 DOM 监听。每次 `startGame` 多挂一组。

`enabled=false` 只是让 handler 内部早退，监听仍在。注释已自认"历史遗留, 全景按钮已删, 保持不可用状态" —— 那这个对象与 18kB 的 `OrbitControls` chunk(仅 game 入口用到，editor 另有自己的)就该一起删。

**方案**
两条路：
- **A(推荐)**: 彻底删除 `debugCamera`/`debugControls`/`OrbitControls` import —— 全景功能已删，留着只是负担。
- **B(保守)**: 保留对象，`dispose()` 里补 `debugControls.dispose()`。

选 A：注释明说"保持不可用状态"，无调用方，删除零风险且省 18kB chunk 依赖。

**修改**
`src/game/scene.js` 删除 4 行 import、`debugCamera`/`debugControls` 四个相关行、返回对象里的 `debugCamera`/`debugControls` 两个键、`onResize` 里的 `debugCamera.aspect`/`updateProjectionMatrix` 两行。

**测试**
1. `npm run build` 成功，确认 `dist/assets` 里 game 入口不再含 `OrbitControls-*.js`(editor 入口仍应有)。
2. `e2e.mjs` 保持 11/11。
3. 手测：进游戏、重开一局、退房间 → 游戏画面/相机跟随正常。

---

### 10. 场景几何/材质/纹理从不逐对象释放

**问题**
`scene.dispose()` 只有 `renderer.dispose()`。而 `renderer.dispose()` 不遍历场景对象 —— 音符池模板、箭头模板、圆点模板、剑身/辉光/点光、星空 Points、`noteScreen` 的 `CanvasTexture` 全没 `dispose()`。

每次 `startGame` 新建整套场景，`cleanup()` 后 GPU 侧残留，直到 GL 上下文重建。重开 10 局 = 10 份几何驻留。

对比 `editor/view3d.js` 的 dispose 链(做得很规范): `boxGeo/edgeGeo/selGeo/selMat/moveGeo/moveMat` + 每个 entry 的 `box.material`/`edge.material`/`disposeSprite` + `gridGroup` + `controls.dispose()` + `renderer.dispose()` 全部覆盖。game 侧应对齐这个标准。

**方案**
在 `createGameScene` 里收集所有"本函数创建的"几何/材质/纹理到 `assets[]` 数组，`dispose()` 统一遍历释放。这是最小改动且不易漏的模式(比逐个手写 dispose 可靠)。

**修改**
`src/game/scene.js`:

```js
const assets = [];   // 本场景创建的几何/材质/纹理, dispose 时统一释放
const track = (o) => { assets.push(o); return o; };

// 创建处:
const geo = track(new THREE.BoxGeometry(1.8, 1.8, 1.8));
const mat = track(new THREE.MeshBasicMaterial({ ... }));
const tex = track(new THREE.CanvasTexture(cv));
// 音符池内的模板: 由 createNotePool 自行 track 并返回 { ..., assets } 供上层合并
// ...
dispose() {
  window.removeEventListener('resize', onResize);
  for (const a of assets) a.dispose?.();
  assets.length = 0;
  renderer.dispose();
},
```

**测试**
1. 手测：进游戏 → 退出 → 重开 ×5，确认画面正常(无丢失纹理/黑块)。
2. Chrome DevTools → Memory → WebGL Inspector，对比重开前后 GPU buffer 数量应持平(修复前单调增长)。
3. `e2e.mjs` 保持 11/11 + 新增"重开 3 局后无 pageerror"断言。

---

### 11. `ShardPhysics.splitNote` 每次命中重建几何与材质

**问题**
`src/game/physics.js:34-35`:

```js
const geo = new THREE.BoxGeometry(1, 1, 1);          // 每次命中重建
const mat = new THREE.MeshStandardMaterial({ ... });  // 每次命中重建
```

`SHARD_COUNT=2`，每个命中 2 次分配。`update()` 里有 `geometry.dispose()`/`material.dispose()`(95-96 行)，**所以没有 GPU 泄漏**，但 CPU/GC 抖动实打实 —— 这恰是 `notePool` 注释里明确说要避免的反模式("预建几何/材质模板...避免每音 new 几何导致 GC 卡顿")。

附带: `dispose(scene)`(104-108 行)只 `removeBody`，不释放 geo/mat，与 `fx.js dispose()`(176-181 行)会释放的行为不一致。

**方案**
几何 `BoxGeometry(1,1,1)` 每块完全相同 → 模块级共享一个。材质因要 per-shard 颜色，用模板 `clone()`(clone 共享几何，不重新分配 GL 缓冲)。

**修改**
`src/game/physics.js`:

```js
// 模块级共享: 所有碎块同几何, 非均匀缩放区分, 无需 per-shard 几何
const SHARD_GEO = new THREE.BoxGeometry(1, 1, 1);
const SHARD_MAT_TEMPLATE = new THREE.MeshStandardMaterial({
  metalness: 0.4, roughness: 0.3, transparent: true,
});

splitNote(...) {
  ...
  const mat = SHARD_MAT_TEMPLATE.clone();   // 只拷属性, 不重建 GL 缓冲
  mat.color.setHex(color);
  mat.emissive.setHex(color);
  mat.emissiveIntensity = 0.5;
  const mesh = new THREE.Mesh(SHARD_GEO, mat);
  ...
  // update 里只 dispose 材质(几何共享, 不能释放)
  s.mesh.material.dispose();
}

dispose(scene) {
  for (const s of this._shards) {
    scene.remove(s.mesh);
    s.mesh.material.dispose();   // 与 fx.js 对齐
    this.world.removeBody(s.body);
  }
  this._shards = [];
}
```

**测试**
1. 手测：连续砍 30 音，观察 frame time(DevTools Performance)无分配尖峰。
2. `e2e.mjs` 保持 11/11(注入命中会触发 splitNote)。
3. 新增断言：命中 10 次后 `renderer.info.memory.geometries` 未增长(修复前每次命中 +2)。

---

### 12. `Fx` 粒子池无上限保护，高密度下粒子被丢弃

**问题**
`src/game/fx.js`:

```
 6: const LIFETIME = 1.1;
21: const count = 400;                              // buffer 固定 400 顶点
54: burst(pos, color, count = 26, dir = null)       // count 无上限
144: this._points.geometry.setDrawRange(0, n);      // n 无钳制
```

`_bursts` 无上限，`setDrawRange(0, n)` 的 `n` 可超 400 → 超出部分**算了但画不出来**(WebGL draw range 越界被驱动钳到 buffer 末尾)。

容量核算：PERFECT 34 粒/次、寿命 1.1s → 稳态上限 400/1.1 ≈ **363 粒/秒**。BPM150 十六分音符 = 10 音/秒 × 34 = 340 粒/秒 —— **已在上限边缘**；双音同拍一次 680 粒/秒 → 必然溢出。

**方案**
钳制 `n` 到 buffer 容量，并让超量时**丢弃最老的粒子**(视觉上最合理：近的优先)。同时把容量上限提到实际需要的量(密集谱面 700+ 粒)。

**修改**
`src/game/fx.js`:

```js
const PARTICLE_CAP = 800;   // 按密集谱面实测需求设, 留余量
// geo 用 PARTICLE_CAP

update(dt) {
  ...
  let n = 0;
  ...
  this._points.geometry.setDrawRange(0, Math.min(n, PARTICLE_CAP));
  ...
}

burst(pos, color, count = 26, dir = null) {
  // 容量保护: 超量时从最老(索引 0)开始踢, 保证新粒子可见
  const room = PARTICLE_CAP - this._bursts.length;
  if (room <= 0) return;
  if (count > room) {
    for (const old of this._bursts.splice(0, count - room)) this._free.push(old);
  }
  ...
}
```

**测试**
1. 新增 `test/fx-cap.mjs`(纯逻辑，抽 `_bursts` 行为)：连续 `burst` 30 次 × 34 粒，断言 `_bursts.length <= 800` 且 `setDrawRange` 的 count ≤ 800。
2. 手测：BPM150 song2 连续 PERFECT 段，确认粒子始终可见、无突然消失。
3. `e2e.mjs` 保持 11/11。

---

### 13. 相机震动反馈已死(空函数 + 残留调用)

**问题**
`src/game/fx.js:81-83`:

```js
addShake(amount) {
  // TODO(视角): 暂关镜头晃动, 待光剑方向稳定后再启用
  // this.shake = Math.min(1.6, this.shake + amount);
}
```

函数体被注释掉 → 空函数。但 `fx.update`(111-121 行)的 shake 分支还在跑(读一个永远为 0 的 `this.shake`)，`gameplay.js` 还有 2 处调用:

```
gameplay.js:422  this.fx.addShake(grade === 'perfect' ? 0.3 : 0.18);
gameplay.js:465  this.fx.addShake(0.8);
```

结果：命中/失误的镜头反馈全部失效。注释说"待光剑方向稳定后再启用" —— 臂刚体模型(2026-08-09)与总体速度判定(2026-08-13)都已落地，前置条件应已满足。

**方案**
二选一，不留死代码：
- **A(推荐)**: 恢复 `addShake` 主体。镜头晃动是节奏游戏的核心打击感，且 `update` 里衰减/插值逻辑已写好。
- **B**: 彻底删 —— 删 `addShake`、`this.shake`、`shakeDecay`、`update` 的 shake 分支、gameplay 两处调用。

选 A，但把幅度设小(0.1~0.25)：`followView` 的相机跟随本身较明显，shake 太大会和跟随打架。

**修改**
`src/game/fx.js`:

```js
addShake(amount) {
  // 镜头晃动: 命中/失误的打击感。幅度上限 0.6(远低于旧注释的 1.6),
  // 因 followView 相机跟随已提供明显视差, shake 过大两者会打架。
  this.shake = Math.min(0.6, this.shake + amount * 0.4);
}
```

`gameplay.js` 两处调用幅度同步下调(perfect 0.15 / good 0.09 / miss 0.35)。

**测试**
1. 手测(必须人眼)：砍命中与漏击，确认有轻微晃动且不晕眩。
2. 断言：源码不再有空函数 `addShake`。
3. `e2e.mjs` 保持 11/11。

---

## P2 健壮性

### 14. `e2e/move.mjs` 已损坏 ✅

**问题**
实际执行:

```
$ E2E_BASE=http://localhost:5174/ node e2e/move.mjs
exit=1
page.waitForSelector: Timeout 20000ms exceeded. — waiting for locator('#calib-do')
```

`#calib-do` / `#calib2-step` / `#calib2-do` 在当前 `index.html` 中计数为 **0**(现校准 UI 只有 `#calib-overlay` + `#calib-setfront`/`#calib-fx`/`#calib-fy`/`#calib-fz`/`#calib-start`)。

该脚本另有两处硬伤：**零 `ok()` 断言**、**不设置退出码**(只 `console.log` dirsChanged/first/last/unique dirs)。即便跑通也向 CI 传递不了任何信号。

**方案**
校准 UI 已改为单浮层，旧的"两步校准"(calib-do → calib2)流程不存在了。要么按现 UI 重写，要么删。

它原本想验证的是"校准后光剑方向随手机移动而变化" —— 这个能力值得留，但要用现 API。

**修改**
重写 `e2e/move.mjs` 为带断言的脚本:

```js
import { chromium } from 'playwright';
const BASE = process.env.E2E_BASE || 'http://localhost:5173/';
const results = [];
const ok = (label, cond, detail = '') => {
  results.push(cond);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};
// ... 走 #calib-overlay 现流程, 断言:
ok('校准浮层出现', /* #calib-overlay visible */);
ok('光剑方向随模拟器变化', uniqueDirs > 1, `unique=${uniqueDirs}`);
ok('剑尖贴近音符平面', Math.abs(tip[1] - (-4.4)) < 3);
process.exit(results.every(Boolean) ? 0 : 1);
```

**测试**
1. `E2E_BASE=http://localhost:5173/ timeout 160 node e2e/move.mjs` 退出码 0 且全 PASS。
2. 断言脚本本身：`grep -c "ok(" e2e/move.mjs` ≥ 3，且含 `process.exit`。

---

### 15. MIDI 解析器 spread 参数上限 ✅

**问题**
实测 V8 展开参数上限:

```
Math.max spread      65536 OK | 100000 OK | 200000 RangeError
String.fromCharCode  65536 OK | 100000 OK | 200000 RangeError
```

两处踩线:
```
midi-player.js:62   String.fromCharCode(...data)          // meta 0x03/0x51/0x58 文本
midi-player.js:258  Math.max(...notes.map(n => n.time + n.dur))
```

`Math.max(...)` 在音符数超 ~15 万时抛 RangeError；`String.fromCharCode(...data)` 在 meta 文本超 ~15 万字节时抛。两者都被 `loadFile` 的 `catch` 吞掉，只打 `console.warn('[midi] 解析失败')` 返回 false → **大 MIDI 文件静默加载失败，用户只看到"解析失败"无细节**。

**方案**
改用 `reduce` 消除展开。同时把 `catch` 的告警带上错误类型，便于用户区分"文件损坏"与"文件太大"。

**修改**
`music/midi-player.js`:

```js
// 258 行:
this._durSec = events.length
  ? tickToSec(notes.reduce((mx, n) => Math.max(mx, n.time + n.dur), 0)) + 1
  : 1;

// 62 行:
const text = (meta === 0x03 || meta === 0x51 || meta === 0x58)
  ? Array.from(data, (b) => String.fromCharCode(b)).join('')
  : null;
```

```js
} catch (e) {
  console.warn('[midi] 解析失败:', e.name === 'RangeError' ? '文件过大(音符/元数据超展开上限)' : e.message);
  return false;
}
```

**测试**
1. 新增 `test/midi-limit.mjs`：构造 20 万音符的 .mid(手工拼二进制，无需真实文件)，断言 `parseMidiSong` 不抛 RangeError。
2. 构造 meta 0x03 文本 20 万字节的 .mid，断言解析通过。
3. 回归：用 3 个正常 .mid(简单 format0 / 多轨 running status / 扩展 header)断言音符数与预期一致。

---

### 16. MIDI 功能缺口

**问题**
解析器忽略了:
- **pitch bend(0xE0)** —— 解析器根本没读这个 type(0xE 不在处理分支里)
- **aftertouch / channel pressure(0xA0/0xD0)**
- **MIDI Channel Mode Messages(CC 120-127: All Sounds Off / Reset All Controllers / All Notes Off / Active Sensing / Reset All)** —— 0xB 只被用来标记鼓通道，具体 CC 号被丢弃

后果：带 pitch bend 的演奏走音；含 Reset All Controllers 的文件无法静音持续音。

另 `drumsCh` 是死复杂度:

```
122/126/130: if (ev.ch === 9) drumsCh.add(9);   // 只可能 add 9
251:         const isDrum = n.ch === 9 || drumsCh.has(n.ch);   // 恒等于 n.ch === 9
```

**方案**
pitch bend 与 Channel Mode 是真需求(常见于演奏型 MIDI)，值得做。aftertouch/pressure 对当前音色集收益低，暂不做但要在文档标注已知限制。

**修改**
pitch bend: 事件流里保留 `{ t, type: 'bend', ch, val }`，`_buildEvents` 时按通道做线性插值，在 `_playEvent` 里 `freq *= 2 ** (bend / 8192 * 2)`(±2 半音，GM 标准)。

Channel Mode: 0xB 且 `d1 >= 120` 时：
- `120/123`(All Sounds Off / All Notes Off) → 关闭该通道所有 open note 并置 0 时长
- `121`(Reset All Controllers) → 清空该通道 bend/poly pressure 状态
- `126`(Active Sensing) → 忽略

```js
if (ev.type === 0xb) {
  if (ev.d1 >= 120) this._handleChannelMode(ev);
  if (ev.ch === 9) drumsCh.add(9);
  continue;
}
```

`drumsCh` 简化为直接判 `n.ch === 9`，删掉 Set。

**测试**
1. 构造含 pitch bend 的 .mid，断言导出频率序列有 ±2 半音偏移。
2. 构造含 CC 120 的 .mid，断言 note-off 生效(音符时长截断)。
3. `node music/check-songs.mjs` 仍 0 error(确认未影响合成曲库)。

---

### 17. 编辑器无撤销/重做 + 无卸载保存

**问题**
```
$ grep -rn "undo" editor/        → 无匹配
$ grep -rn "beforeunload" .      → 无匹配(全仓)
$ grep -rn "visibilitychange" .  → 无匹配(全仓)
```

删除(`delSel`)、批量生成(`openGenerate`)、镜像(`flipSel`)、拖拽、右键 beat± 全部**不可逆**。唯一恢复手段是刷新吃 localStorage 草稿 —— 而草稿 `save()` 是 400ms 防抖:

```js
markDirty() {
  ...
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
```

改完 400ms 内关 tab/刷新/崩溃 → 草稿丢失。对谱面编辑器来说这是高频风险(生成错一批 → 只能重载)。

**方案**
**撤销栈**：`state.notes` 是唯一被批量改的数据结构，压栈快照即可。用 `JSON.parse(JSON.stringify())` 深拷贝(音符是纯数据，无引用环，量小 ≤ 数百)，简单可靠。深度上限 50 防内存膨胀。

**卸载保存**：`pagehide`(比 `beforeunload` 更可靠，覆盖 bfcache 与移动端返回)+ `visibilitychange` 到 hidden 时立即 flush。

**修改**
`editor/main.js`:

```js
const UNDO_CAP = 50;
let undoStack = [];
let redoStack = [];
// 在任何批量改动前调用
function snapshot() {
  undoStack.push(JSON.stringify(state.notes));
  if (undoStack.length > UNDO_CAP) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(undoStack.pop());
  clearSel();
  markDirty();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(redoStack.pop());
  clearSel();
  markDirty();
}
// 在 delSel / dupeSel / flipSel / openGenerate 的 #g-ok / 拖拽结束 前调 snapshot()
// Ctrl+Z / Ctrl+Shift+Z 绑定
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
});
```

```js
function flushSave() {
  clearTimeout(saveTimer);
  save();
}
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
});
```

**测试**
1. 新增 `e2e/editor-undo.mjs`：生成 16 音 → Ctrl+Z → 断言 `#note-count` 归 0 → Ctrl+Shift+Z → 断言恢复 16。
2. 新增 `e2e/editor-draft.mjs`：改一音 → 立即 `page.close()` → 重开 `/editor/` → 断言改动仍在。
3. `node --check editor/main.js`。

---

### 18. 死工作流 `.github/workflows/deploy.yml`

**问题**
`on:` 触发器整段被注释:

```yaml
# GitHub Pages 对私有仓库+免费套餐不可用，暂时禁用，避免 push 触发报错。
# on:
#   push:
#     branches: [main]
#   workflow_dispatch:
```

三层问题叠加:
1. 无 `on:` → 永不触发，文件是纯死代码。
2. 若重启用，`npm ci` 会因私有 `@hana/link` `@hana/motion` 缺 `GITHUB_TOKEN` 而 404(AGENTS.md 已记录)。
3. 文件内自认 GitHub Pages 对私有仓库免费套餐不可用 —— 即使配好 token 也部署不上去。

本仓约定**不 push**(AGENTS.md)，部署走 5173 dev server，所以这个工作流已无存在意义。

**方案**
删除文件。理由：三层阻塞都无解(Pages 免费套餐不支持私有仓库)，留着只会在有人重启用时浪费排障时间，且与"不 push"约定冲突。

**修改**
`git rm .github/workflows/deploy.yml`，同时删空 `.github/workflows/` 与 `.github/`(若已空)。
AGENTS.md 部署章节补一句"deploy.yml 已删(2026-08-29)，恢复部署需自建 CI + Pages 付费套餐"。

**测试**
1. `ls .github` 不存在。
2. `npm run build` 不受影响(工作流不参与构建)。
3. `git log --oneline -- .github/` 确认历史可追溯。

---

### 19. `test/attitude.js` 是 `lib/attitude.js` 的数学逐字副本

**问题**
```
$ diff <(去空白 lib/attitude.js) <(去空白 test/attitude.js)
→ 仅文件头注释不同, 数学实现逐字一致
lib/attitude.js   325 行 / 11313 B   ← 真共享库
test/attitude.js  314 行 / 10758 B   ← 副本
ahrs/attitude.js  311 行 / 10624 B   ← 有意不同(见下)
```

`lib/attitude.js` 被 `src/game/index.js`、`pad/main.js`、`pad/position.js`、`gamepad/main.js`、`sword/pc.js` 引用 —— 是真共享库。
`test/attitude.js` 只被 `test/sensor.js`、`test/pc.js`、`test/verify-attitude.mjs` 引用 —— 纯副本。

**⚠️ 重要区分**：`ahrs/attitude.js` **不是**副本 —— 它 `import AHRS from 'ahrs'`，是 npm 包的**对照验证实现**(配 `ahrs/verify-attitude.mjs` 做数学对照)，必须保留。同理 `test/` **不能删**：`test/sensor.js` 的 `TestSensor` 被 `pad/`、`gamepad/` 引用，`test/net.js` 被 `sword/pc.js` 引用。

**方案**
让 test/ 内三个文件改为从 `lib/attitude.js` 引入，删除 `test/attitude.js`。一套数学、一处维护。

**修改**
```diff
- import { quatFromDeviceEuler, upInDevice, DEG } from './attitude.js';
+ import { quatFromDeviceEuler, upInDevice, DEG } from '../lib/attitude.js';
```
改 `test/sensor.js`、`test/pc.js`、`test/verify-attitude.mjs` 三处，然后 `rm test/attitude.js`。

**测试**
1. `node test/verify-attitude.mjs` 全绿(这是最直接的回归)。
2. `npm run build` 成功(确认 8 个入口都能解析)。
3. `grep -rn "from './attitude.js'" test/` 无匹配。
4. dist 里 `attitude-*.js` chunk 数应从 3 降到 2(game+test 合并，ahrs 独立保留)。

---

### 20. `Music.setMuted` 无 null 检查

**问题**
`src/game/music.js:208-210`:

```js
setMuted(m) {
  this.muted = m;
  if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
}
```

`this.master` 与 `this.ctx` 在 `start()`/`loadSong()` 里才创建。若 start 前调 `setMuted` → `this.ctx` 为 null → `TypeError: Cannot read properties of null`。

**方案**
加空值守卫，静默记下状态(下次 start 时按 `this.muted` 初始化 master gain，现有代码 `this.master.gain.value = this.muted ? 0 : 0.9` 已支持)。

**修改**
```js
setMuted(m) {
  this.muted = m;
  if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
}
```

**测试**
1. 新增断言：`new Music().setMuted(true)` 不抛错，且 `start()` 后 master gain 为 0。
2. `e2e.mjs` 保持 11/11。

---

## 性能

### 21. 主循环热路径分配与遍历

**问题**
每帧(60fps)的 `Vector3` 分配点:

| 位置 | 每帧分配 |
|---|---|
| `scene.getSword()` 内部(new + 2 clone) | 3 次 × **每帧被调 3 次**(`_updateSword`×2、`followView`×1) |
| `gameplay._updateSword` | 2×new + `tip.clone()` |
| `gameplay._collideNotes` | 3 次 |
| `_pendingContact` → `_swordPose()` | 3 次 × **每个 pending 音符** |
| `index.js followView` | ~4 次 |

繁忙帧约 16-20 个 `Vector3` ≈ **1000 次/秒**。

另:
- `_swingHist` / `swingWin` / `trail.pts` 用 `Array.shift()`(O(n) 头删)，`_swingHist` 在 60Hz 网络帧上持续 push+shift。
- `_hit`/`_miss` 里 `splice(indexOf(n), 1)` 两次 O(n) 扫描。
- 每帧 2-3 次全量遍历音符(推进 + collide + pending 复查)。
- 独立 `setInterval`：`vizTimer` 60ms、`dirTimer` 1s、music 20ms、ping 1s、stale 2s。

**方案**
按收益排序:
1. **`getSword()` 改输出参数** —— 收益最大(消除 6 次/帧 + 重复计算)，且是 #1 修复后仍存在的重复。
2. **模块级临时对象** —— 消除剩余分配。
3. **罗盘绘制并入 rAF** —— 少一条独立定时器，且与画面同帧。
4. `shift()` 改环形缓冲 —— 收益小(TRAIL_LEN=14、hist ≤ 3)，但代码更干净。
5. 遍历合并 —— notes ≤ 30，收益可忽略，**不做**(可读性优先)。

**修改**
```js
// scene.js: getSword 写回传入对象, 每帧只算一次
const _swordOut = { pivot: new THREE.Vector3(), tip: new THREE.Vector3(), dir: new THREE.Vector3() };
getSword(out = _swordOut) {
  out.dir.set(0, 1, 0).applyQuaternion(sword.group.quaternion);
  out.pivot.copy(SWORD_PIVOT).addScaledVector(out.dir, ARM_LEN);
  out.tip.copy(out.pivot).addScaledVector(out.dir, SWORD_LEN);
  return out;
}
```

```js
// gameplay.js / index.js: 模块级临时对象
const _v = new THREE.Vector3();
_updateSword(dt) {
  const { pivot, tip } = this.scene.getSword();   // 复用, 零分配
  s.group.quaternion.setFromUnitVectors(UP, _v.set(this.swordDir.x, this.swordDir.y, this.swordDir.z));
  s.group.position.copy(pivot);
  trail.pts.push(_v.copy(tip).clone());   // 仅此一处必须 clone(入历史)
  ...
}
```

```js
// index.js: 罗盘并入主循环
let vizAcc = 0;
const loop = () => {
  ...
  vizAcc += dt;
  if (vizAcc >= 1 / 16) { vizAcc = 0; drawDirViz(dirViz, ctx.game); }
  ...
};
// 删掉 vizTimer setInterval
```

**测试**
1. Chrome DevTools Performance 录制 10s 游戏，对比 `Memory` 面板的 JS heap 增长斜率(修复前应持续上升，修复后应平稳)。
2. `window.performance.memory`(Chrome)前后对比。
3. `e2e.mjs` 保持 11/11(逻辑等价)。
4. 新增断言：`getSword()` 调用后 `renderer.info` 无变化，且返回对象为同一引用。

---

### 22. 入口下载体积

**问题**
实测各入口完整闭包(raw / gzip):

| 入口 | raw | gzip | chunks |
|---|---|---|---|
| 主游戏 | 1227kB | **339kB** | 15 |
| test | 1015kB | 274kB | 14 |
| ahrs | 1020kB | 276kB | 12 |
| sword | 1024kB | 276kB | 12 |
| editor | 574kB | 147kB | 6 |
| pad | 557kB | 142kB | 8 |
| music | 131kB | 26kB | 2 |
| gamepad | 37kB | 15kB | 6 |

主页 339kB gzip 里: three 125kB + net(peerjs+mqtt) 126kB + physics(cannon-es) 22kB + pc 33kB + 其余。

`music/` 页 26kB gzip 已很健康(99 首曲库压进 131kB raw)。

**方案**
- **cannon-es 懒加载**(收益 22kB gz ≈ 6.5%，明确): 只在命中碎块时用，`physics.splitNote` 首次调用时 `await import()`。
- **net 延后**(收益 126kB gz，但要看 UX): `pc.js` 顶部静态 import，进 PC 屏幕即加载；可改到点「新建房间」时再拉。代价是建房多一次加载延迟，且 PC 屏幕的主要动作就是建房 → **收益不确定，建议先不做**。
- **调试页取舍**: test/ahrs/sword 各 ~1MB raw。这三个页面只服务开发，不上线的话砍 3 个 build inputs，dist 直接少 ~3MB raw。但 `test/` 的 `TestSensor` 被 pad/gamepad 引用、`test/net.js` 被 sword 引用 —— 砍 inputs 不影响这些页面(它们只是不被单独打包)，需注意 `vite.config.js` 的混淆排除名单同步。

**修改**
```js
// src/game/index.js
let physics = null;
async function ensurePhysics() {
  if (!physics) ({ ShardPhysics } = await import('./physics.js'));
  return new ShardPhysics();
}
// startGame 内: const physics = await ensurePhysics();
```

```js
// vite.config.js(若砍调试入口)
input: {
  main, music, editor,
  // test / ahrs / sword 已移除: 仅开发用, 不影响 pad/gamepad(它们引用 test/ 的模块但独立打包)
},
```

**测试**
1. `npm run build` 成功；用 `node` 脚本遍历 `dist/*/index.html` 的闭包重算体积(见下方测量方法)，断言主页 gzip < 320kB。
2. `e2e.mjs` 保持 11/11 + 注入命中(首次命中触发 `import()`，需确认无异常)。
3. 手测：冷加载主页，DevTools Network 对比总传输量。

测量方法(已验证可用):
```bash
node -e "
const fs=require('fs'), zlib=require('zlib');
const all=fs.readdirSync('dist/assets');
const js=all.filter(x=>x.endsWith('.js'));
function walk(name, seen){ seen=seen||new Set(); if(seen.has(name)) return {n:0,raw:0,gz:0}; seen.add(name);
  const p='dist/assets/'+name; const b=fs.readFileSync(p);
  let raw=b.length, gz=zlib.gzipSync(b).length, n=1;
  const re=/\.\/([A-Za-z0-9_.-]+\.js)/g; let m;
  while((m=re.exec(b.toString()))) { if(js.includes(m[1])){const r=walk(m[1],seen); raw+=r.raw; gz+=r.gz; n+=r.n;} }
  return {n,raw,gz};
}
for (const d of ['','test','ahrs','sword','pad','gamepad','music','editor']) {
  const h='dist'+(d?'/'+d:'')+'/index.html'; if(!fs.existsSync(h)) continue;
  const m=fs.readFileSync(h,'utf8').match(/src=\"\/assets\/([^\"]+)\"/); if(!m) continue;
  const r=walk(m[1]);
  console.log((d||'main').padEnd(8), (r.raw/1024|0)+'kB raw', (r.gz/1024|0)+'kB gz');
}"
```

---

## 内容与测试覆盖

### 23. 外链谱面路径零覆盖 + 测试未接线

**问题**
4 张谱面全量校验通过(见下)，但 `song.url` 字段使用数 = **0** → `music.loadSong()` 的 CORS fetch / decodeAudioData / 失败回退 合成 这条路径在生产内容中**零覆盖**。

测试侧:
- `package.json` **无单元测试 runner**。
- 实际可用的只有 `node test/verify-attitude.mjs` 与 `node ahrs/verify-attitude.mjs`(两者均全绿)，且**只在 `ahrs/README.md` 里被提及**，无 `scripts` 条目、无 CI 接线。
- e2e 三脚本: `e2e.mjs` 11/11 通过(happy path)、`ahrs.mjs` 未接线、`move.mjs` 已坏(#14)。

零覆盖项：双音 splice、后台爆音、60ms 偏移、MIDI 解析器、编辑器导出往返、WRONG/pending 路径、难度回退、图表规范、MQTT 注入。

**谱面校验结果**(按 AGENTS.md 的 BSMG 规范写脚本跑):

| 谱面 | 音符 | 脱网格 | 双音非重拍 | 双音 dir 不同 | 排列↔方向不匹配 | move 时序违规 | 8拍无留白 |
|---|---|---|---|---|---|---|---|
| default | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| song1 | 40 | 0 | 0 | 0 | 0 | 0 | 0 |
| song2 | 44 | 0 | 0 | 0 | 0 | 0 | 0 |
| song3 | 32 | 0 | 0 | 0 | 0 | 0 | 0 |

`song.bpm`/`synth` 与选歌菜单 4/4 一致；move 使用量 3/9/4/2 且时序全合法。
`music/check-songs.mjs`: 99 首 0 error，**40 条「鼓仅 1 小节 pattern 整曲循环单调」告警**(内容质量，非 bug)。

**方案**
1. 把散落的校验脚本收拢为 `scripts/` + `package.json` scripts，让"跑测试"有唯一入口。
2. 补一条外链谱面的 e2e(用本地起一个带 CORS 的静态服务供 `song.url` 指向)，覆盖 loadSong 路径。
3. 把 4 张谱面的规范校验脚本固化(AGENTS.md 已记录 `gen-charts.mjs` 丢失，规范校验脚本应补上以替代其部分价值)。

**修改**
`package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "node scripts/check-all.mjs",
    "check:attitude": "node test/verify-attitude.mjs && node ahrs/verify-attitude.mjs",
    "check:songs": "node music/check-songs.mjs",
    "check:charts": "node scripts/check-charts.mjs",
    "test:e2e": "node e2e/e2e.mjs",
    "test:e2e:all": "node e2e/e2e.mjs && node e2e/ahrs.mjs && node e2e/move.mjs"
  }
}
```

`scripts/check-charts.mjs`：把本次审计用的谱面规范校验脚本固化(网格对齐、双音重拍、dir 一致性、move 时序、8 拍留白、BPM 与菜单一致)。

外链覆盖: 新增 `public/songs/sample.mp3`(或用本地 `vite preview` 起 4173 端口，谱面 `url` 指向 `http://localhost:4173/songs/sample.mp3`)，新增 `e2e/song-url.mjs` 断言 `loadSong` 返回 true 且 `_songSource` 非空。

**测试**
1. `npm run check` 全绿。
2. `npm run test:e2e:all` 全绿(需先 `npm run dev`)。
3. `node scripts/check-charts.mjs` 对 4 张谱面输出 0 violation。

---

## 已验证健康的部分(无需改动)

- 音符 mesh 池化: 模板复用 + 箭头/圆点切显隐，不重建几何(`scene.js` `createNotePool`)
- `editor/view3d.js` 的完整 dispose 链: `boxGeo/edgeGeo/selGeo/selMat/moveGeo/moveMat` + 每 entry 材质 + `disposeSprite` + `gridGroup` + `controls.dispose()` + `renderer.dispose()`
- `main.js` 路由级动态 import: 首屏入口仅 8kB，不拉 three/peerjs
- `manualChunks`: three / physics / net 跨入口共享
- `Music.dispose()`: 关闭 AudioContext，避开浏览器 6 个上限
- dt 钳 50ms 防切后台跳变；rAF id 写回 `ctx.raf` 防双局并发
- `normalizeMove`: 有限性校验 + 钳制，避免半条 move 数据进入导出
- `_missLater` 的二次结算防护(注释已说明 indexOf=-1 → splice(-1) 误删末尾的隐患)
- MIDI 解析器**无无限循环**: 每轮 `o.p` 严格 +2，malformed 文件快速抛错而非卡死
- 4 张谱面 100% 符合自定 BSMG 规范
- 姿态数学单测全绿(`test/` 与 `ahrs/` 两套)
- 无 `eval` / `new Function` / `document.write`

---

## 建议处理顺序

| 序 | 项 | 改动量 | 风险 | 验证 |
|---|---|---|---|---|
| 1 | #1 双音 splice | 1-2 处循环改写 | 低 | 新增 e2e 硬断言 |
| 2 | #4 MQTT XSS | 3 处渲染改写 | 低 | 功能回归 |
| 3 | #14 move.mjs 重写 | 整文件重写 | 无 | 退出码 0 |
| 4 | #6/#7 监听器与重试定时器 | 各几行 | 中 | 新增 leak e2e |
| 5 | #3 60ms 偏移 | 1 行 | 低 | 数学断言 + 手测 |
| 6 | #2 后台爆音 | `_tick` + update 各几行 | 中 | 注入断言 + 手测 |
| 7 | #18 删死工作流 | 删文件 | 无 | ls 确认 |
| 8 | #19 合并 attitude | 3 处 import | 低 | verify-attitude 全绿 |
| 9 | #5/#8 依赖包修正 | 出 v0.1.1 tag | 中 | 监听器计数断言 |
| 10 | #9/#10/#11 dispose 补全 | ~30 行 | 低 | 重开回归 + GPU 计数 |
| 11 | #17 编辑器撤销 | ~60 行 | 中 | 新增 2 个 e2e |
| 12 | #23 测试接线 | scripts + 2 个 e2e | 低 | npm run check |
| 13 | 其余 P1/P2 | 按需 | 低 | 各自断言 |

前 3 项改动量最小、收益最直接，可一次性提交。#5/#8 需先在 `@hana/*` 出 tag 再切依赖(`rm -f package-lock.json` 后重装)。

---

## 变更记录

- 2026-08-29: 首次全量审计，23 项。其中 #1/#2/#3/#5/#14/#15 已执行验证，其余为代码走读确认。
