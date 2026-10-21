import './style.css';
import { bindRoleButtons, parseRoute, showScreen } from '../src/ui/screens.js';

let current = { role: null, cleanup: null };

function stopFlow() {
  if (current.cleanup) {
    try { current.cleanup(); } catch (e) { console.error(e); }
  }
  current.cleanup = null;
}

function route() {
  const { path, params } = parseRoute();
  if (path === 'pc') {
    stopFlow();
    current.role = 'pc';
    import('./pc.js').then((m) => { current.cleanup = m.initPc(params); });
  } else if (path === 'mobile') {
    stopFlow();
    current.role = 'mobile';
    import('./phone.js').then((m) => { current.cleanup = m.initPhone(params); });
  } else {
    stopFlow();
    current.role = null;
    showScreen('screen-role');
  }
}

bindRoleButtons({ onPc() {}, onMobile() {} });
window.addEventListener('hashchange', route);
route();
