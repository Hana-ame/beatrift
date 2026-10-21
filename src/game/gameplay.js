import * as THREE from 'three';
import { GAME, DIFFICULTY, DEFAULT_DIFFICULTY } from '../constants.js';
import { SWORD_PIVOT, SWORD_LEN, TRAIL_LEN } from './scene.js';

const UP = new THREE.Vector3(0, 1, 0);

const HIT_STEPS = 4.5;
const PERFECT_STEPS = 2.0;
const MISS_STEPS = 5.5;
const HIT_RADIUS = 1.25;

const COLORS = [0x4de3ff, 0xff2d78, 0xffd166, 0xb06dff, 0x3ddc84, 0xff8a3d, 0x66b3ff, 0xff5c8a, 0x9af0c0];

// 谱面: 可以是数组 [{beat,x,y,type?,color?}] 或对象 { song:{name,bpm,synth?,url?}, notes:[...] }
// beat 为该音符到达判定平面的拍数, x 为判定平面上的水平坐标, y 为竖直坐标 (世界系 z-up)。
export async function loadChart(name = 'default') {
  if (typeof window !== 'undefined' && window.__BEATRIFT_CHARTS && window.__BEATRIFT_CHARTS[name]) {
    return parseChartData(window.__BEATRIFT_CHARTS[name]);
  }
  const res = await fetch(`/charts/${name}.json`);
  if (!res.ok) throw new Error(`谱面加载失败: charts/${name}.json (${res.status})`);
  const raw = await res.json();
  return parseChartData(raw);
}

export function parseChartData(raw) {
  const meta = Array.isArray(raw) ? { notes: raw } : raw;
  const notes = (meta.notes || []).map((n) => {
    const type = n.type || 'normal';
    return {
      beat: n.beat,
      step: n.beat * 4,
      pos: new THREE.Vector3(n.x, GAME.NOTE_PLANE_Y, n.y),
      type,
      color: n.color ?? pickColor(n.x, type),
    };
  });
  return { song: meta.song ?? null, notes };
}

export function pickColor(x, type = 'normal') {
  if (type === 'gold') return 0xffd166;
  if (type === 'bomb') return 0xff2244;
  if (type === 'chain') return 0x3ddc84;
  const i = Math.round((x + 2.2) / 4.4 * (COLORS.length - 1));
  return COLORS[Math.max(0, Math.min(COLORS.length - 1, i))];
}

export function computeComboMultiplier(combo, feverActive = false) {
  const base =
    combo >= 50 ? 4.0 :
    combo >= 30 ? 3.0 :
    combo >= 20 ? 2.0 :
    combo >= 10 ? 1.5 : 1.0;
  return feverActive ? base * 2.0 : base;
}

export function computeRank(acc, misses, good, total) {
  if (total === 0) return { rank: 'C', badge: '' };
  const badge = misses === 0 && good === 0 ? 'ALL PERFECT' : misses === 0 ? 'FULL COMBO' : '';
  const rank =
    acc >= 95 && misses === 0 ? 'SSS' :
    acc >= 90 ? 'S' :
    acc >= 80 ? 'A' :
    acc >= 70 ? 'B' : 'C';
  return { rank, badge };
}

