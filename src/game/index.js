import * as THREE from 'three';
import { GAME, DIFFICULTY } from '../constants.js';
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
  { id: 'pulse', name: '霓虹脉冲', file: 'song1', bpm: 128, synth: 'pulse' },
  { id: 'rush', name: '激光冲刺', file: 'song2', bpm: 150, synth: 'rush' },
  { id: 'void', name: '深空回响', file: 'song3', bpm: 96, synth: 'void' },
];

let ctx = null;
let lastDir = NEUTRAL;
let calibState = { mapQ: null, refTop: null, flips: { x: 1, y: 1, z: 1 }, top: null };

function setFront() {
  if (!calibState.top) return;
  calibState.ref = calibState.top;
  calibState.mapQ = shortestArc(calibState.ref, INTO);
}

function applyCalib() {
  const top = calibState.top || NEUTRAL;
  const base = calibState.mapQ ? qRotate(calibState.mapQ, top) : NEUTRAL;
  return { x: calibState.flips.x * base.x, y: calibState.flips.y * base.y, z: calibState.flips.z * base.z };
}

function toggleFlip(axis) {
  calibState.flips[axis] *= -1;
}

export function handleMotion(frame) {
  if (!frame) return;
  calibState.top = frame.dir;
  if (!calibState.mapQ) setFront();
  if (!ctx?.game) return;
  const d = applyCalib();
  ctx.game.setSwordDir(d, frame.omega);
  lastDir = d;
  ctx.dirTimerTicks = (ctx.dirTimerTicks || 0) + 1;
  if (frame.hit > 0) ctx.game.onSwing(frame.omega || frame.hit);
}

export function handleControl(msg) {
  if (!msg) return;
  if (msg.t === P.START) startGame({ host: ctx?.host, roomCode: ctx?.roomCode, bpm: msg.bpm });
}

export async function startGame({ host, roomCode, bpm, diff, calibrate = false, keepCalib = false, song }) {
  cleanup();
  ctx = { host, roomCode, bpm };
  if (!keepCalib) calibState = { mapQ: null, ref: null, flips: { x: 1, y: 1, z: 1 }, top: null };
  let calibDiff = diff ?? 'normal';

  const selected = SONGS.find((s) => s.id === song) || null;
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
  const music = new Music(songBpm, songSynth);
  const calibSongEl = document.querySelector('#calib-song');
  if (calibSongEl) calibSongEl.textContent = `歌曲: ${chart?.song?.name || selected?.name || '默认'}`;
  const hud = bindHud();
  const popup = bindPopup();

  const onEnd = (stats) => {
    hud.showEnd(stats);
    host?.sendControl({ t: P.END, ...stats });
  };

  const game = new Game({ scene: app, music, fx, physics, popup, hud, onEnd, diff: calibDiff });
  if (chart?.notes?.length) game.setChart(chart.notes);
  ctx.game = game;
  ctx.app = app;
  ctx.fx = fx;
  ctx.physics = physics;
  ctx.music = music;

  game.calibrating = !!calibrate;
  game.setSwordDir(NEUTRAL);

  const dirEl = document.querySelector('#pc-dir');
  const dirTimer = setInterval(() => {
    if (!dirEl) return;
    const g = ctx?.game;
    const d = ctx.dirTimerTicks || 0;
    ctx.dirTimerTicks = 0;
    const s = g ? g.swordDir : lastDir;
    dirEl.textContent = `dir(${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) · ${d} 帧/s`;
  }, 1000);
  ctx.dirTimer = dirTimer;

  const calibOv = document.querySelector('#calib-overlay');
  const diffBtns = [...document.querySelectorAll('#calib-overlay .diff-btn')];
  const setDiff = (d) => {
    calibDiff = DIFFICULTY[d] ? d : null;
    game.setDifficulty(calibDiff);
    diffBtns.forEach((b) => b.classList.toggle('active', b.dataset.diff === calibDiff));
  };
  diffBtns.forEach((b) => b.addEventListener('click', () => setDiff(b.dataset.diff)));
  setDiff(calibDiff);
  const markFlip = (axis) => {
    const el = calibOv?.querySelector(`[data-flip="${axis}"]`);
    if (el) el.classList.toggle('on', calibState.flips[axis] < 0);
  };
  calibOv?.querySelectorAll('[data-flip]').forEach((b) => {
    b.addEventListener('click', () => {
      toggleFlip(b.dataset.flip);
      markFlip(b.dataset.flip);
    });
  });
  const setFrontBtn = calibOv?.querySelector('#calib-setfront');
  setFrontBtn?.addEventListener('click', () => { setFront(); });

  const beginPlay = async () => {
    if (!ctx) return;
    ctx.calibrating = false;
    if (ctx.game) ctx.game.calibrating = false;
    calibOv?.classList.add('hidden');
    document.querySelector('#hud').classList.remove('hidden');
    document.querySelector('#end-overlay').classList.add('hidden');
    // 外链歌曲: 先在线下载/解码; 失败自动回退合成(loadSong 内部处理)
    if (chart?.song?.url) await music.loadSong(chart.song.url);
    music.start({ onStep: () => {} });
    hud.update({ score: 0, combo: 0, lives: GAME.LIVES, perfect: 0, good: 0, misses: 0 });
    host?.sendControl({ t: P.START, bpm: songBpm });
  };
  const startBtn = calibOv?.querySelector('#calib-start');
  startBtn?.addEventListener('click', beginPlay);

  if (calibrate) calibOv?.classList.remove('hidden');
  // 不需要校准(如"再来一次"/房间直接开始)时立即开打
  if (!calibrate) beginPlay();

  const exitToRoom = () => {
    cleanup();
    showScreen('screen-pc');
  };
  const hudExit = document.querySelector('#hud-exit');
  const onHudExit = () => exitToRoom();
  hudExit?.addEventListener('click', onHudExit);
  const endReplay = document.querySelector('#end-replay');
  const onEndReplay = () => startGame({ host, roomCode, bpm, diff: calibDiff, keepCalib: true });
  endReplay?.addEventListener('click', onEndReplay);
  const endExit = document.querySelector('#end-exit');
  const onEndExit = () => exitToRoom();
  endExit?.addEventListener('click', onEndExit);

  const clock = new THREE.Clock();
  let raf = 0;
  let camT = new THREE.Vector3(0, -3.6, 1.6);
  const camPosOffset = new THREE.Vector3(0, 0.35, 0.6);
  const followView = (dt) => {
    const { pivot, dir } = app.getSword();
    const base = new THREE.Vector3(0, -3.6, 1.6);
    const aim = pivot.clone().addScaledVector(dir, 10);
    const desired = base.clone().lerp(aim, 0.5);
    const s = 1 - Math.exp(-dt * 4.5);
    camT.lerp(desired, s);
    app.camera.position.copy(pivot).add(camPosOffset);
    app.camera.lookAt(camT);
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    physics.update(dt, app.scene);
    fx.update(dt);
    game.update(dt);
    followView(dt);
    app.renderer.render(app.scene, app.camera);
  };
  ctx.raf = raf;
  loop();

  ctx.cleanupButtons = () => {
    calibOv?.querySelector('#calib-start')?.removeEventListener('click', beginPlay);
    calibOv?.querySelectorAll('[data-flip]').forEach((b) => b.removeEventListener('click', b._f));
    diffBtns.forEach((b) => b.removeEventListener('click', b._f));
    calibOv?.querySelector('#calib-setfront')?.removeEventListener('click', () => {});
    document.querySelector('#hud-exit')?.removeEventListener('click', onHudExit);
    document.querySelector('#end-replay')?.removeEventListener('click', onEndReplay);
    document.querySelector('#end-exit')?.removeEventListener('click', onEndExit);
  };

  window.__beatriftDebug = {
    getGame: () => ctx?.game,
    getMusic: () => ctx?.music,
    handleMotion,
    setFront,
    toggleFlip,
  };
}

