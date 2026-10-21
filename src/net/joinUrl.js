export function buildJoinUrl(roomCode) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/mobile?room=${roomCode}`;
}
