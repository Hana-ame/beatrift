# BeatRift 通信协议

WebRTC 单一 DataChannel(`reliable:false` → `ordered:false`)同时承载控制消息与体感帧。

## 帧类型区分

- `ArrayBuffer` / `Uint8Array` → **体感帧**(24 字节二进制)
- 其它 → **控制消息**(JSON 对象, 含 `t` 字段)

## 体感帧(motion)

`Float32Array[6]`, little-endian, 共 24 字节:

| 偏移 | 字段     | 说明                                   |
|------|----------|----------------------------------------|
| 0    | dirX     | 光剑方向单位向量 x (世界坐标)           |
| 4    | dirY     | 光剑方向单位向量 y                      |
| 8    | dirZ     | 光剑方向单位向量 z                      |
| 12   | omega    | 本帧角速度 (rad/s)                      |
| 16   | hit      | `0` = 无挥击; `>0` = 本次为挥击峰值, 值=峰值角速度 |
| 20   | 保留      | —                                      |

发送频率 ≈ 60Hz。`hit>0` 的帧与相邻帧顺序可能因无序通道而乱序, 接收方以 `hit>0` 为准触发挥击事件。

方向由手机端在**单点基准校准**(手机前端瞄准屏幕中心、静止 2s, 采样平均姿态四元数为 `ref`)后, 对实时 Mahony 融合姿态四元数解出的屏幕法线 `forward` 相对 `ref` 的偏移做**连续映射**得到:
`screenRel → (u,v) ∈ ℝ² → clamp + GAIN 放大 → (cu,cv) ∈ [-1,1]² → 光剑方向(屏幕平面内, 中性位竖直向上)`。
全程连续无网格量化; 光剑方向 `dir.z = 0` 保证剑刃平行屏幕、相机可见。

## 控制消息

`{ t: <type>, ... }`, JSON。

| type      | 方向         | 负载                                        | 说明                        |
|-----------|--------------|---------------------------------------------|-----------------------------|
| `hello`   | mobile→pc    | `v`, `role`                                 | 连接握手                    |
| `ready`   | mobile→pc    | `diff` (`easy`/`normal`/`hard`)             | 校准完成 + 所选难度          |
| `start`   | pc→mobile    | `bpm`                                       | 游戏开始                    |
| `state`   | pc→mobile    | `score`, `combo`, `lives`                   | 实时状态(≤4 次/秒节流)      |
| `end`     | pc→mobile    | `score`, `maxCombo`, `perfect`, `good`, `misses`, `acc` | 游戏结束统计 |
| `ping`    | 双向         | `ts`                                        | 延迟测量                    |
| `pong`    | 双向         | `ts` (回显)                                 | 延迟测量                    |

## 发现层 (MQTT)

HiveMQ 公共 broker `wss://broker.hivemq.com:8884/mqtt`, 免注册。

| Topic                    | 发布者    | 负载                                            |
|--------------------------|-----------|-------------------------------------------------|
| `beatrift/rooms/{code}`  | PC(2s 心跳) | `{ roomCode, peerId, ts }`                    |
| `beatrift/rooms/+`       | Mobile 订阅 | 发现房间列表                                    |

`peerId` = `beatrift-{房间码}`, 因此扫二维码/手输码可绕过 MQTT 直连。

## 房间码

5 位字符集 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`(去易混淆字符)。二维码内容 = 当前页面 URL + `#/mobile?room={code}`。
