import * as THREE from 'three';

const GRAVITY = new THREE.Vector3(0, 0, -9);
const LIFETIME = 1.05;
const MAX_PARTICLES = 600;

export class Fx {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.shake = 0;
    this.shakeDecay = 3.2;
    this._time = 0;

    this._bursts = [];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    this._points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.16,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this._points.frustumCulled = false;
    this._points.visible = false;
    scene.add(this._points);

    this._free = [];
    for (let i = 0; i < 32; i++) this._free.push(this._alloc());
  }

  _alloc() {
    return {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      acc: new THREE.Vector3(),
      color: new THREE.Color(),
      life: 0,
      maxLife: 1,
    };
  }

  burst(pos, color, count = 26, dir = null) {
    const room = Math.max(0, MAX_PARTICLES - this._bursts.length);
    const nSpawn = Math.min(count, room);
    for (let i = 0; i < nSpawn; i++) {
      const p = this._free.pop() || this._alloc();
      p.pos.copy(pos);
      if (dir) {
        p.vel.copy(dir).multiplyScalar(5.5 + Math.random() * 5.5);
        p.vel.x += (Math.random() - 0.5) * 6.5;
        p.vel.y += (Math.random() - 0.5) * 6.5;
        p.vel.z += (Math.random() - 0.5) * 6.5;
      } else {
        p.vel.set(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
        );
      }
      p.acc.copy(GRAVITY);
      p.color.set(color);
      p.color.offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.16);
      p.life = 0;
      p.maxLife = LIFETIME * (0.65 + Math.random() * 0.65);
      this._bursts.push(p);
    }
    this._sync();
  }

  addShake(amount) {
    this.shake = Math.min(1.0, this.shake + amount);
  }

  update(dt) {
    this._time += dt;
    this.shake = Math.max(0, this.shake - this.shakeDecay * dt);

    if (this._bursts.length === 0) {
      this._points.visible = false;
      return;
    }
    this._points.visible = true;

    const posAttr = this._points.geometry.attributes.position;
    const colAttr = this._points.geometry.attributes.color;
    let n = 0;
    const dead = [];
    for (let i = 0; i < this._bursts.length; i++) {
      const p = this._bursts[i];
      p.life += dt;
      if (p.life >= p.maxLife || n >= MAX_PARTICLES) {
        this._free.push(p);
        dead.push(i);
        continue;
      }
      p.vel.addScaledVector(p.acc, dt);
      p.pos.addScaledVector(p.vel, dt);
      const fade = Math.max(0, 1 - p.life / p.maxLife);
      posAttr.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
      colAttr.setXYZ(n, p.color.r * fade, p.color.g * fade, p.color.b * fade);
      n++;
    }
    for (let i = dead.length - 1; i >= 0; i--) {
      this._bursts.splice(dead[i], 1);
    }
    this._points.geometry.setDrawRange(0, n);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  // 在 followView 设置好相机位置与朝向后调用，叠加平滑震屏偏移而不破坏 lookAt 方向
  applyShake(camera = this.camera) {
    if (!camera || this.shake <= 0.005) return;
    const k = this.shake * this.shake * 0.22;
    const t = this._time * 42;
    camera.position.x += Math.sin(t * 1.3) * k;
    camera.position.z += Math.cos(t * 1.7) * k * 0.85;
  }

  _sync() {
    this._points.geometry.setDrawRange(0, Math.min(this._bursts.length, MAX_PARTICLES));
  }

  dispose() {
    if (this._points) {
      this.scene?.remove(this._points);
      this._points.geometry?.dispose();
      this._points.material?.dispose();
    }
    this._bursts.length = 0;
  }
}
