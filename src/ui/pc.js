import { showScreen, navigate, $ } from './screens.js';
import { GAME, DIFFICULTY, DEFAULT_DIFFICULTY, genRoomCode } from '../constants.js';
import * as discovery from '../net/discovery.js';
import { createHost } from '../net/connection.js';
import { P } from '../net/protocol.js';
import { buildJoinUrl } from '../net/joinUrl.js';
import QRCode from 'qrcode';
import { startGame, handleMotion, handleControl } from '../game/index.js';

export function initPc() {
  const ac = new AbortController();
  const sig = { signal: ac.signal };

  const els = {
    status: $('#pc-status'),
    code: $('#pc-roomcode'),
    qr: $('#pc-qr'),
    start: $('#pc-start'),
    solo: $('#pc-solo'),
    devices: $('#pc-devices'),
    newcode: $('#pc-newcode'),
  };
  let roomCode = genRoomCode();
  let host = null;
  let cleanupAnnounce = null;
  let connected = false;
  let diff = DEFAULT_DIFFICULTY;
  let song = 'pulse';

  const songBtns = [...document.querySelectorAll('.song-btn')];
  const setSong = (id) => {
    song = id;
    songBtns.forEach((b) => b.classList.toggle('active', b.dataset.song === id));
  };
  songBtns.forEach((b) => b.addEventListener('click', () => setSong(b.dataset.song), sig));
  setSong(song);

  const roomDiffBtns = [...document.querySelectorAll('.room-diff-btn')];
  const setRoomDiff = (id) => {
    if (!DIFFICULTY[id]) return;
    diff = id;
    roomDiffBtns.forEach((b) => b.classList.toggle('active', b.dataset.diff === id));
  };
  roomDiffBtns.forEach((b) => b.addEventListener('click', () => setRoomDiff(b.dataset.diff), sig));
  setRoomDiff(diff);

  const setStatus = (text, ok) => {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.classList.toggle('ok', !!ok);
  };

  async function announce() {
    setStatus('正在启动发现服务…');
    await discovery.connect();
    cleanupAnnounce?.();
    if (!host) return;
    cleanupAnnounce = discovery.pcAnnounce(roomCode, host.id);
    setStatus('房间已广播, 等待手机连接…', true);
  }

  function refreshCodeUI() {
    if (els.code) els.code.textContent = roomCode;
    if (els.qr) {
      QRCode.toCanvas(els.qr, buildJoinUrl(roomCode), { width: 256, margin: 1 })
        .catch((e) => console.error('qr failed', e));
    }
  }

  async function makeHost(attempt = 0) {
    if (host) { try { host.close(); } catch { /* noop */ } }
    setStatus(attempt > 0 ? `正在重连信令服务器 (${attempt}/3)…` : '正在生成房间…');
    try {
      host = await createHost(roomCode, handlers());
      els.devices?.classList.remove('hidden');
      if (els.devices) els.devices.innerHTML = '<div class="devices-title">正在等待设备…</div>';
      await announce();
    } catch (e) {
      if (e?.type === 'unavailable-id') {
        roomCode = genRoomCode();
        refreshCodeUI();
        await makeHost(0);
        return;
      }
      if (attempt < 3) {
        setTimeout(() => makeHost(attempt + 1), 800);
        return;
      }
      console.error(e);
      setStatus('信令服务器连不上, 可点「换一个」重试或直接「单机鼠标畅玩」', false);
    }
  }

  function handlers() {
    return {
      onOpen() {
        connected = true;
        if (els.devices) {
          els.devices.innerHTML = `<div class="device-item"><span>手机已连接</span><span class="dot on"></span></div>`;
        }
        if (els.start) els.start.disabled = false;
        setStatus('已连接, 校准光剑中…', true);
        startGame({ host, roomCode, diff, song, calibrate: true });
        showScreen('screen-game');
      },
      onControl(msg) {
        if (msg?.t === P.PING) host?.sendControl({ t: P.PONG, ts: msg.ts });
        if (msg?.t === P.READY && msg.diff && DIFFICULTY[msg.diff]) {
          setRoomDiff(msg.diff);
        }
        handleControl(msg);
      },
      onMotion(frame) {
        handleMotion(frame);
      },
      onClose() {
        connected = false;
        if (els.start) els.start.disabled = true;
        if (els.devices) els.devices.innerHTML = '<div class="devices-title">手机已断开, 等待重连…</div>';
        setStatus('手机已断开', false);
      },
      onError(e) { console.error('[pc] conn error', e); },
    };
  }

  function onStart() {
    if (!connected || !host) return;
    host.sendControl({ t: P.START, bpm: GAME.BPM });
    startGame({ host, roomCode, diff, song, keepCalib: true });
    showScreen('screen-game');
  }

  function onSolo() {
    startGame({ host, roomCode, diff, song, solo: true, calibrate: false, keepCalib: true });
    showScreen('screen-game');
  }

  showScreen('screen-pc');
  refreshCodeUI();
  makeHost();

  els.newcode?.addEventListener('click', () => {
    roomCode = genRoomCode();
    refreshCodeUI();
    makeHost();
  }, sig);
  els.start?.addEventListener('click', onStart, sig);
  if (els.start) els.start.disabled = true;
  els.solo?.addEventListener('click', onSolo, sig);
  $('#pc-back')?.addEventListener('click', () => navigate('/'), sig);

  return () => {
    ac.abort();
    cleanupAnnounce?.();
    if (host) { try { host.close(); } catch { /* noop */ } }
    discovery.close();
  };
}
