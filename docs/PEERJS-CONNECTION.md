# PeerJS 匹配 / 连接流程

双端通过 **PeerJS(公共云信令) + WebRTC DataChannel** 直连，用 **MQTT(公共 broker)做房间发现**。纯前端、无自建后端。

## 角色与 ID

| 角色 | 动作 | Peer ID |
|------|------|---------|
| PC (主机) | `createHost(roomCode)` 注册固定 ID | `beatrift-{5位房间码}` |
| Mobile | `joinPeer(targetId)` 匿名 peer，主动连接主机 | 随机 |

- 房间码：5 位，字母表去掉易混字符（无 0/O/1/I/L）。
- 信令：PeerJS 公共云（默认服务器），`waitOpen` 12s 超时。
- 数据通道：单条，`reliable:false`（不可靠、低延迟，见 `connection.js`）。

## 1. PC 建房

`src/ui/pc.js` → `makeHost()`：

1. `genRoomCode()` 生成码 → 画二维码（`buildJoinUrl` → `#/mobile?room=CODE`）+ 显示房间码。
2. `createHost(beatrift-{code})`：`new Peer(id)` → 注册固定 ID（若 ID 被占抛 `unavailable-id`，则换码重试）。
3. 连 MQTT 并广播：`pcAnnounce` 向 topic `beatrift/rooms/{code}` 每 **2s** 发心跳 `{roomCode, peerId, ts}`。
4. `peer.on('connection')` → 设为 `session.conn`，装好 handlers。手机连上后 `onOpen`：
   - 状态"已连接"，`startGame({..., calibrate:true})` → 进入 `screen-game`（PC 侧校准浮层）。

## 2. Mobile 发现 + 加入

`src/ui/mobile.js`：

1. **发现**：`subscribeRooms('beatrift/rooms/+')` 监听 MQTT，把 PC 的 `{roomCode, peerId}` 渲染成设备列表；点列表项或手输/扫码 `#/mobile?room=CODE`。
2. **加入**：`doJoin` → `normalizeCode` → `joinPeer('beatrift-{code}')`：
   - `new Peer()`（匿名）→ `peer.connect(targetId, {reliable:false})` 建立 DataChannel。
   - 成功后发 `P.HELLO`（`{v, role:'mobile'}`），启动 1s 心跳 `PING`。
   - `enterRemote()`：请求传感器权限 → `sensor.start(onFrame, onSwing)` → 发 `P.READY` → 进 `screen-remote` → 开始流。
3. 失败自动重连 2 次，仍失败则回 `screen-mobile`。

## 3. DataChannel 载荷分发

`src/net/connection.js` `setup()`：

- **`ArrayBuffer` / `Uint8Array`** → 体感帧 → `decodeMotion` → `onMotion`（PC 交给 `handleMotion`）。
- **其它(JSON)** → 控制消息 → `onControl`。

### 体感帧（6 × Float32 = 24B）

`encodeMotion(top, omega, hit)` → `f[0..2]=top`（手机顶边世界系方向），`f[3]=omega`，`f[4]=hit>0?omega:0`，`f[5]=0`。

### 控制消息（`P.*`）

`hello` / `ready` / `start` / `state` / `end` / `ping` / `pong` / `recalib` / `vibrate`。

## 4. 消息时序

```
PC (host)                          Mobile
─────────────────────────────────────────────
建房+MQTT 广播(2s 心跳)
                                   发现/输码 → joinPeer(beatrift-{code})
                                  ── DataChannel ──▶
                                   发 HELLO
conn open → startGame(calibrate:true)
                                   发 READY → 进遥控界面, 开始流
校准(PC 浮层: 反转/设正面)
[开始] beginPlay ── START(bpm) ──▶
                                   60Hz 流 motion(top,omega,hit)
handleMotion → 剑方向 + 判定/计分
                  STATE(score) ──▶ (可选回显)
[结束]  ── END(stats) ──▶
```

- 延迟：`PING`/`PONG` 每 1s 测量，Mobile 显示 `xx ms`。
- 重开：PC 端 `#end-replay` 调 `startGame({keepCalib:true})`（保留校准，重新建房内场景）；`#hud-exit`/`#end-exit` 退出回 `screen-pc`（Peer/MQTT 不断）。

## 5. 容错与断开

| 场景 | 处理 |
|------|------|
| Peer ID 被占 (`unavailable-id`) | PC 换房间码重试 |
| `waitOpen` 超时 | 抛 `peer-open-timeout`，加入失败提示 |
| MQTT 连不上 | `connect` 重试 1 次；广播/订阅失败则列表为空，可手输码 |
| 通道 close | PC `onClose` →"手机已断开"；Mobile →"连接已断开" |
| 手机重新连 | 换码/同码重 `joinPeer`，PC `onOpen` 重新走校准 |

## 关键文件

- `src/net/connection.js`：`createHost` / `joinPeer` / 载荷分发
- `src/net/discovery.js`：MQTT 广播(`pcAnnounce`) 与订阅(`subscribeRooms`)
- `src/net/protocol.js`：`P.*` 消息、`encodeMotion`/`decodeMotion`
- `src/net/joinUrl.js`：扫码直达链接
- `src/ui/pc.js` / `src/ui/mobile.js`：两端接入流程
- `src/constants.js`：`PEER_PREFIX`、`MQTT`、房间码字母表
