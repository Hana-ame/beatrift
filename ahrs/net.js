// /test/ 的通信层: PeerJS(原始传感器 JSON 流) + MQTT 发现 + 二维码
// 独立前缀/主题, 与主应用 beatrift 互不干扰
import Peer from 'peerjs';
import mqtt from 'mqtt';
import QRCode from 'qrcode';
import { genRoomCode, normalizeCode, ROOM_CODE_LEN } from '../src/constants.js';

export const PREFIX = 'beatrifttest';
export const MQTT_URL = 'wss://broker.hivemq.com:8884/mqtt';
export const MQTT_TOPIC = 'beatrift/test/rooms';

// 控制消息类型
export const P = {
  HELLO: 'hello',
  SENSOR: 'sensor',
  PING: 'ping',
  PONG: 'pong',
  RESET: 'reset',
};

export { genRoomCode, normalizeCode, ROOM_CODE_LEN };

function waitOpen(peer, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('peer-open-timeout')), timeout);
    peer.on('open', (id) => { clearTimeout(t); resolve(id); });
    peer.on('error', (err) => { clearTimeout(t); reject(err); });
  });
}

function setup(session, conn, handlers) {
  conn.on('data', (d) => handlers.onData?.(d));
  conn.on('open', () => handlers.onOpen?.(conn));
  conn.on('close', () => handlers.onClose?.());
  conn.on('error', (e) => handlers.onError?.(e));
}

// PC: 作为主机等待手机连接
export async function createHost(roomCode, handlers) {
  const id = `${PREFIX}-${roomCode}`;
  const peer = new Peer(id, { debug: 0 });
  const hostId = await waitOpen(peer);
  const session = {
    conn: null,
    send: (obj) => { if (session.conn) session.conn.send(obj); },
    get hasClient() { return !!session.conn; },
    close: () => peer.destroy(),
  };
  peer.on('connection', (c) => {
    session.conn = c;
    setup(session, c, handlers);
  });
  return { id: hostId, ...session };
}

// 手机: 连接 PC
export async function joinPeer(targetId, handlers) {
  const peer = new Peer({ debug: 0 });
  const myId = await waitOpen(peer);
  const conn = peer.connect(targetId, { reliable: false });
  const session = {
    conn,
    send: (obj) => conn.send(obj),
    close: () => peer.destroy(),
  };
  setup(session, conn, handlers);
  await new Promise((resolve, reject) => {
    conn.once('open', resolve);
    conn.once('error', reject);
  });
  return { myId, ...session };
}

export function buildJoinUrl(roomCode) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/mobile?room=${roomCode}`;
}

export function renderQr(canvas, roomCode) {
  return QRCode.toCanvas(canvas, buildJoinUrl(roomCode), { width: 256, margin: 1 });
}

// ---------- MQTT 发现 ----------
let client = null;
let heartbeat = null;

function mqttConnect({ timeout = 6000 } = {}) {
  if (client) return Promise.resolve(client.connected);
  return new Promise((resolve) => {
    const c = mqtt.connect(MQTT_URL, {
      clientId: `beatrifttest-${Math.random().toString(36).slice(2, 10)}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 0,
    });
    client = c;
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    c.on('connect', () => { c.on('error', () => {}); finish(true); });
    c.on('error', () => finish(false));
    setTimeout(() => finish(false), timeout);
  });
}

export function pcAnnounce(roomCode, peerId) {
  const topic = `${MQTT_TOPIC}/${roomCode}`;
  const beat = { roomCode, peerId, ts: Date.now() };
  const publish = () => {
    if (!client?.connected) return;
    client.publish(topic, JSON.stringify(beat), { qos: 0, retain: false });
  };
  publish();
  heartbeat = setInterval(publish, 2000);
  return () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
}

export function subscribeRooms(handler) {
  if (!client?.connected) return null;
  const topic = `${MQTT_TOPIC}/+`;
  client.subscribe(topic, { qos: 0 });
  const onMessage = (t, payload) => {
    const code = t.split('/').pop();
    try { handler(code, JSON.parse(payload.toString())); } catch { /* ignore */ }
  };
  client.on('message', onMessage);
  return () => {
    client.unsubscribe(topic);
    client.off('message', onMessage);
  };
}

export async function discoveryReady() {
  return mqttConnect();
}

export function discoveryClose() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (client) {
    try { client.end(true); } catch { /* noop */ }
    client = null;
  }
}
