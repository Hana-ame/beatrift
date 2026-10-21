import * as THREE from 'three';
import { GAME, DIFFICULTY, DEFAULT_DIFFICULTY } from '../constants.js';
import { createGameScene } from './scene.js';
import { Fx } from './fx.js';
import { ShardPhysics } from './physics.js';
import { Music } from './music.js';
import { Game, loadChart } from './gameplay.js';
import { P } from '../net/protocol.js';
import { showScreen } from '../ui/screens.js';
import { shortestArc, qRotate } from '../../lib/attitude.js';

const INTO = { x: 0, y: -1, z: 0 }; // 屏幕内部方向 (剑尖基准朝此, 水平, 与重力垂直)
const NEUTRAL = { x: 0, y: 0, z: 1 };

// 三首歌 (游戏内可切换), 每首对应一张谱面文件
export const SONGS = [
  { id: 'pulse', name: '霓虹脉冲', file: 'song1', bpm: 128, synth: 'pulse', stars: '★★☆', desc: '均衡电音 · 经典刀流' },
  { id: 'rush', name: '激光冲刺', file: 'song2', bpm: 150, synth: 'rush', stars: '★★★', desc: '高速疾斩 · 连击风暴' },
  { id: 'void', name: '深空回响', file: 'song3', bpm: 96, synth: 'void', stars: '★☆☆', desc: '舒缓空灵 · 精准节奏' },
];

let ctx = null;
let lastDir = NEUTRAL;
let calibState = { mapQ: null, ref: null, flips: { x: 1, y: 1, z: 1 }, top: null };

export function setFront() {
  if (!calibState.top) return;
  calibState.ref = { ...calibState.top };
  calibState.mapQ = shortestArc(calibState.ref, INTO);
}

function applyCalib() {
  const top = calibState.top || NEUTRAL;
  const base = calibState.mapQ ? qRotate(calibState.mapQ, top) : NEUTRAL;
  const rx = calibState.flips.x * base.x;
  const ry = calibState.flips.y * base.y;
  const rz = calibState.flips.z * base.z;
  const len = Math.hypot(rx, ry, rz) || 1;
  return { x: rx / len, y: ry / len, z: rz / len };
}

export function toggleFlip(axis) {
  if (calibState.flips[axis] != null) {
    calibState.flips[axis] *= -1;
  }
}

export function handleMotion(frame) {
  if (!frame || !frame.dir) return;
  calibState.top = frame.dir;
  if (!calibState.mapQ) setFront();
  if (!ctx?.game) return;
  ctx.lastRemoteMotionTs = performance.now();
  const d = applyCalib();
  ctx.game.setSwordDir(d, frame.omega);
  lastDir = d;
  ctx.dirTimerTicks = (ctx.dirTimerTicks || 0) + 1;
  if (frame.hit > 0) ctx.game.onSwing(frame.omega || frame.hit);
}

export function handleControl(msg) {
  if (!msg) return;
  if (msg.t === P.RECALIB) {
    setFront();
    ctx?.popup?.('光剑已设为正面', 'good');
  } else if (msg.t === P.START) {
    if (ctx?.game?.calibrating && ctx?.beginPlay) {
      ctx.beginPlay();
    } else if (ctx?.game?.ended && ctx?.onEndReplay) {
      ctx.onEndReplay();
    } else if (ctx) {
      startGame({
        host: ctx.host,
        roomCode: ctx.roomCode,
        bpm: msg.bpm || ctx.bpm,
        diff: ctx.diff,
        song: ctx.song,
        invincible: ctx.invincible,
        keepCalib: true,
      });
    }
  }
}

function getBestScore(songId, diffId) {
  try {
    return Number(localStorage.getItem(`beatrift_best_${songId}_${diffId}`) || 0);
  } catch {
    return 0;
  }
}