export class Game {
  constructor({ scene, music, fx, physics, popup, hud, onEnd, onVibrate, diff, invincible }) {
    this.scene = scene;
    this.music = music;
    this.fx = fx;
    this.physics = physics;
    this.popup = popup;
    this.hud = hud;
    this.onEnd = onEnd;
    this.onVibrate = onVibrate;

    this.invincible = invincible != null ? !!invincible : !!GAME.INVINCIBLE;
    this.diffKey = DEFAULT_DIFFICULTY;
    this.diffConfig = DIFFICULTY[DEFAULT_DIFFICULTY];
    this.hitRadius = HIT_RADIUS;
    this.hitSteps = HIT_STEPS;
    this.perfectSteps = PERFECT_STEPS;
    this.missSteps = MISS_STEPS;
    this.maxLives = GAME.LIVES;
    this.setDifficulty(diff || DEFAULT_DIFFICULTY);

    this.chart = [];
    this.notes = [];
    this.spawnCursor = 0;
    this.totalChartNotes = 0;
    this.lastNoteStep = 0;
    this.travelSteps = this._calcTravelSteps();

    this.swordDir = { x: 0, y: 0, z: 1 };
    this.swordVisible = false;
    this.calibrating = false;
    this.omega = 0;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lives = this.maxLives;
    this.perfect = 0;
    this.good = 0;
    this.misses = 0;
    this.earlyCount = 0;
    this.lateCount = 0;
    this.bombsDodged = 0;
    this.bombsHit = 0;
    this.healStreak = 0;

    this.fever = 0;
    this.feverActive = false;
    this.feverTimer = 0;

    this.ended = false;
    this._swordFlash = 0;
    this._missLater = [];
    this._bombPassLater = [];
  }

  _calcTravelSteps() {
    const travelDist = Math.abs(GAME.NOTE_PLANE_Y - GAME.NOTE_SPAWN_Y);
    const speedScale = this.diffConfig?.speedScale || 1.0;
    const speed = GAME.NOTE_SPEED * speedScale;
    const bpm = this.music?.bpm || GAME.BPM;
    return Math.max(16, Math.round((travelDist / speed) * 4 * (bpm / 60)));
  }

  setChart(chart) {
    this.chart = [...chart].sort((a, b) => a.step - b.step);
    this.spawnCursor = 0;
    this.notes = [];
    this.totalChartNotes = this.chart.filter((n) => n.type !== 'bomb').length;
    this.lastNoteStep = this.chart.length ? this.chart[this.chart.length - 1].step : 64 * 4;
    this.travelSteps = this._calcTravelSteps();
  }

  setSwordDir(dir, omega) {
    this.swordDir = dir;
    this.swordVisible = true;
    if (omega != null) this.omega = omega;
  }

  setDifficulty(d) {
    const cfg = typeof d === 'string' ? DIFFICULTY[d] : d;
    if (cfg) {
      this.diffKey = cfg.id || (typeof d === 'string' ? d : DEFAULT_DIFFICULTY);
      this.diffConfig = cfg;
      this.hitRadius = cfg.hitRadius ?? HIT_RADIUS;
      this.hitSteps = cfg.hitSteps ?? HIT_STEPS;
      this.perfectSteps = cfg.perfectSteps ?? PERFECT_STEPS;
      this.missSteps = cfg.missSteps ?? MISS_STEPS;
      this.maxLives = cfg.maxLives ?? GAME.LIVES;
      this.lives = this.maxLives;
    } else {
      this.diffKey = DEFAULT_DIFFICULTY;
      this.diffConfig = DIFFICULTY[DEFAULT_DIFFICULTY];
      this.hitRadius = HIT_RADIUS;
      this.hitSteps = HIT_STEPS;
      this.perfectSteps = PERFECT_STEPS;
      this.missSteps = MISS_STEPS;
      this.maxLives = GAME.LIVES;
      this.lives = this.maxLives;
    }
    this.travelSteps = this._calcTravelSteps();
  }

  setInvincible(val) {
    this.invincible = !!val;
  }

  get effectiveHitRadius() {
    return this.hitRadius * (this.feverActive ? 1.15 : 1.0);
  }

