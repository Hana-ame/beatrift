import * as THREE from 'three';
import { GAME, DIFFICULTY } from '../constants.js';
import { SWORD_PIVOT, SWORD_LEN, TRAIL_LEN } from './scene.js';

const UP = new THREE.Vector3(0, 1, 0);

const TRAVEL_STEPS = Math.round(Math.abs(GAME.NOTE_SPAWN_Y) / GAME.NOTE_SPEED * 4 * GAME.BPM / 60);
const HIT_STEPS = 4.5;
const PERFECT_STEPS = 2;
const MISS_STEPS = 6;
const HIT_RADIUS = 1.2;

const COLORS = [0x4de3ff, 0xff2d78, 0xffd166, 0xb06dff, 0x3ddc84, 0xff8a3d, 0x66b3ff, 0xff5c8a, 0x9af0c0];

// 谱面: 可以是数组 [{beat,x,y,color?}] 或对象 { song:{name,bpm,synth?,url?}, notes:[...] }
// beat 为该音符到达判定平面的拍数, x 为判定平面上的水平坐标, y 为竖直坐标 (世界系 z-up)。
export async function loadChart(name = 'default') {
  const res = await fetch(`/charts/${name}.json`);
  if (!res.ok) throw new Error(`谱面加载失败: charts/${name}.json (${res.status})`);
  const raw = await res.json();
  const meta = Array.isArray(raw) ? { notes: raw } : raw;
  const notes = (meta.notes || []).map((n) => ({
    beat: n.beat,
    step: n.beat * 4,
    pos: new THREE.Vector3(n.x, GAME.NOTE_PLANE_Y, n.y),
    color: n.color ?? pickColor(n.x),
  }));
  return { song: meta.song ?? null, notes };
}

export function pickColor(x) {
  const i = Math.round((x + 2.2) / 4.4 * (COLORS.length - 1));
  return COLORS[Math.max(0, Math.min(COLORS.length - 1, i))];
}

export class Game {
  constructor({ scene, music, fx, physics, popup, hud, onEnd, diff }) {
    this.scene = scene;
    this.music = music;
    this.fx = fx;
    this.physics = physics;
    this.popup = popup;
    this.hud = hud;
    this.onEnd = onEnd;
    this.hitRadius = diff?.hitRadius ?? HIT_RADIUS;
    this.hitSteps = diff?.hitSteps ?? HIT_STEPS;

    this.chart = [];
    this.notes = [];
    this.spawnCursor = 0;

    this.swordDir = { x: 0, y: 0, z: 1 };
    this.swordVisible = false;
    this.calibrating = false;
    this.omega = 0;
    this._ray = new THREE.Raycaster();
    this._prevTip = null;
    this._prevDir = null;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lives = GAME.LIVES;
    this.perfect = 0;
    this.good = 0;
    this.misses = 0;
    this.ended = false;
    this._swordFlash = 0;
    this._missLater = [];
  }

  setChart(chart) {
    this.chart = [...chart].sort((a, b) => a.step - b.step);
    this.spawnCursor = 0;
    this.notes = [];
  }

  setSwordDir(dir, omega) {
    this.swordDir = dir;
    this.swordVisible = true;
    if (omega != null) this.omega = omega;
  }

  setDifficulty(d) {
    const c = DIFFICULTY[d];
    this.hitRadius = c ? c.hitRadius : HIT_RADIUS;
    this.hitSteps = c ? c.hitSteps : HIT_STEPS;
  }

  update(dt) {
    if (this.ended) return;

    // 校准模式: 只显示光剑跟随, 不生成/不移动/不结算音符
    if (this.calibrating) {
      this._updateSword(dt);
      return;
    }

    const step = this.music.currentStep;

    while (this.spawnCursor < this.chart.length) {
      const n = this.chart[this.spawnCursor];
      if (n.step - TRAVEL_STEPS > step) break;
      this._spawnNote(n, step);
      this.spawnCursor += 1;
    }

    for (const n of this.notes) {
      if (n.dead) continue;
      const p = (step - n.targetStep + TRAVEL_STEPS) / TRAVEL_STEPS;
      n.mesh.position.y = GAME.NOTE_SPAWN_Y + (GAME.NOTE_PLANE_Y - GAME.NOTE_SPAWN_Y) * Math.min(p, 1.4);
      n.mesh.rotation.y += dt * 2.4;
      n.mesh.rotation.x += dt * 1.6;
      if (p > 1 + MISS_STEPS / TRAVEL_STEPS) this._missLater.push(n);
    }
    for (const n of this._missLater) this._miss(n);
    this._missLater.length = 0;

    this._updateSword(dt);
    this._collideNotes(step);
  }

  // 碰撞 (纯接触): 剑刃(枢轴→剑尖)所在线段与音符中心的距离 <= HIT_RADIUS 即砍中。
  // 与挥动速度/位移无关——剑尖停着碰到音符也会立刻砍碎。命中在 _hit 里触发物理碎块。
  _collideNotes(step) {
    if (this.ended || !this.swordVisible) return;

    const dir = new THREE.Vector3(this.swordDir.x, this.swordDir.y, this.swordDir.z);
    if (dir.lengthSq() < 1e-9) return;

    const pivot = SWORD_PIVOT;
    const tip = pivot.clone().addScaledVector(dir, SWORD_LEN);
    const blade = tip.clone().sub(pivot);
    const bladeLen = blade.length();
    const bladeDir = blade.clone().normalize();

    for (const n of this.notes) {
      if (n.dead) continue;
      const y = n.mesh.position.y;
      if (y < GAME.NOTE_PLANE_Y - 2.2 || y > GAME.NOTE_PLANE_Y + 1.6) continue;
      if (Math.abs(step - n.targetStep) > this.hitSteps) continue;

      // 点到线段最近点
      const p = n.mesh.position.clone().sub(pivot);
      const t = p.dot(bladeDir) / bladeLen;
      const tt = Math.max(0, Math.min(1, t));
      const closest = pivot.clone().addScaledVector(bladeDir, tt * bladeLen);
      if (closest.distanceTo(n.mesh.position) <= HIT_RADIUS) {
        this._hit(n, step);
        break;
      }
    }
  }

