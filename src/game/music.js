import { GAME } from '../constants.js';

const STEPS_PER_BAR = 16;
const BARS = 4;
const PATTERN_LEN = STEPS_PER_BAR * BARS;
const LOOKAHEAD = 0.12;
const TIMER_MS = 20;

const F = {
  A2: 110, A3: 220, A4: 440, C3: 130.81, C4: 261.63, E3: 164.81, E4: 329.63,
  F2: 87.31, F3: 174.61, F4: 349.23, G2: 98, G3: 196, G4: 392,
  B3: 246.94, D4: 293.66, D2: 73.42, E2: 82.41, G2b: 92.5, D3: 146.83, A2d: 103.83,
};

const PENTA = [F.A3, F.C4, F.D4, F.E4, F.G4, F.A4, 0, F.G4, F.E4, F.D4, F.C4, F.A3];
const PENTA_DARK = [F.A3, F.C4, F.E4, F.G3, F.B3, F.D4, 0, F.D4, F.B3, F.G3, F.E4, F.C4];
const PENTA_DEEP = [F.D3, F.F3, F.A3, F.C4, F.E4, 0, F.E4, F.C4, F.A3, F.F3, F.D3];

// 三首歌 = 三种合成风格, 每首有独立的和声/旋律/节奏密度
const STYLES = {
  pulse: {
    chords: [
      [F.A2, F.A3, F.C4, F.E4],
      [F.F2, F.F3, F.A3, F.C4],
      [F.C3, F.C4, F.E4, F.G4],
      [F.G2, F.G3, F.B3, F.D4],
    ],
    penta: PENTA,
    hatEvery: 2,       // 16分step里每几个一踩(2=半拍)
    arpDensity: [1, 1, 2, 2],
    bassEvery: 2,
    bassOctave: 0,
  },
  rush: {
    chords: [
      [F.A2, F.A3, F.C4, F.E4],
      [F.E2, F.E3, F.G3, F.B3],
      [F.F2, F.F3, F.A3, F.C4],
      [F.G2, F.G3, F.B3, F.D4],
    ],
    penta: PENTA_DARK,
    hatEvery: 1,       // 16分踩镲, 更碎
    arpDensity: [2, 2, 3, 3],
    bassEvery: 2,
    bassOctave: 1,
  },
  void: {
    chords: [
      [F.D2, F.D3, F.F3, F.A3],
      [F.A2, F.A3, F.C4, F.E4],
      [F.G2, F.G3, F.B3, F.D4],
      [F.C3, F.C4, F.E4, F.G4],
    ],
    penta: PENTA_DEEP,
    hatEvery: 4,       // 稀疏
    arpDensity: [0, 1, 1, 2],
    bassEvery: 4,
    bassOctave: 0,
  },
};

function buildPattern(styleName) {
  const st = STYLES[styleName] || STYLES.pulse;
  const steps = Array.from({ length: PATTERN_LEN }, () => []);
  const step = (i, e) => steps[i % PATTERN_LEN].push(e);

  for (let bar = 0; bar < BARS; bar++) {
    const base = bar * STEPS_PER_BAR;

    for (let s = 0; s < STEPS_PER_BAR; s++) {
      // 四踩底鼓 + 填充
      if (s % 4 === 0) step(base + s, { type: 'kick' });
      if (bar === 3 && s === 14) step(base + s, { type: 'kick' });

      // 军鼓 on 2 & 4
      if (s === 4 || s === 12) step(base + s, { type: 'snare' });

      // 踩镲按风格密度
      if (s % st.hatEvery === 0) step(base + s, { type: 'hat' });
      if (s === 14 && (bar % 2 === 0)) step(base + s, { type: 'hat-open' });
    }

    // 贝斯
    const [root, fifth] = [st.chords[bar][0], st.chords[bar][2] / 2 / Math.pow(2, st.bassOctave)];
    for (let s = 0; s < STEPS_PER_BAR; s += st.bassEvery) {
      step(base + s, { type: 'bass', note: s % 4 === 2 ? fifth : root });
    }

    // 琶音旋律
    const density = st.arpDensity[Math.min(bar, st.arpDensity.length - 1)];
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      if (s % Math.max(1, 4 / density) === 0 && Math.random() < 0.85) {
        step(base + s, { type: 'arp', note: st.penta[(s + bar * 3) % st.penta.length], bar });
      }
    }
  }
  return steps;
}

export class Music {
  constructor(bpm = GAME.BPM, style = 'pulse') {
    this.bpm = bpm;
    this.style = style;
    this.pattern = buildPattern(style);
    this.ctx = null;
    this.master = null;
    this.started = false;
    this.muted = false;
    this._timer = null;
    this._nextStep = 0;
    this._nextTime = 0;
    this._onStep = null;
    this._onBar = null;
    this._startCtxTime = 0;
    this.songTime = 0;
    this.songBuffer = null;
    this.songUrl = null;
    this._songSource = null;
  }