  update(dt) {
    if (this.ended) return;

    // 校准模式: 只显示光剑与准星跟随, 不生成/不移动/不结算音符
    if (this.calibrating) {
      this._updateSword(dt);
      return;
    }

    // Fever 能量衰减管理
    if (this.feverActive) {
      this.feverTimer -= dt;
      this.fever = Math.max(0, (this.feverTimer / GAME.FEVER_DURATION) * GAME.FEVER_MAX);
      if (this.feverTimer <= 0) {
        this.feverActive = false;
        this.fever = 0;
        this.scene.setFeverVisual?.(false);
      }
    }

    const step = this.music.currentStep;
    const beatPhase = (step / 4) % 1;
    this.scene.stage?.pulseBeat?.(beatPhase);

    while (this.spawnCursor < this.chart.length) {
      const n = this.chart[this.spawnCursor];
      if (n.step - this.travelSteps > step) break;
      this._spawnNote(n, step);
      this.spawnCursor += 1;
    }

    for (const n of this.notes) {
      if (n.dead) continue;
      const p = (step - n.targetStep + this.travelSteps) / this.travelSteps;
      n.mesh.position.y = GAME.NOTE_SPAWN_Y + (GAME.NOTE_PLANE_Y - GAME.NOTE_SPAWN_Y) * Math.min(p, 1.26);
      if (n.type === 'bomb') {
        n.mesh.rotation.y += dt * 3.8;
        n.mesh.rotation.z += dt * 2.5;
      } else {
        n.mesh.rotation.y += dt * (n.type === 'gold' ? 3.4 : 2.4);
        n.mesh.rotation.x += dt * 1.6;
      }

      // 缩圈指示器动画
      const ring = n.mesh.userData?.ring;
      if (ring && n.type !== 'bomb') {
        const rp = Math.max(0, Math.min(1.15, p));
        const rScale = rp < 1 ? 1 + (1 - rp) * 1.35 : Math.max(0.85, 1 - (rp - 1) * 1.2);
        ring.scale.set(rScale, rScale, 1);
        ring.material.opacity = rp < 0.4 ? rp * 1.1 : rp <= 1.05 ? 0.78 : 0.25;
      }

      if (n.type === 'bomb') {
        if (p > 1 + 2.2 / this.travelSteps) this._bombPassLater.push(n);
      } else if (p > 1 + this.missSteps / this.travelSteps) {
        this._missLater.push(n);
      }
    }

    for (const n of this._bombPassLater) this._passBomb(n);
    this._bombPassLater.length = 0;

    for (const n of this._missLater) this._miss(n);
    this._missLater.length = 0;

    this._updateSword(dt);
    this._collideNotes(step);

    // 实时更新进度条
    const progress = this.lastNoteStep > 0 ? Math.max(0, Math.min(1, step / (this.lastNoteStep + 4))) : 0;
    this.hud.updateProgress?.({
      progress,
      fever: this.fever,
      feverActive: this.feverActive,
      mult: computeComboMultiplier(this.combo, this.feverActive),
    });

    // 曲目完成自动判定 (所有音符已生成且全部结算完毕后延迟 6 step 进入结算面板)
    if (this.chart.length > 0 && this.spawnCursor >= this.chart.length && this.notes.length === 0 && step >= this.lastNoteStep + 6) {
      this._end(true);
    }
  }

  // 计算剑刃线段 [pivot, tip] 与判定平面投射到音符的最小距离
  _distanceToBlade(notePos, pivot, tip, bladeDir, bladeLen) {
    const p = notePos.clone().sub(pivot);
    const t = p.dot(bladeDir) / bladeLen;
    const tt = Math.max(0, Math.min(1, t));
    const closest = pivot.clone().addScaledVector(bladeDir, tt * bladeLen);
    const dist3D = closest.distanceTo(notePos);

    // 同时计算剑向射线在音符当前 Y 平面及判定平面上的投影距离，确保提前/延后窗口内挥砍手感跟手
    let projDist = Infinity;
    if (bladeDir.y < -0.05) {
      const tPlane = (GAME.NOTE_PLANE_Y - pivot.y) / bladeDir.y;
      if (tPlane > 0 && tPlane <= bladeLen * 1.35) {
        const px = pivot.x + bladeDir.x * tPlane;
        const pz = pivot.z + bladeDir.z * tPlane;
        projDist = Math.hypot(px - notePos.x, pz - notePos.z);
      }
    }
    return Math.min(dist3D, projDist);
  }

