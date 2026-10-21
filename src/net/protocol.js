export const P = {
  HELLO: 'hello',
  READY: 'ready',
  START: 'start',
  STATE: 'state',
  END: 'end',
  PING: 'ping',
  PONG: 'pong',
  RECALIB: 'recalib',
  VIBRATE: 'vibrate',
};

export const MOTION_CHANNEL = 'beatrift-motion';
export const MOTION_FLOATS = 6;

export function makeControl(t, payload = {}) {
  return JSON.stringify({ t, ...payload });
}

export function parseControl(raw) {
  try {
    return JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return null;
  }
}

export function encodeMotion(dir, omega, hit) {
  const buf = new ArrayBuffer(MOTION_FLOATS * 4);
  const f = new Float32Array(buf);
  f[0] = dir.x;
  f[1] = dir.y;
  f[2] = dir.z;
  f[3] = omega;
  f[4] = hit ? omega : 0;
  f[5] = 0;
  return buf;
}

export function decodeMotion(buf) {
  const f = new Float32Array(
    buf instanceof ArrayBuffer
      ? buf
      : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  if (f.length < MOTION_FLOATS) return null;
  const x = f[0];
  const y = f[1];
  const z = f[2];
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return {
    dir: { x: x / len, y: y / len, z: z / len },
    omega: f[3],
    hit: f[4],
  };
}
