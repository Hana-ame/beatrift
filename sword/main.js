import './style.css';
import { parseRoute, showScreen } from '../src/ui/screens.js';

let current = null;

function route() {
  const { path } = parseRoute();
  if (path === 'pc') {
    current?.cleanup?.();
    import('./pc.js').then((m) => { current = { cleanup: m.initPc() }; });
  } else {
    current?.cleanup?.();
    current = null;
    showScreen('screen-role');
  }
}

$('#btn-pc').addEventListener('click', () => { location.hash = '/pc'; });
$('#pc-back').addEventListener('click', () => { location.hash = '/'; });
window.addEventListener('hashchange', route);
route();

function $(sel) { return document.querySelector(sel); }
