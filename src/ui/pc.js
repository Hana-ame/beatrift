import { showScreen, navigate, $ } from './screens.js';
import { GAME, genRoomCode, normalizeCode } from '../constants.js';
import * as discovery from '../net/discovery.js';
import { createHost } from '../net/connection.js';
import { P } from '../net/protocol.js';
import { buildJoinUrl } from '../net/joinUrl.js';
import QRCode from 'qrcode';
import { startGame, handleMotion, handleControl, SONGS } from '../game/index.js';

export function initPc() {
  const els = {
    status: $('#pc-status'),
    code: $('#pc-roomcode'),
    qr: $('#pc-qr'),
    start: $('#pc-start'),
    devices: $('#pc-devices'),
    newcode: $('#pc-newcode'),
  };
  let roomCode = genRoomCode();
  let host = null;
  let cleanupAnnounce = null;
  let connected = false;
  let diff = null;
  let song = 'pulse';

  const songBtns = [...document.querySelectorAll('.song-btn')];
  const setSong = (id) => {
    song = id;
    songBtns.forEach((b) => b.classList.toggle('active', b.dataset.song === id));
  };
  songBtns.forEach((b) => b.addEventListener('click', () => setSong(b.dataset.song)));
  setSong(song);

  const setStatus = (text, ok) => {
    els.status.textContent = text;
    els.status.classList.toggle('ok', !!ok);
  };

  async function announce() {
    setStatus('正在启动发现服务…');
    await discovery.connect();
    cleanupAnnounce?.();
    cleanupAnnounce = discovery.pcAnnounce(roomCode, host.id);
    setStatus('房间已广播, 等待手机连接…', true);
  }

  function refreshCodeUI() {
    els.code.textContent = roomCode;
    QRCode.toCanvas(els.qr, buildJoinUrl(roomCode), { width: 256, margin: 1 })
      .catch((e) => console.error('qr failed', e));
  }

  async function makeHost(attempt = 0) {
    if (host) { try { host.close(); } catch { /* noop */ } }
    setStatus(attempt > 0 ? `正在重连信令服务器 (${attempt}/3)…` : '正在生成房间…');
    try {
      host = await createHost(roomCode, handlers());
      els.devices.classList.remove('hidden');
      els.devices.innerHTML = '<div class="devices-title">正在等待设备…</div>';
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
      setStatus(`信令服务器连不上, 点「换一个」重试`, false);
    }
  }

  function handlers() {
    return {
      onOpen() {
        connected = true;
        els.devices.innerHTML = `<div class="device-item"><span>手机已连接</span><span class="dot on"></span></div>`;
        els.start.disabled = false;
        setStatus('已连接, 校准光剑中…', true);
        startGame({ host, roomCode, diff, song, calibrate: true });
        showScreen('screen-game');
      },
      onControl(msg) {
        if (msg?.t === P.PING) host?.sendControl({ t: P.PONG, ts: msg.ts });
        if (msg?.t === P.READY && msg.diff) diff = msg.diff;
        handleControl(msg);
      },
      onMotion(frame) {
        handleMotion(frame);
      },
      onClose() {
        connected = false;
        els.start.disabled = true;
        els.devices.innerHTML = '<div class="devices-title">手机已断开, 等待重连…</div>';
        setStatus('手机已断开', false);
      },
      onError(e) { console.error('[pc] conn error', e); },
    };
  }

  function onStart() {
    if (!connected || !host) return;
    host.sendControl({ t: P.START, bpm: GAME.BPM });
    startGame({ host, roomCode, diff, song });
    showScreen('screen-game');
  }

  showScreen('screen-pc');
  refreshCodeUI();
  makeHost();

  els.newcode.addEventListener('click', () => {
    roomCode = genRoomCode();
    refreshCodeUI();
    makeHost();
  });
  els.start.addEventListener('click', onStart);
  els.start.disabled = true;
  $('#pc-back').addEventListener('click', () => navigate('/'));

  return () => {
    cleanupAnnounce?.();
    if (host) { try { host.close(); } catch { /* noop */ } }
    discovery.close();
    els.newcode.removeEventListener('click', () => {});
    els.start.removeEventListener('click', onStart);
    $('#pc-back').removeEventListener('click', () => navigate('/'));
  };
}
