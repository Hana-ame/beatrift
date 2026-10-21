// 手机端: 采集原始传感器并流式发送到 PC (PeerJS JSON 通道)
import { $, showScreen, navigate } from '../src/ui/screens.js';
import { normalizeCode } from '../src/constants.js';
import { P, PREFIX, joinPeer, subscribeRooms, discoveryReady, discoveryClose } from './net.js';
import { TestSensor } from './sensor.js';

const SEND_HZ = 60;

export function initPhone(params) {
  const els = {
    status: $('#mob-status'),
    list: $('#mob-list'),
    code: $('#mob-code'),
    join: $('#mob-join'),
    enable: $('#mob-enable'),
    liveStatus: $('#mob-live-status'),
    sendHz: $('#mob-send-hz'),
    frames: $('#mob-frames'),
    ping: $('#mob-ping'),
    reset: $('#mob-reset'),
    disconnect: $('#mob-disconnect'),
    oa: $('#mob-oa'), ob: $('#mob-ob'), og: $('#mob-og'), oabs: $('#mob-oabs'),
    ax: $('#mob-ax'), ay: $('#mob-ay'), az: $('#mob-az'), amag: $('#mob-amag'),
    gx: $('#mob-gx'), gy: $('#mob-gy'), gz: $('#mob-gz'), gmag: $('#mob-gmag'),
    iv: $('#mob-iv'), so: $('#mob-so'),
  };
  const known = new Map();
  let sess = null;
  let sensor = null;
  let sending = false;
  let unsub = null;
  let staleTimer = null;
  let pingTimer = null;
  let frames = 0;
  let seq = 0;
  let lastSentTs = 0;
  let sendRateWindow = [];

  if (params?.get('room')) els.code.value = normalizeCode(params.get('room'));

  function renderList() {
    if (known.size === 0) {
      els.list.innerHTML = '<div class="empty">未发现 PC · 可手输房间码</div>';
      return;
    }
    els.list.innerHTML = '';
    for (const [code] of known) {
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<span>PC 房间 <b>${code}</b></span><span class="dot on"></span>`;
      row.addEventListener('click', () => doJoin(code));
      els.list.appendChild(row);
    }
  }

  async function initDiscovery() {
    const ok = await discoveryReady();
    if (!ok) {
      els.list.innerHTML = '<div class="empty">发现服务不可用 · 请直接输入房间码</div>';
      return;
    }
    unsub = subscribeRooms((code, dev) => {
      if (!dev?.peerId) return;
      known.set(code, { peerId: dev.peerId, ts: Date.now() });
      renderList();
    });
    staleTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [code, dev] of known) {
        if (now - dev.ts > 6000) { known.delete(code); changed = true; }
      }
      if (changed) renderList();
    }, 2000);
  }

  function handlers() {
    return {
      onData(d) {
        if (d?.t === P.PING) sess?.send({ t: P.PONG, ts: d.ts });
        if (d?.t === P.PONG) {
          els.ping.textContent = `${Math.max(0, Date.now() - d.ts)} ms`;
        }
      },
      onOpen() {
        sess?.send({ t: P.HELLO, v: 1, role: 'mobile' });
        els.liveStatus.textContent = '已连接 · 请启用传感器';
        els.liveStatus.classList.add('ok');
        els.enable.disabled = false;
        pingLoop();
        showScreen('screen-mob-live');
      },
      onClose() {
        els.liveStatus.textContent = '连接已断开';
        els.liveStatus.classList.remove('ok');
        sending = false;
      },
      onError(e) { console.error('[phone] conn error', e); },
    };
  }

  function pingLoop() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (sess) sess.send({ t: P.PING, ts: Date.now() });
    }, 1000);
  }

  async function doJoin(code, attempt = 0) {
    code = normalizeCode(code);
    if (!code) return;
    els.status.textContent = attempt > 0 ? `重连中 (${attempt}/2)…` : '正在连接…';
    els.enable.disabled = true;
    try {
      sess = await joinPeer(`${PREFIX}-${code}`, handlers());
      els.status.textContent = `已加入房间 ${code}`;
    } catch (e) {
      console.error(e);
      if (attempt < 2) {
        setTimeout(() => doJoin(code, attempt + 1), 700);
        return;
      }
      els.status.textContent = `连接失败: ${e?.message || e?.type || '未知'}`;
      setTimeout(() => { showScreen('screen-mob-connect'); renderList(); }, 1200);
    }
  }

  async function enableSensor() {
    els.enable.disabled = true;
    els.liveStatus.textContent = '正在请求传感器权限…';
    const granted = await sensor.requestPermission();
    if (!granted) {
      els.liveStatus.textContent = '传感器权限被拒绝';
      els.enable.disabled = false;
      return;
    }
    sensor.start(onFrame);
    sending = true;
    els.liveStatus.textContent = '传感器已启用 · 正在发送';
    els.liveStatus.classList.add('ok');
    els.enable.textContent = '传感器已开启';
  }

  function onFrame(snap) {
    // 本地实时读数
    if (snap.o) {
      els.oa.textContent = snap.o.a?.toFixed(1);
      els.ob.textContent = snap.o.b?.toFixed(1);
      els.og.textContent = snap.o.g?.toFixed(1);
      els.oabs.textContent = snap.o.abs ? '绝对' : '相对';
    }
    if (snap.aig) {
      const m = Math.hypot(snap.aig.x, snap.aig.y, snap.aig.z);
      els.ax.textContent = snap.aig.x.toFixed(2);
      els.ay.textContent = snap.aig.y.toFixed(2);
      els.az.textContent = snap.aig.z.toFixed(2);
      els.amag.textContent = m.toFixed(2);
    }
    if (snap.gyr) {
      const m = Math.hypot(snap.gyr.x, snap.gyr.y, snap.gyr.z);
      els.gx.textContent = snap.gyr.x.toFixed(1);
      els.gy.textContent = snap.gyr.y.toFixed(1);
      els.gz.textContent = snap.gyr.z.toFixed(1);
      els.gmag.textContent = m.toFixed(1);
    }
    els.iv.textContent = snap.iv ? `${snap.iv} ms` : '--';
    els.so.textContent = snap.so ?? 0;

    if (!sending || !sess) return;
    frames++;
    // 节流到 ~SEND_HZ
    const now = performance.now();
    if (now - lastSentTs < 1000 / SEND_HZ) return;
    lastSentTs = now;
    sess.send({ t: P.SENSOR, seq: ++seq, ...snap });
    sendRateWindow.push(now);
    while (sendRateWindow.length && now - sendRateWindow[0] > 1000) sendRateWindow.shift();
    els.sendHz.textContent = `${sendRateWindow.length} Hz`;
    els.frames.textContent = frames;
  }

  $('#mob-join').addEventListener('click', () => doJoin(els.code.value));
  els.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(els.code.value); });
  els.enable.addEventListener('click', enableSensor);
  els.reset.addEventListener('click', () => { if (sess) sess.send({ t: P.RESET }); });
  els.disconnect.addEventListener('click', () => {
    sensor?.stop();
    sess?.close();
    sess = null;
    showScreen('screen-mob-connect');
    renderList();
  });
  $('#mob-back').addEventListener('click', () => navigate('/'));

  sensor = new TestSensor({ sim: params?.get('sim') === '1' });
  showScreen('screen-mob-connect');
  renderList();
  initDiscovery();

  if (els.code.value) doJoin(els.code.value);

  return () => {
    clearInterval(pingTimer);
    clearInterval(staleTimer);
    unsub?.();
    sensor?.stop();
    if (sess) { try { sess.close(); } catch { /* noop */ } }
    discoveryClose();
  };
}
