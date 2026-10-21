export const MQTT = {
  URL: 'wss://broker.hivemq.com:8884/mqtt',
  ROOM_TOPIC: 'beatrift/rooms',
};

export const PEER_PREFIX = 'beatrift';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 5;

export const SENSOR = {
  HZ: 60,
  SWING_PEAK: 3.2,
  SWING_MIN: 1.2,
  SWING_COOLDOWN_MS: 150,
};

export const SWORD = {
  PIVOT: { x: 0, y: 0.5, z: 1.4 },
  LEN: 5.6,
  OFFSET: 0.7,
};

// 难度与挥动速度完全解耦（纯接触判定），通过判定半径、时机窗口、飞行速度倍率、生命恢复与得分倍率体现平衡
export const DIFFICULTY = {
  easy: {
    id: 'easy',
    label: '简单',
    desc: '宽松判定 · 慢速适应 · 5 格护盾',
    hitRadius: 1.55,
    hitSteps: 5.5,
    perfectSteps: 2.5,
    missSteps: 6.5,
    speedScale: 0.85,
    scoreMult: 0.85,
    maxLives: 5,
    healEvery: 8,
    bombDamage: 1,
  },
  normal: {
    id: 'normal',
    label: '普通',
    desc: '标准节奏 · 均衡挑战 · 4 格护盾',
    hitRadius: 1.25,
    hitSteps: 4.5,
    perfectSteps: 2.0,
    missSteps: 5.5,
    speedScale: 1.0,
    scoreMult: 1.0,
    maxLives: 4,
    healEvery: 10,
    bombDamage: 1,
  },
  hard: {
    id: 'hard',
    label: '困难',
    desc: '精准走位 · 高速音流 · 3 格护盾',
    hitRadius: 1.02,
    hitSteps: 3.5,
    perfectSteps: 1.5,
    missSteps: 4.5,
    speedScale: 1.2,
    scoreMult: 1.25,
    maxLives: 3,
    healEvery: 14,
    bombDamage: 1,
  },
  master: {
    id: 'master',
    label: '大师',
    desc: '极限判定 · 疾速风暴 · 1.5x 得分',
    hitRadius: 0.85,
    hitSteps: 2.6,
    perfectSteps: 1.15,
    missSteps: 3.5,
    speedScale: 1.38,
    scoreMult: 1.5,
    maxLives: 3,
    healEvery: 18,
    bombDamage: 2,
  },
};
export const DEFAULT_DIFFICULTY = 'normal';

export const GAME = {
  BPM: 128,
  BEATS_PER_BAR: 4,
  NOTE_PLANE_Y: -4.4,
  NOTE_SPAWN_Y: -56,
  NOTE_SPEED: 13.5,
  NOTE_LIFETIME: 9999,
  HIT_WINDOW_Y: 2.4,
  MISS_Y: 4.2,
  LIVES: 4,
  INVINCIBLE: false,
  FEVER_MAX: 100,
  FEVER_DURATION: 8.0,
  FEVER_GAIN_PERFECT: 9,
  FEVER_GAIN_GOOD: 4,
  FEVER_GAIN_GOLD: 18,
  FEVER_LOSS_MISS: 18,
};

export function genRoomCode() {
  let s = '';
  const arr = new Uint32Array(1);
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    crypto.getRandomValues(arr);
    s += ROOM_CODE_ALPHABET[arr[0] % ROOM_CODE_ALPHABET.length];
  }
  return s;
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);
}