function saveBestScore(songId, diffId, score) {
  try {
    const prev = getBestScore(songId, diffId);
    if (score > prev) {
      localStorage.setItem(`beatrift_best_${songId}_${diffId}`, String(score));
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export async function startGame({
  host,
  roomCode,
  bpm,
  diff,
  calibrate = false,
  keepCalib = false,
  song = 'pulse',
  invincible = GAME.INVINCIBLE,
  solo = false,
}) {
  cleanup();
  const ac = new AbortController();
  const sig = { signal: ac.signal };

  let calibDiff = DIFFICULTY[diff] ? diff : DEFAULT_DIFFICULTY;
  let isInvincible = invincible != null ? !!invincible : !!GAME.INVINCIBLE;
  const selected = SONGS.find((s) => s.id === song) || SONGS[0];

  ctx = {
    host,
    roomCode,
    bpm,
    diff: calibDiff,
    song: selected.id,
    invincible: isInvincible,
    solo,
    ac,
    lastRemoteMotionTs: 0,
  };

  if (!keepCalib) {
    calibState = { mapQ: null, ref: null, flips: { x: 1, y: 1, z: 1 }, top: null };
  }

  let chart = null;
  try {
    chart = await loadChart(selected ? selected.file : 'default');
  } catch (e) {
    console.warn(e);
  }

  const canvas = document.querySelector('#game-canvas');
  const app = createGameScene(canvas);
  const fx = new Fx(app.scene, app.camera);
  const physics = new ShardPhysics();
  const songBpm = chart?.song?.bpm || selected?.bpm || bpm || GAME.BPM;
  const songSynth = chart?.song?.synth || selected?.synth || 'pulse';
  const songName = chart?.song?.name || selected?.name || '霓虹脉冲';
  const music = new Music(songBpm, songSynth);

  const calibSongEl = document.querySelector('#calib-song');
  if (calibSongEl) {
    calibSongEl.textContent = `曲目: ${songName} (${songBpm} BPM · ${chart?.notes?.length || 0} 音符)`;
  }
  const hudSongEl = document.querySelector('#hud-song');
  if (hudSongEl) {
    hudSongEl.textContent = `${songName} · ${DIFFICULTY[calibDiff]?.label || '普通'}`;
  }

  const hud = bindHud(selected.id, () => calibDiff);
  const popup = bindPopup();
  ctx.popup = popup;

  const onEnd = (stats) => {
    const isNewRecord = saveBestScore(selected.id, calibDiff, stats.score);
    const best = getBestScore(selected.id, calibDiff);
    hud.showEnd({ ...stats, songName, best, isNewRecord });
    host?.sendControl({ t: P.END, ...stats, songName, best });
  };

  const onVibrate = (strength) => {
    host?.sendControl({ t: P.VIBRATE, strength });
  };

  const game = new Game({
    scene: app,
    music,
    fx,
    physics,
    popup,
    hud,
    onEnd,
    onVibrate,
    diff: calibDiff,
    invincible: isInvincible,
  });
  if (chart?.notes?.length) game.setChart(chart.notes);
  ctx.game = game;
  ctx.app = app;
  ctx.fx = fx;
  ctx.physics = physics;
  ctx.music = music;

  game.calibrating = !!calibrate;
  if (calibState.top && calibState.mapQ) {
    game.setSwordDir(applyCalib());
  } else {
    game.setSwordDir(solo ? INTO : NEUTRAL);
  }

  const dirEl = document.querySelector('#pc-dir');
  const dirTimer = setInterval(() => {
    if (!dirEl) return;
    const g = ctx?.game;
    const d = ctx?.dirTimerTicks || 0;
    if (ctx) ctx.dirTimerTicks = 0;
    const s = g ? g.swordDir : lastDir;
    dirEl.textContent = `dir(${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) · ${d} 帧/s`;
  }, 1000);
  ctx.dirTimer = dirTimer;

  // 校准面板按钮绑定（使用 AbortController 彻底杜绝重复绑定 bug）
  const calibOv = document.querySelector('#calib-overlay');
  const diffBtns = [...document.querySelectorAll('#calib-overlay .diff-btn')];
  const setDiff = (d) => {
    calibDiff = DIFFICULTY[d] ? d : DEFAULT_DIFFICULTY;
    if (ctx) ctx.diff = calibDiff;
    game.setDifficulty(calibDiff);
    diffBtns.forEach((b) => b.classList.toggle('active', b.dataset.diff === calibDiff));
    if (hudSongEl) hudSongEl.textContent = `${songName} · ${DIFFICULTY[calibDiff]?.label || '普通'}`;
  };
  diffBtns.forEach((b) => b.addEventListener('click', () => setDiff(b.dataset.diff), sig));
  setDiff(calibDiff);

  // 练习无敌开关同步
  const invBtn = calibOv?.querySelector('#calib-invincible');
  const syncInvBtn = () => {
    if (invBtn) {
      invBtn.classList.toggle('on', isInvincible);
      invBtn.textContent = isInvincible ? '模式: 无敌练习 ∞' : `模式: 闯关挑战 (${game.maxLives}♥)`;
    }
  };
  invBtn?.addEventListener('click', () => {
    isInvincible = !isInvincible;
    if (ctx) ctx.invincible = isInvincible;
    game.setInvincible(isInvincible);
    syncInvBtn();
  }, sig);
  syncInvBtn();

  // 同步并绑定反转轴按钮状态
  const markFlip = (axis) => {
    const el = calibOv?.querySelector(`[data-flip="${axis}"]`);
    if (el) el.classList.toggle('on', calibState.flips[axis] < 0);
  };
  ['x', 'y', 'z'].forEach(markFlip);
  calibOv?.querySelectorAll('[data-flip]').forEach((b) => {
    b.addEventListener('click', () => {
      toggleFlip(b.dataset.flip);
      markFlip(b.dataset.flip);
      if (calibState.top) game.setSwordDir(applyCalib());
    }, sig);
  });

  const setFrontBtn = calibOv?.querySelector('#calib-setfront');
  setFrontBtn?.addEventListener('click', () => {
    setFront();
    if (calibState.top) game.setSwordDir(applyCalib());
  }, sig);

  const beginPlay = async () => {
    if (!ctx || !ctx.game) return;
    ctx.calibrating = false;
    ctx.game.calibrating = false;
    if (ctx.app?.noteScreen) ctx.app.noteScreen.visible = false;
    calibOv?.classList.add('hidden');
    document.querySelector('#hud')?.classList.remove('hidden');
    document.querySelector('#end-overlay')?.classList.add('hidden');
    if (chart?.song?.url) await music.loadSong(chart.song.url);
    music.start({ onStep: () => {} });
    game._syncHud();
    host?.sendControl({ t: P.START, bpm: songBpm, songName });
  };
  ctx.beginPlay = beginPlay;

  const startBtn = calibOv?.querySelector('#calib-start');
  startBtn?.addEventListener('click', beginPlay, sig);

  if (calibrate) {
    calibOv?.classList.remove('hidden');
  } else {
    beginPlay();
  }

  const exitToRoom = () => {
    cleanup();
    showScreen('screen-pc');
  };
  const onEndReplay = () =>
    startGame({
      host,
      roomCode,
      bpm,
      diff: calibDiff,
      song: selected.id,
      invincible: isInvincible,
      solo,
      keepCalib: true,
    });
  ctx.onEndReplay = onEndReplay;

  document.querySelector('#hud-exit')?.addEventListener('click', exitToRoom, sig);
  document.querySelector('#end-replay')?.addEventListener('click', onEndReplay, sig);
  document.querySelector('#end-exit')?.addEventListener('click', exitToRoom, sig);

  const hudRecalib = document.querySelector('#hud-recalib');
  hudRecalib?.addEventListener('click', () => {
    setFront();
    popup('已重设光剑正面', 'good');
  }, sig);

  const hudMute = document.querySelector('#hud-mute');
  if (hudMute) {
    hudMute.textContent = music.muted ? '🔇 静音' : '🔊 音效';
    hudMute.addEventListener('click', () => {
      const m = music.toggleMuted();
      hudMute.textContent = m ? '🔇 静音' : '🔊 音效';
    }, sig);
  }

  // PC 端鼠标/触控直接操控光剑支持（当没有手机实时流或处于单机模式时自动生效，兼顾单机试玩与双端体感）
  const onPointerMove = (e) => {
    if (!ctx?.game) return;
    // 若最近 400ms 内有手机 WebRTC 体感帧到达且非单机模式，以手机陀螺仪为准
    if (!solo && performance.now() - (ctx.lastRemoteMotionTs || 0) < 400) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const nz = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    // 将屏幕归一化坐标映射到判定平面 (x: -3.0..3.0, y: -4.4, z: 0.1..3.2)
    const targetX = nx * 3.0;
    const targetZ = 1.65 + nz * 1.6;
    const pivot = { x: 0, y: 0.5, z: 1.4 };
    const dx = targetX - pivot.x;
    const dy = GAME.NOTE_PLANE_Y - pivot.y;
    const dz = targetZ - pivot.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    ctx.game.setSwordDir(dir, 3.5);
    lastDir = dir;
    ctx.dirTimerTicks = (ctx.dirTimerTicks || 0) + 1;
  };
  const onPointerDown = (e) => {
    if (!ctx?.game || ctx.game.calibrating || ctx.game.ended) return;
    onPointerMove(e);
    ctx.game.onSwing(5.0);
  };
  const onKeyDown = (e) => {
    if (!ctx?.game) return;
    if (e.code === 'KeyR') {
      setFront();
      popup('已重设正面 (R)', 'good');
    } else if (e.code === 'KeyM') {
      const m = music.toggleMuted();
      if (hudMute) hudMute.textContent = m ? '🔇 静音' : '🔊 音效';
    } else if (e.code === 'Space' && !ctx.game.calibrating && !ctx.game.ended) {
      ctx.game.onSwing(5.0);
    }
  };
  canvas.addEventListener('pointermove', onPointerMove, sig);
  canvas.addEventListener('pointerdown', onPointerDown, sig);
  window.addEventListener('keydown', onKeyDown, sig);

  const clock = new THREE.Clock();
  let camT = new THREE.Vector3(0, -3.6, 1.6);
  const camPosOffset = new THREE.Vector3(0, 0.35, 0.6);
  const followView = (dt) => {
    const { pivot, dir } = app.getSword();
    const base = new THREE.Vector3(0, -3.6, 1.6);
    const aim = pivot.clone().addScaledVector(dir, 10);
    const desired = base.clone().lerp(aim, 0.45);
    const s = 1 - Math.exp(-dt * 4.5);
    camT.lerp(desired, s);
    app.camera.position.copy(pivot).add(camPosOffset);
    app.camera.lookAt(camT);
  };
  const loop = () => {
    if (!ctx) return;
    ctx.raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    physics.update(dt, app.scene);
    fx.update(dt);
    game.update(dt);
    followView(dt);
    fx.applyShake(app.camera);
    app.renderer.render(app.scene, app.camera);
  };
  loop();

  if (typeof window !== 'undefined') {
    window.__beatriftDebug = {
      getGame: () => ctx?.game,
      getMusic: () => ctx?.music,
      handleMotion,
      setFront,
      toggleFlip,
    };
  }
}

export function cleanup() {
  if (!ctx) return;
  if (ctx.raf) cancelAnimationFrame(ctx.raf);
  if (ctx.dirTimer) clearInterval(ctx.dirTimer);
  ctx.ac?.abort?.();
  ctx.game?.notes?.forEach?.((n) => ctx.app?.notePool?.release?.(n.mesh));
  ctx.physics?.dispose?.(ctx.app?.scene);
  ctx.fx?.dispose?.();
  ctx.app?.dispose?.();
  ctx.music?.dispose?.();
  document.querySelector('#hud')?.classList.add('hidden');
  document.querySelector('#calib-overlay')?.classList.add('hidden');
  document.querySelector('#end-overlay')?.classList.add('hidden');
  ctx = null;
}

function bindHud(songId, getDiff) {
  const els = {
    score: document.querySelector('#score'),
    combo: document.querySelector('#combo'),
    lives: document.querySelector('#lives'),
    acc: document.querySelector('#hud-acc'),
    mult: document.querySelector('#hud-mult'),
    feverFill: document.querySelector('#hud-fever-fill'),
    progressFill: document.querySelector('#hud-progress-fill'),
  };
  let lastSend = 0;
  return {
    update({ score, combo, lives, maxLives = GAME.LIVES, invincible = false, perfect, good, misses, fever = 0, feverActive = false, mult = 1 }) {
      if (els.score) els.score.textContent = score;
      if (els.combo) {
        els.combo.textContent = combo > 0 ? `${combo} COMBO` : '0';
        els.combo.classList.remove('pop');
        if (combo > 0) {
          void els.combo.offsetWidth;
          els.combo.classList.add('pop');
        }
      }
      if (els.lives) {
        els.lives.textContent = invincible
          ? '∞'
          : '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, maxLives - lives));
      }
      const total = perfect + good + misses;
      const accVal = total ? Math.round((perfect + good * 0.6) / total * 100) : null;
      if (els.acc) {
        els.acc.textContent = accVal != null ? `命中率 ${accVal}% · P:${perfect} G:${good} M:${misses}` : '命中率 --';
      }
      if (els.mult) {
        els.mult.textContent = feverActive ? `⚡ FEVER x${mult.toFixed(1)}` : `x${mult.toFixed(1)}`;
        els.mult.classList.toggle('fever', !!feverActive);
      }
      if (els.feverFill) {
        els.feverFill.style.width = `${Math.round(Math.min(100, Math.max(0, fever)))}%`;
        els.feverFill.classList.toggle('active', !!feverActive);
      }

      const now = performance.now();
      if (now - lastSend > 220) {
        lastSend = now;
        ctx?.host?.sendControl({
          t: P.STATE,
          score,
          combo,
          lives: invincible ? '∞' : lives,
          acc: accVal ?? 100,
          fever: Math.round(fever),
          feverActive,
        });
      }
    },
    updateProgress({ progress, fever, feverActive, mult }) {
      if (els.progressFill) {
        els.progressFill.style.width = `${Math.round(progress * 100)}%`;
      }
      if (els.feverFill && fever != null) {
        els.feverFill.style.width = `${Math.round(Math.min(100, Math.max(0, fever)))}%`;
        els.feverFill.classList.toggle('active', !!feverActive);
      }
      if (els.mult && mult != null) {
        els.mult.textContent = feverActive ? `⚡ FEVER x${mult.toFixed(1)}` : `x${mult.toFixed(1)}`;
        els.mult.classList.toggle('active', !!feverActive);
      }
    },
    showEnd(stats) {
      const titleEl = document.querySelector('#end-title');
      if (titleEl) {
        titleEl.textContent = stats.cleared ? '🎉 曲目完成 · STAGE CLEAR' : '💥 护盾耗尽 · 游戏结束';
      }
      const rankEl = document.querySelector('#end-rank');
      if (rankEl) {
        rankEl.textContent = stats.badge ? `${stats.rank} · ${stats.badge}` : `评级 ${stats.rank || 'A'}`;
        rankEl.className = `end-rank rank-${(stats.rank || 'A').toLowerCase()}`;
      }
      const scoreEl = document.querySelector('#end-score');
      if (scoreEl) scoreEl.textContent = stats.score;
      const statsEl = document.querySelector('#end-stats');
      if (statsEl) {
        const recordTag = stats.isNewRecord ? ' 🏆 新纪录!' : (stats.best ? ` (最高 ${stats.best})` : '');
        statsEl.textContent =
          `最高连击 ${stats.maxCombo} · PERFECT ${stats.perfect} · GOOD ${stats.good} (早${stats.early || 0}/晚${stats.late || 0}) · MISS ${stats.misses} · 命中率 ${stats.acc}%${recordTag}`;
      }
      document.querySelector('#end-overlay')?.classList.remove('hidden');
    },
  };
}

function bindPopup() {
  const el = document.querySelector('#hud-pop');
  let timer = 0;
  return (text, cls) => {
    if (!el) return;
    el.textContent = text;
    el.className = `hud-pop ${cls}`;
    el.classList.remove('hidden', 'fade');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.classList.remove('pop');
      el.classList.add('fade');
    }, 280);
  };
}