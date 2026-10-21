const $ = (sel) => document.querySelector(sel);

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(`#${id}`)?.classList.remove('hidden');
}

export function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const params = new URLSearchParams(query || '');
  return { path: path || 'role', params };
}

export function navigate(hash) {
  window.location.hash = hash;
}

let bound = false;
export function bindRoleButtons({ onPc, onMobile } = {}) {
  if (bound) return;
  bound = true;
  $('#btn-pc')?.addEventListener('click', () => {
    navigate('/pc');
    onPc?.();
  });
  $('#btn-mobile')?.addEventListener('click', () => {
    navigate('/mobile');
    onMobile?.();
  });
}

export { $ };