  _spawnNote(chartNote, _step) {
    const mesh = this.scene.notePool.spawn(chartNote.pos.clone(), chartNote.color);
    mesh.position.y = GAME.NOTE_SPAWN_Y;
    this.notes.push({
      targetStep: chartNote.step,
      pos: chartNote.pos.clone(),
      color: chartNote.color,
      mesh,
      dead: false,
    });
  }

  _updateSword(dt) {
    const s = this.scene.sword;
    s.group.visible = this.swordVisible;
    if (!this.swordVisible) return;
    s.group.quaternion.setFromUnitVectors(UP, new THREE.Vector3(this.swordDir.x, this.swordDir.y, this.swordDir.z));

    const { tip } = this.scene.getSword();
    const trail = this.scene.trail;
    trail.pts.push(tip.clone());
    if (trail.pts.length > TRAIL_LEN) trail.pts.shift();
    const posAttr = trail.line.geometry.attributes.position;
    for (let i = 0; i < TRAIL_LEN; i++) {
      const pt = trail.pts[i] || trail.pts[trail.pts.length - 1] || tip;
      posAttr.setXYZ(i, pt.x, pt.y, pt.z);
    }
    posAttr.needsUpdate = true;

    if (this._swordFlash > 0) {
      this._swordFlash -= dt;
      s.tipLight.intensity = 1.2 + this._swordFlash * 6;
    } else {
      s.tipLight.intensity = 1.2;
    }
  }

  _swordPose() {
    const dir = new THREE.Vector3(this.swordDir.x, this.swordDir.y, this.swordDir.z);
    const tip = SWORD_PIVOT.clone().addScaledVector(dir, SWORD_LEN);
    return { pivot: SWORD_PIVOT, dir, tip };
  }

  onSwing(omega) {
    if (this.ended || !this.swordVisible) return;
    const step = this.music.currentStep;
    const { tip } = this._swordPose();

    let best = null;
    let bestDist = Infinity;
    for (const n of this.notes) {
      if (n.dead) continue;
      const y = n.mesh.position.y;
      if (y < GAME.NOTE_PLANE_Y - 2.2 || y > GAME.NOTE_PLANE_Y + 1.6) continue;
      const off = Math.abs(step - n.targetStep);
      if (off > this.hitSteps) continue;
      // 屏幕平面距离: 剑尖投影到判定平面(y=NOTE_PLANE_Y) 与音符的平面距离
      const d = Math.hypot(tip.x - n.pos.x, tip.z - n.pos.z);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }

    if (best && bestDist <= this.hitRadius) {
      this._hit(best, step);
    } else if (best && bestDist <= this.hitRadius + 0.8) {
      // 擦边: 仍算命中但基础分
      this._hit(best, step, true);
    }
  }

  _hit(n, step, edge = false) {
    n.dead = true;
    const off = Math.abs(step - n.targetStep);
    const grade = off <= PERFECT_STEPS && !edge ? 'perfect' : 'good';

    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = 1 + this.combo * (grade === 'perfect' ? 0.02 : 0.01);
    const base = grade === 'perfect' ? 100 : 60;
    const gain = Math.round(base * mult);
    this.score += gain;
    if (grade === 'perfect') this.perfect += 1;
    else this.good += 1;

    const pos = n.mesh.position.clone();
    const { dir } = this.scene.getSword();
    this.scene.notePool.release(n.mesh);
    this.notes.splice(this.notes.indexOf(n), 1);

    this.physics.splitNote(pos, n.color, dir, this.scene.scene);
    this.fx.burst(pos, grade === 'perfect' ? 0xffd166 : 0x4de3ff, grade === 'perfect' ? 34 : 22, dir);
    this.fx.addShake(grade === 'perfect' ? 0.3 : 0.18);
    this._swordFlash = 0.35;

    this.popup(grade === 'perfect' ? 'PERFECT' : 'GOOD', grade);
    this.hud.update({ score: this.score, combo: this.combo, lives: this.lives, perfect: this.perfect, good: this.good, misses: this.misses });
  }

  _miss(n) {
    n.dead = true;
    this.combo = 0;
    this.misses += 1;
    if (!GAME.INVINCIBLE) this.lives -= 1;

    const pos = n.mesh.position.clone();
    this.scene.notePool.release(n.mesh);
    this.notes.splice(this.notes.indexOf(n), 1);

    this.fx.burst(pos, 0xff5c5c, 10);
    this.fx.addShake(0.8);
    this.popup('MISS', 'miss');

    this.hud.update({ score: this.score, combo: this.combo, lives: this.lives, perfect: this.perfect, good: this.good, misses: this.misses });
    if (!GAME.INVINCIBLE && this.lives <= 0) this._end();
  }

  finish() {
    if (!this.ended) this._end();
  }

  _end() {
    this.ended = true;
    this.music.stop();
    const total = this.perfect + this.good + this.misses;
    const acc = total ? Math.round((this.perfect + this.good * 0.6) / total * 100) : 0;
    this.onEnd?.({
      score: this.score,
      maxCombo: this.maxCombo,
      perfect: this.perfect,
      good: this.good,
      misses: this.misses,
      acc,
    });
  }
}