  // 碰撞 (纯接触): 剑刃(枢轴→剑尖)所在线段与音符中心的距离 <= effectiveHitRadius 即砍中。
  // 与挥动速度/位移无关——剑尖停着碰到音符也会立刻砍碎。
  _collideNotes(step) {
    if (this.ended || !this.swordVisible) return;

    const dir = new THREE.Vector3(this.swordDir.x, this.swordDir.y, this.swordDir.z);
    if (dir.lengthSq() < 1e-9) return;

    const pivot = SWORD_PIVOT;
    const bladeDir = dir.clone().normalize();
    const tip = pivot.clone().addScaledVector(bladeDir, SWORD_LEN);
    const hitR = this.effectiveHitRadius;

    // 拷贝当前音符列表以支持单帧一剑双斩而不受 splice 影响
    const candidates = [...this.notes];
    for (const n of candidates) {
      if (n.dead) continue;
      const stepDiff = step - n.targetStep;
      const absStep = Math.abs(stepDiff);

      if (n.type === 'bomb') {
        if (absStep > 1.8) continue;
        const p = n.mesh.position.clone().sub(pivot);
        const tt = Math.max(0, Math.min(1, p.dot(bladeDir) / SWORD_LEN));
        const closest = pivot.clone().addScaledVector(bladeDir, tt * SWORD_LEN);
        if (closest.distanceTo(n.mesh.position) <= 0.78) {
          this._hitBomb(n);
        }
        continue;
      }

      const maxWindow = n.type === 'chain' ? this.hitSteps * 1.15 : this.hitSteps;
      if (absStep > maxWindow) continue;

      const d = this._distanceToBlade(n.mesh.position, pivot, tip, bladeDir, SWORD_LEN);
      const noteRadius = n.type === 'chain' ? hitR * 1.15 : n.type === 'gold' ? hitR * 1.1 : hitR;
      if (d <= noteRadius) {
        this._hit(n, step);
      }
    }
  }

  _spawnNote(chartNote, _step) {
    const type = chartNote.type || 'normal';
    const mesh = this.scene.notePool.spawn(chartNote.pos.clone(), chartNote.color, type);
    mesh.position.y = GAME.NOTE_SPAWN_Y;
    this.notes.push({
      targetStep: chartNote.step,
      pos: chartNote.pos.clone(),
      type,
      color: chartNote.color,
      mesh,
      dead: false,
    });
  }

