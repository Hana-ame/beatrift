import { showScreen, navigate, $ } from './screens.js';
import { normalizeCode, PEER_PREFIX, SENSOR } from '../constants.js';
import * as discovery from '../net/discovery.js';
import { joinPeer } from '../net/connection.js';
import { P, encodeMotion } from '../net/protocol.js';
import { Sensor } from '../motion/sensor.js';

export function initMobile(params) {
  const ac = new AbortController();
  const sig = { signal: ac.signal };

  const els = {
    list: $('#mobile-list'),
    code: $('#mobile-code'),
    join: $('#mobile-join'),
    remoteStatus: $('#remote-status'),
    ping: $('#remote-ping'),
    score: $('#remote-score'),
    combo: $('#remote-combo'),
    lives: $('#remote-lives'),
    recalib: $('#remote-recalib'),
    startBtn: $('#remote-start'),
    vibrateBtn: $('#remote-vibrate'),
  };
  const known = new Map();
  let sess = null;
  let sensor = null;
  let streaming = false;
  let unsubscribe = null;
  let pingTimer = null;
  let staleTimer = null;

  if (params?.get('room') && els.code) {
    els.code.value = normalizeCode(params.get('room'));
  }

  function renderList() {
    if (!els.list) return;
    if (known.size === 0) {
      els.list.innerHTML = '<div class="mobile-empty">未发现房间 · 尝试输入房间码</div>';
      return;
    }
    els.list.innerHTML = '';
    for (const [code] of known) {
      const row = document.createElement('div');
      row.className = 'device-item';
      row.innerHTML = `<span>房间 <b>${code}</b></span><span class="dot on"></span>`;
      row.addEventListener('click', () => doJoin(code));
      els.list.appendChild(row);
    }
  }

  function cleanupStale() {
    const now = Date.now();
    for (const [code, dev] of known) {
      if (now - dev.ts > 6000) known.delete(code);
    }
    renderList();
  }

  async function initDiscovery() {
    const ok = await discovery.connect();
    if (!ok) {
      if (els.list) els.list.innerHTML = '<div class="mobile-empty">发现服务不可用 · 请直接输入房间码</div>';
      return;
    }
    unsubscribe = discovery.subscribeRooms((code, dev) => {
      if (!dev?.peerId) return;
      known.set(code, { ...dev, ts: Date.now() });
      renderList();
    });
    clearInterval(staleTimer);
    staleTimer = setInterval(cleanupStale, 2000);
  }

  function handlers() {
    return {
      onOpen() {},
      onControl(msg) {
        if (!msg) return;
        if (msg.t === P.PING) {
          sess?.sendControl({ t: P.PONG, ts: msg.ts });
        } else if (msg.t === P.PONG) {
          const dt = Date.now() - msg.ts;
          if (els.ping) els.ping.textContent = `${dt} ms`;
        } else if (msg.t === P.START) {
          sensor?.calibrate?.();
          if (els.remoteStatus) {
            els.remoteStatus.textContent = `游戏中${msg.songName ? ' · ' + msg.songName : ''} · 挥舞手机切割音符`;
          }
          sensor?.vibrate(0.4);
        } else if (msg.t === P.STATE) {
          if (els.score && msg.score != null) els.score.textContent = msg.score;
          if (els.combo && msg.combo != null) els.combo.textContent = msg.combo;
          if (els.lives && msg.lives != null) els.lives.textContent = msg.lives;
        } else if (msg.t === P.END) {
          if (els.score && msg.score != null) els.score.textContent = msg.score;
          if (els.combo && msg.maxCombo != null) els.combo.textContent = `最高 ${msg.maxCombo}`;
          if (els.remoteStatus) {
            els.remoteStatus.textContent = msg.cleared
              ? `🎉 曲目完成 (${msg.rank || 'S'}) · 得分 ${msg.score}`
              : `游戏结束 · 得分 ${msg.score} (命中率 ${msg.acc}%)`;
          }
          sensor?.vibrate(0.9);
        } else if (msg.t === P.VIBRATE) {
          sensor?.vibrate(msg.strength ?? 0.6);
        }
      },
      onMotionOpen() {
        if (streaming) startStream();
      },
      onClose() {
        if (els.remoteStatus) els.remoteStatus.textContent = '连接已断开';
      },
      onError(e) { console.error('[mobile] conn error', e); },
    };
  }

  function pingLoop() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (sess) sess.sendControl({ t: P.PING, ts: Date.now() });
    }, 1000);
  }

  // 手机只负责把"手机顶边在世界系的方向"(全 3D, 原始值)持续发给 PC。
  // 校准(反转/设正面/难度)全部在 PC 端进行, 手机端也可一键发送 P.RECALIB 触发 PC 设为正面。
  function onFrame(f) {
    if (!streaming || !sess || !sensor.top) return;
    sess.sendMotion(encodeMotion(sensor.top, f.omega, 0));
  }
  function onSwing(s) {
    sensor.vibrate(s.omega / (SENSOR.SWING_PEAK * 2));
    if (streaming && sess && sensor.top) sess.sendMotion(encodeMotion(sensor.top, s.omega, 1));
  }

  function startStream() {
    streaming = true;
  }

  async function enterRemote() {
    const granted = await sensor.requestPermission();
    if (!granted) {
      if (els.remoteStatus) els.remoteStatus.textContent = '传感器权限被拒绝';
      return;
    }
    if (!sensor.enabled) {
      sensor.start((f) => onFrame(f), (s) => onSwing(s));
    }
    sess.sendControl({ t: P.READY });
    showScreen('screen-remote');
    if (els.remoteStatus) els.remoteStatus.textContent = '已连接 · 请在 PC 上校准光剑';
    startStream();
  }

  async function doJoin(code, attempt = 0) {
    code = normalizeCode(code);
    if (!code) return;
    showScreen('screen-remote');
    if (els.remoteStatus) {
      els.remoteStatus.textContent = attempt > 0 ? `重连中 (${attempt}/2)…` : '正在连接…';
    }
    try {
      sess = await joinPeer(`${PEER_PREFIX}-${code}`, handlers());
      sess.sendControl({ t: P.HELLO, v: 1, role: 'mobile' });
      pingLoop();
      enterRemote();
    } catch (e) {
      console.error(e);
      if (attempt < 2) {
        setTimeout(() => doJoin(code, attempt + 1), 700);
        return;
      }
      if (els.remoteStatus) {
        els.remoteStatus.textContent = `连接失败: ${e?.message || e?.type || '未知'}`;
      }
      setTimeout(() => { showScreen('screen-mobile'); renderList(); }, 1200);
    }
  }

  els.join?.addEventListener('click', () => doJoin(els.code?.value), sig);
  els.code?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(els.code?.value); }, sig);
  $('#mobile-back')?.addEventListener('click', () => navigate('/'), sig);
  els.vibrateBtn?.addEventListener('click', () => sensor?.vibrate(1), sig);
  els.recalib?.addEventListener('click', () => {
    sess?.sendControl({ t: P.RECALIB });
    sensor?.vibrate(0.35);
    if (els.remoteStatus) els.remoteStatus.textContent = '已发送「设为正面」校准指令';
  }, sig);
  els.startBtn?.addEventListener('click', () => {
    sess?.sendControl({ t: P.START });
    sensor?.calibrate?.();
    sensor?.vibrate(0.5);
  }, sig);

  const forceSim = params?.get('sim') === '1';
  sensor = new Sensor({ forceSim });
  showScreen('screen-mobile');
  renderList();
  initDiscovery();

  return () => {
    ac.abort();
    clearInterval(pingTimer);
    clearInterval(staleTimer);
    unsubscribe?.();
    sensor?.stop();
    if (sess) { try { sess.close(); } catch { /* noop */ } }
    discovery.close();
  };
}