  start({ onStep, onBar } = {}) {
    this._onStep = onStep || null;
    this._onBar = onBar || null;

    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume();

    this.started = true;
    this._nextStep = 0;
    this._nextTime = this.ctx.currentTime + 0.06;
    this._startCtxTime = this.ctx.currentTime;

    // 有真实音频(外链下载)就播放它, 否则走合成模式
    if (this.songBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.songBuffer;
      src.loop = true;
      src.connect(this.master);
      src.start(this._nextTime);
      this._songSource = src;
    }

    this._timer = setInterval(() => this._tick(), TIMER_MS);
  }

  // 在线下载/外链方式加载并解码歌曲; 失败返回 false, 调用方回退合成
  async loadSong(url) {
    this.songUrl = url;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
    }
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`song fetch ${res.status}`);
      const buf = await res.arrayBuffer();
      const audio = await this.ctx.decodeAudioData(buf);
      this.songBuffer = audio;
      return true;
    } catch (e) {
      console.warn('[music] 外链加载失败, 回退合成:', e.message);
      this.songBuffer = null;
      return false;
    }
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.started = false;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }

  beatFromTime(t) {
    if (!this.ctx) return 0;
    return (t - this._startCtxTime) * (this.bpm / 60);
  }

  stepFromTime(t) {
    return this.beatFromTime(t) * 4;
  }

  get currentBeat() {
    return this.ctx ? this.beatFromTime(this.ctx.currentTime) : 0;
  }

  get currentStep() {
    return this.ctx ? this.stepFromTime(this.ctx.currentTime) : 0;
  }

  _tick() {
    if (!this.started) return;
    while (this._nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this._scheduleStep(this._nextStep, this._nextTime);
      const wasBarStart = this._nextStep % STEPS_PER_BAR === 0;
      this._onStep?.({ step: this._nextStep, time: this._nextTime, patternStep: this._nextStep % PATTERN_LEN });
      if (wasBarStart) this._onBar?.(this._nextStep / STEPS_PER_BAR);
      this._nextStep += 1;
      this._nextTime += 60 / this.bpm / 4;
    }
  }

  _scheduleStep(step, t) {
    if (this._songSource) return; // 有真实歌曲时静音合成器
    const events = this.pattern[step % PATTERN_LEN];
    for (const e of events) {
      switch (e.type) {
        case 'kick': this._kick(t); break;
        case 'snare': this._snare(t); break;
        case 'hat': this._hat(t, false); break;
        case 'hat-open': this._hat(t, true); break;
        case 'bass': this._bass(t, e.note); break;
        case 'arp': this._arp(t, e.note); break;
      }
    }
  }

  _env(node, t, a, d, peak) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    o.connect(g).connect(this.master);
    this._env(g, t, 0.002, 0.13, 1.0);
    o.start(t);
    o.stop(t + 0.19);
  }

  _snare(t) {
    const n = this.ctx.createBufferSource();
    n.buffer = this._noiseBuf();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    n.connect(bp).connect(g).connect(this.master);
    this._env(g, t, 0.002, 0.16, 0.7);
    n.start(t);
    n.stop(t + 0.22);

    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    o.connect(og).connect(this.master);
    this._env(og, t, 0.002, 0.07, 0.5);
    o.start(t);
    o.stop(t + 0.12);
  }

  _hat(t, open) {
    const n = this.ctx.createBufferSource();
    n.buffer = this._noiseBuf();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6500 : 8500;
    const g = this.ctx.createGain();
    n.connect(hp).connect(g).connect(this.master);
    this._env(g, t, 0.001, open ? 0.25 : 0.05, open ? 0.35 : 0.3);
    n.start(t);
    n.stop(t + (open ? 0.32 : 0.09));
  }

  _bass(t, freq) {
    if (!isFinite(freq)) return;
    const o = this.ctx.createOscillator();
    const lpf = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(1200, t);
    lpf.frequency.exponentialRampToValueAtTime(250, t + 0.09);
    o.connect(lpf).connect(g).connect(this.master);
    this._env(g, t, 0.004, 0.18, 0.5);
    o.start(t);
    o.stop(t + 0.24);
  }

  _arp(t, freq) {
    if (!freq) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.connect(g).connect(this.master);
    this._env(g, t, 0.005, 0.14, 0.18);
    o.start(t);
    o.stop(t + 0.2);
  }

  _noiseBuf() {
    if (!this._noise) {
      const len = this.ctx.sampleRate * 0.3;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }
}