  _updateSword(dt) {
    const s = this.scene.sword;
    s.group.visible = this.swordVisible;
    if (!this.swordVisible) {
      this.scene.stage?.updateReticle?.(SWORD_PIVOT, UP, false);
      return;
    }
    const dirVec = new THREE.Vector3(this.swordDir.x, this.swordDir.y, this.swordDir.z);
    if (dirVec.lengthSq() > 1e-9) dirVec.normalize();
    s.group.quaternion.setFromUnitVectors(UP, dirVec);

    const { pivot, dir, tip } = this.scene.getSword();
    this.scene.stage?.updateReticle?.(pivot, dir, true);

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
      s.tipLight.intensity = this.feverActive ? 2.2 : 1.2;
    }
  }

  _swordPose() {
    const dir = new THREE.Vector3(this.swordDir.x, this.swordDir.y, this.swordDir.z);
    if (dir.lengthSq() > 1e-9) dir.normalize();
    const tip = SWORD_PIVOT.clone().addScaledVector(dir, SWORD_LEN);
    return { pivot: SWORD_PIVOT, dir, tip };
  }

  onSwing(_omega) {
    if (this.ended || !this.swordVisible) return;
    const step = this.music.currentStep;
    const { pivot, dir, tip } = this._swordPose();
    const hitR = this.effectiveHitRadius;

    let best = null;
    let bestDist = Infinity;
    for (const n of this.notes) {
      if (n.dead || n.type === 'bomb') continue;
      const off = Math.abs(step - n.targetStep);
      if (off > this.hitSteps * 1.15) continue;
      const dPlane = Math.hypot(tip.x - n.pos.x, tip.z - n.pos.z);
      const dBlade = this._distanceToBlade(n.mesh.position, pivot, tip, dir, SWORD_LEN);
      const d = Math.min(dPlane, dBlade);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }

    if (best && bestDist <= hitR) {
      this._hit(best, step);
    } else if (best && bestDist <= hitR + 0.8) {
      // 擦边: 仍算命中但计 GOOD 基础分
      this._hit(best, step, true);
    }
  }

  _hit(n, step, edge = false) {
    if (n.dead) return;
    n.dead = true;
    const stepDiff = step - n.targetStep;
    const off = Math.abs(stepDiff);
    const isChain = n.type === 'chain';
    const isGold = n.type === 'gold';

    const grade = (off <= this.perfectSteps && !edge) || isChain ? 'perfect' : 'good';
    if (grade === 'good') {
      if (stepDiff < 0) this.earlyCount += 1;
      else this.lateCount += 1;
    }

    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.healStreak += 1;

    // 连续命中或击中黄金音符恢复护盾/生命
    const healEvery = this.diffConfig?.healEvery || 10;
    if ((isGold || this.healStreak >= healEvery) && this.lives < this.maxLives) {
      this.lives = Math.min(this.maxLives, this.lives + 1);
      this.healStreak = 0;
    }

    // Fever 充能与激活
    if (!this.feverActive) {
      const feverGain = isGold
        ? GAME.FEVER_GAIN_GOLD
        : grade === 'perfect'
          ? GAME.FEVER_GAIN_PERFECT
          : GAME.FEVER_GAIN_GOOD;
      this.fever = Math.min(GAME.FEVER_MAX, this.fever + feverGain);
      if (this.fever >= GAME.FEVER_MAX) {
        this.feverActive = true;
        this.feverTimer = GAME.FEVER_DURATION;
        this.scene.setFeverVisual?.(true);
        this.music?.playFever?.();
      }
    }

    const comboMult = computeComboMultiplier(this.combo, this.feverActive);
    const diffMult = this.diffConfig?.scoreMult || 1.0;
    const base =
      isGold ? (grade === 'perfect' ? 200 : 130) :
      isChain ? 75 :
      grade === 'perfect' ? 100 : 60;
    const gain = Math.round(base * comboMult * diffMult);
    this.score += gain;

    if (grade === 'perfect') this.perfect += 1;
    else this.good += 1;

    const pos = n.mesh.position.clone();
    const { dir } = this.scene.getSword();
    this.scene.notePool.release(n.mesh);
    const idx = this.notes.indexOf(n);
    if (idx >= 0) this.notes.splice(idx, 1);

    this.physics.splitNote(pos, n.color, dir, this.scene.scene);
    const burstColor = isGold ? 0xffd166 : this.feverActive ? 0xff2d78 : grade === 'perfect' ? 0xffd166 : 0x4de3ff;
    this.fx.burst(pos, burstColor, isGold ? 44 : grade === 'perfect' ? 34 : 22, dir);
    this.fx.addShake(isGold ? 0.35 : grade === 'perfect' ? 0.24 : 0.14);
    this._swordFlash = 0.35;

    this.music?.playHit?.(grade, n.type, this.feverActive);
    this.onVibrate?.(isGold ? 0.9 : grade === 'perfect' ? 0.65 : 0.4);

    let popText = grade === 'perfect' ? 'PERFECT' : (stepDiff < 0 ? 'GOOD · EARLY' : 'GOOD · LATE');
    if (isGold) popText = `★ ${grade.toUpperCase()} +${gain}`;
    else if (this.feverActive && this.feverTimer > GAME.FEVER_DURATION - 0.25) popText = '⚡ FEVER x2 ⚡';

    this.popup(popText, grade);
    this._syncHud();
  }

  _hitBomb(n) {
    if (n.dead) return;
    n.dead = true;
    this.combo = 0;
    this.healStreak = 0;
    this.bombsHit += 1;
    this.misses += 1;
    this.fever = Math.max(0, this.fever - GAME.FEVER_LOSS_MISS * 1.5);
    if (this.feverActive) {
      this.feverActive = false;
      this.feverTimer = 0;
      this.scene.setFeverVisual?.(false);
    }

    const dmg = this.diffConfig?.bombDamage || 1;
    if (!this.invincible) this.lives = Math.max(0, this.lives - dmg);

    const pos = n.mesh.position.clone();
    const { dir } = this.scene.getSword();
    this.scene.notePool.release(n.mesh);
    const idx = this.notes.indexOf(n);
    if (idx >= 0) this.notes.splice(idx, 1);

    this.physics.splitNote(pos, 0xff2244, dir, this.scene.scene);
    this.fx.burst(pos, 0xff2244, 42);
    this.fx.addShake(0.65);
    this.music?.playMiss?.(true);
    this.onVibrate?.(1.0);
    this.popup('💥 误触炸弹!', 'miss');

    this._syncHud();
    if (!this.invincible && this.lives <= 0) this._end(false);
  }

  _passBomb(n) {
    if (n.dead) return;
    n.dead = true;
    this.bombsDodged += 1;
    this.score += 25;
    this.scene.notePool.release(n.mesh);
    const idx = this.notes.indexOf(n);
    if (idx >= 0) this.notes.splice(idx, 1);
    this._syncHud();
  }

  _miss(n) {
    if (n.dead) return;
    n.dead = true;
    this.combo = 0;
    this.healStreak = 0;
    this.misses += 1;
    this.fever = Math.max(0, this.fever - GAME.FEVER_LOSS_MISS);
    if (!this.invincible) this.lives = Math.max(0, this.lives - 1);

    const pos = n.mesh.position.clone();
    this.scene.notePool.release(n.mesh);
    const idx = this.notes.indexOf(n);
    if (idx >= 0) this.notes.splice(idx, 1);

    this.fx.burst(pos, 0xff5c5c, 12);
    this.fx.addShake(0.42);
    this.music?.playMiss?.(false);
    this.onVibrate?.(0.3);
    this.popup('MISS', 'miss');

    this._syncHud();
    if (!this.invincible && this.lives <= 0) this._end(false);
  }

  _syncHud() {
    this.hud.update({
      score: this.score,
      combo: this.combo,
      lives: this.lives,
      maxLives: this.maxLives,
      invincible: this.invincible,
      perfect: this.perfect,
      good: this.good,
      misses: this.misses,
      fever: this.fever,
      feverActive: this.feverActive,
      mult: computeComboMultiplier(this.combo, this.feverActive),
    });
  }

  finish() {
    if (!this.ended) this._end(true);
  }

  _end(cleared = false) {
    if (this.ended) return;
    this.ended = true;
    this.scene.setFeverVisual?.(false);
    this.music.stop();
    this.music.playClear?.(cleared);
    const total = this.perfect + this.good + this.misses;
    const acc = total ? Math.round((this.perfect + this.good * 0.6) / total * 100) : 0;
    const { rank, badge } = computeRank(acc, this.misses, this.good, total);
    this.onEnd?.({
      cleared,
      rank,
      badge,
      score: this.score,
      maxCombo: this.maxCombo,
      perfect: this.perfect,
      good: this.good,
      misses: this.misses,
      early: this.earlyCount,
      late: this.lateCount,
      acc,
      diff: this.diffConfig?.label || '普通',
    });
  }
}
