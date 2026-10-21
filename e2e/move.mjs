import { chromium } from 'playwright';
const BASE = process.env.E2E_BASE || 'http://localhost:5173/';
const browser = await chromium.launch();
const ctxPc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxMobile = await browser.newContext();
const pc = await ctxPc.newPage();
const mob = await ctxMobile.newPage();
mob.on('pageerror', (e) => console.log('MOBERR', e.message));
let code = '';
for (let a = 0; a < 3; a++) {
  await pc.goto(BASE + '#/pc');
  await pc.waitForFunction(() => document.querySelector('#pc-roomcode').textContent !== '------', null, { timeout: 15000 });
  code = await pc.textContent('#pc-roomcode');
  const status = await pc.textContent('#pc-status');
  if (['已广播', '等待手机', '已连接'].some((s) => status.includes(s))) break;
}
await mob.goto(BASE + '#/mobile?sim=1');
await mob.waitForSelector('#screen-mobile', { state: 'visible' });
await mob.fill('#mobile-code', code);
await mob.click('#mobile-join');
await pc.waitForSelector('#calib-overlay:not(.hidden)', { state: 'visible', timeout: 20000 });
await pc.waitForFunction(() => !!window.__beatriftDebug?.getGame()?.swordVisible, null, { timeout: 20000 });
await pc.click('#calib-start', { force: true });
await pc.waitForSelector('#hud:not(.hidden)', { state: 'visible', timeout: 10000 });
await pc.waitForTimeout(1000);
const samples = [];
for (let i = 0; i < 20; i++) {
  const s = await pc.evaluate(() => {
    const g = window.__beatriftDebug.getGame();
    const sv = g.scene.getSword();
    return {
      d: [g.swordDir.x.toFixed(2), g.swordDir.y.toFixed(2), g.swordDir.z.toFixed(2)],
      t: sv.tip.toArray().map((v) => +v.toFixed(2)),
    };
  });
  samples.push(s);
  await pc.waitForTimeout(200);
}
let mv = false;
const d0 = samples[0].d.join(',');
for (const s of samples.slice(1)) if (s.d.join(',') !== d0) mv = true;
console.log('dirsChanged:', mv);
console.log('first:', samples[0].d.join(','), 'tip', samples[0].t.join(','));
console.log('last :', samples[19].d.join(','), 'tip', samples[19].t.join(','));
console.log('unique dirs:', [...new Set(samples.map((s) => s.d.join(',')))].length);
await browser.close();
process.exit(mv ? 0 : 1);
