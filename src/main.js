import './style.css';
import { bindRoleButtons, parseRoute, showScreen } from './ui/screens.js';
import { VERSION_STR } from './version.js';

document.title = `BeatRift · 体感节奏击打 ${VERSION_STR}`;
const vBadge = document.getElementById('version-badge');
if (vBadge) vBadge.textContent = VERSION_STR;

let current = { role: null, cleanup: null };

async function startPc() {
  const { initPc } = await import('./ui/pc.js');
  stopFlow();
  current.role = 'pc';
  current.cleanup = initPc();
}

async function startMobile() {
  const { initMobile } = await import('./ui/mobile.js');
  stopFlow();
  current.role = 'mobile';
  current.cleanup = initMobile(parseRoute().params);
}

function stopFlow() {
  if (current.cleanup) {
    try { current.cleanup(); } catch (e) { console.error(e); }
  }
  current.cleanup = null;
}

bindRoleButtons();
window.addEventListener('hashchange', route);
route();

function route() {
  const { path } = parseRoute();
  if (path === 'pc') startPc();
  else if (path === 'mobile') startMobile();
  else {
    stopFlow();
    current.role = null;
    showScreen('screen-role');
  }
}
