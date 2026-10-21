export const quat = {
  identity() {
    return { x: 0, y: 0, z: 0, w: 1 };
  },

  clone(q) {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  },

  normalize(q) {
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    if (len < 1e-8) return quat.identity();
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  },

  multiply(a, b) {
    return {
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
  },

  conjugate(q) {
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  },

  invert(q) {
    const c = quat.conjugate(q);
    const n = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
    if (n < 1e-8) return quat.identity();
    const inv = 1 / n;
    return { x: c.x * inv, y: c.y * inv, z: c.z * inv, w: c.w * inv };
  },

  delta(a, b) {
    return quat.multiply(quat.invert(a), b);
  },

  fromEulerYXZ(e, out = { x: 0, y: 0, z: 0, w: 1 }) {
    const cx = Math.cos(e.x / 2), sx = Math.sin(e.x / 2);
    const cy = Math.cos(e.y / 2), sy = Math.sin(e.y / 2);
    const cz = Math.cos(e.z / 2), sz = Math.sin(e.z / 2);
    out.w = cx * cy * cz + sx * sy * sz;
    out.x = sx * cy * cz - cx * sy * sz;
    out.y = cx * sy * cz + sx * cy * sz;
    out.z = cx * cy * sz - sx * sy * cz;
    return out;
  },

  fromAxisAngle(axis, angle, out = { x: 0, y: 0, z: 0, w: 1 }) {
    const al = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
    if (al < 1e-8) return quat.identity();
    const ax = axis.x / al;
    const ay = axis.y / al;
    const az = axis.z / al;
    const h = angle / 2;
    const s = Math.sin(h);
    out.x = ax * s;
    out.y = ay * s;
    out.z = az * s;
    out.w = Math.cos(h);
    return out;
  },

  fromToDir(from, to, out = { x: 0, y: 0, z: 0, w: 1 }) {
    const d = Math.sqrt(
      (from.x + to.x) ** 2 + (from.y + to.y) ** 2 + (from.z + to.z) ** 2,
    );
    if (d < 1e-8) {
      return quat.fromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI, out);
    }
    out.x = from.y * to.z - from.z * to.y;
    out.y = from.z * to.x - from.x * to.z;
    out.z = from.x * to.y - from.y * to.x;
    out.w = d / 2;
    return quat.normalize(out);
  },

  angleAndAxis(q) {
    const v = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z);
    if (v < 1e-8) return { angle: 0, axis: { x: 1, y: 0, z: 0 } };
    const angle = 2 * Math.atan2(v, q.w);
    return { angle, axis: { x: q.x / v, y: q.y / v, z: q.z / v } };
  },
};
