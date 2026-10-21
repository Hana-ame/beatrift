import Peer from 'peerjs';
import { PEER_PREFIX } from '../constants.js';
import { decodeMotion } from './protocol.js';

function waitOpen(peer, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('peer-open-timeout')), timeout);
    peer.on('open', (id) => { clearTimeout(t); resolve(id); });
    peer.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function setup(session, conn, handlers) {
  conn.on('data', (d) => {
    if (d instanceof ArrayBuffer || d instanceof Uint8Array) {
      handlers.onMotion?.(decodeMotion(d));
    } else {
      handlers.onControl?.(d);
    }
  });
  conn.on('open', () => handlers.onOpen?.(conn));
  conn.on('close', () => handlers.onClose?.());
  conn.on('error', (e) => handlers.onError?.(e));
}

export async function createHost(roomCode, handlers) {
  const id = `${PEER_PREFIX}-${roomCode}`;
  const peer = new Peer(id, { debug: 0 });
  const hostId = await waitOpen(peer);
  const session = {
    conn: null,
    sendControl: (obj) => { if (session.conn) session.conn.send(obj); },
    sendMotion: (buf) => { if (session.conn) session.conn.send(buf); },
    get hasClient() { return !!session.conn; },
    close: () => peer.destroy(),
  };

  peer.on('connection', (c) => {
    session.conn = c;
    setup(session, c, handlers);
  });

  return { id: hostId, ...session };
}

export async function joinPeer(targetId, handlers) {
  const peer = new Peer({ debug: 0 });
  const myId = await waitOpen(peer);
  const conn = peer.connect(targetId, { reliable: false });
  const session = {
    conn,
    sendControl: (obj) => conn.send(obj),
    sendMotion: (buf) => conn.send(buf),
    close: () => peer.destroy(),
  };
  setup(session, conn, handlers);

  await new Promise((resolve, reject) => {
    conn.once('open', resolve);
    conn.once('error', reject);
  });

  return { myId, ...session };
}