export function cleanup() {
  if (!ctx) return;
  cancelAnimationFrame(ctx.raf);
  if (ctx.dirTimer) clearInterval(ctx.dirTimer);
  ctx.game?.notes?.forEach?.((n) => ctx.app?.notePool?.release?.(n.mesh));
  ctx.physics?.dispose?.(ctx.app?.scene);
  ctx.app?.dispose?.();
  ctx.music?.stop?.();
  ctx.cleanupButtons?.();
  document.querySelector('#hud')?.classList.add('hidden');
  document.querySelector('#calib-overlay')?.classList.add('hidden');
  document.querySelector('#end-overlay')?.classList.add('hidden');
  ctx = null;
}

function bindHud() {
  const els = {
    score: document.querySelector('#score'),
    combo: document.querySelector('#combo'),
    lives: document.querySelector('#lives'),
    acc: document.querySelector('#hud-acc'),
  };
  let lastSend = 0;
  return {
    update({ score, combo, lives, perfect, good, misses }) {
      els.score.textContent = score;
      els.combo.textContent = combo > 0 ? `${combo} COMBO` : '0';
      els.combo.classList.remove('pop');
      if (combo > 0) void els.combo.offsetWidth, els.combo.classList.add('pop');
      els.lives.textContent = GAME.INVINCIBLE ? '∞' : '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, GAME.LIVES - lives));
      const total = perfect + good + misses;
      els.acc.textContent = total ? `命中率 ${Math.round((perfect + good * 0.6) / total * 100)}%` : '命中率 --';

      const now = performance.now();
      if (now - lastSend > 250) {
        lastSend = now;
        ctx?.host?.sendControl({ t: P.STATE, score, combo, lives });
      }
    },
    showEnd(stats) {
      document.querySelector('#end-title').textContent = '游戏结束';
      document.querySelector('#end-score').textContent = stats.score;
      document.querySelector('#end-stats').textContent =
        `最高连击 ${stats.maxCombo} · PERFECT ${stats.perfect} · GOOD ${stats.good} · MISS ${stats.misses} · 命中率 ${stats.acc}%`;
      document.querySelector('#end-overlay').classList.remove('hidden');
    },
  };
}

function bindPopup() {
  const el = document.querySelector('#hud-pop');
  let timer = 0;
  return (text, cls) => {
    el.textContent = text;
    el.className = `hud-pop ${cls}`;
    el.classList.remove('hidden', 'fade');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.classList.remove('pop');
      el.classList.add('fade');
    }, 260);
  };
}