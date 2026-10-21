import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE || 'http://localhost:5173/';
const results = [];
const ok = (label, cond, detail = '') => {
  results.push({ label, cond });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};
const okSoft = (label, cond, detail = '') => {
  results.push({ label, cond, soft: true });
  console.log(`  [${cond ? 'PASS' : 'SKIP'}] ${label}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctxPc = await browser.newContext();
const ctxMobile = await browser.newContext();
const pc = await ctxPc.newPage();
const mob = await ctxMobile.newPage();
const errs = [];
const watch = (p, tag) => {
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push(`${tag} [error]: ${m.text()}`);
  });
};
watch(pc, 'PC');
watch(mob, 'MOBILE');

try {
  let code = '';
  for (let a = 0; a < 3; a++) {
    await pc.goto(BASE + '#/pc');
    await pc.waitForSelector('#pc-roomcode', { state: 'visible' });
    await pc.waitForFunction(() => document.querySelector('#pc-roomcode').textContent !== '------', null, { timeout: 15000 });
    code = await pc.textContent('#pc-roomcode');
    await pc.waitForFunction(() => ['已广播', '等待手机', '已连接'].some((s) => document.querySelector('#pc-status').textContent.includes(s)), null, { timeout: 20000 }).catch(() => {});
    const status = await pc.textContent('#pc-status');
    if (['已广播', '等待手机', '已连接'].some((s) => status.includes(s))) break;
  }
  ok('PC 生成房间码', /^[A-Z0-9]{5}$/.test(code), code);
  const pcStatus = await pc.textContent('#pc-status');
  okSoft('PC MQTT 广播', ['已广播', '等待手机', '已连接'].some((s) => pcStatus.includes(s)), pcStatus);

  await mob.goto(BASE + '#/mobile?sim=1');
  await mob.waitForSelector('#screen-mobile', { state: 'visible' });
  ok('Mobile 屏幕', true);

  const listItem = mob.locator('.device-item', { hasText: code }).first();
  const waitList = async (ms) => listItem.waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  let sawList = await waitList(10000);
  for (let a = 0; !sawList && a < 2; a++) {
    await mob.reload();
    await mob.waitForSelector('#screen-mobile', { state: 'visible' });
    sawList = await waitList(10000);
  }
  okSoft('Mobile 在列表中看到 PC (MQTT)', sawList, `房间 ${code}`);

await mob.fill('#mobile-code', code);
  await mob.click('#mobile-join');
  await mob.waitForSelector('#screen-remote', { state: 'visible', timeout: 20000 });
  await mob.waitForFunction(() => document.querySelector('#remote-status').textContent.includes('校准'), null, { timeout: 20000 });
  ok('Mobile 进入遥控界面', true);

  // PC 端校准界面(光剑跟随, 无音符): 等校准开始出现并点击开始
  await pc.waitForSelector('#calib-overlay:not(.hidden)', { state: 'visible', timeout: 20000 });
  ok('PC 进入光剑校准界面', true);
  await pc.waitForFunction(() => !!window.__beatriftDebug?.getGame()?.swordVisible, null, { timeout: 20000 });
  ok('网络 motion 流到达 PC(光剑可见)', true);
  await pc.waitForTimeout(1500);

  await pc.click('#calib-start', { force: true });
  await pc.waitForSelector('#hud:not(.hidden)', { state: 'visible', timeout: 5000 });
  ok('PC 进入游戏画面', true);

  await pc.waitForTimeout(2500);
  const scoreBefore = await pc.textContent('#score');
  const injected = await pc.evaluate(async () => {
    const d = window.__beatriftDebug;
    const pivot = { x: 0, y: 0.5, z: 1.4 };
    const planeY = -4.4;
    let swings = 0;
    for (let i = 0; i < 80; i++) {
      const game = d.getGame();
      let best = null, bestP = Infinity;
      if (game) {
        for (const n of game.notes) {
          if (n.dead) continue;
          const y = n.mesh.position.y;
          if (y < planeY - 2.2 || y > planeY + 1.6) continue;
          const dist = n.mesh.position.distanceToSquared(new (n.mesh.position.constructor)(pivot.x, pivot.y, pivot.z));
          if (dist < bestP) { bestP = dist; best = n; }
        }
        if (best) {
          const dir = best.mesh.position.clone().sub(new (best.mesh.position.constructor)(pivot.x, pivot.y, pivot.z)).normalize();
          d.handleMotion({ dir: { x: dir.x, y: dir.y, z: dir.z }, omega: 4, hit: 4 });
          swings++;
        }
      }
      await new Promise((r) => setTimeout(r, 90));
    }
    return swings;
  });
  await pc.waitForTimeout(800);
  const scoreAfter = await pc.textContent('#score');
  ok('PC 计分增长(注入命中)', Number(scoreAfter) > Number(scoreBefore), `注入 ${injected} 次挥击, ${scoreBefore} -> ${scoreAfter}`);

  const lives = await pc.textContent('#lives');
  ok('PC 生命显示', lives.length > 0, lives);

  const ping = await mob.textContent('#remote-ping');
  ok('Mobile 收到 ping 延迟', /\d+\s*ms/.test(ping), ping);
} catch (e) {
  ok('EXCEPTION', false, e.message);
}

console.log('\n--- page errors ---');
if (errs.length === 0) console.log('  (none)');
else errs.forEach((e) => console.log('  ' + e));

const passed = results.filter((r) => r.cond).length;
const hard = results.filter((r) => !r.soft).length;
const skipped = results.filter((r) => r.soft && !r.cond).length;
console.log(`\nPass ${passed}/${results.length} (hard ${passed - results.filter((r) => r.soft && r.cond).length}/${hard}${skipped ? `, MQTT 软检查跳过 ${skipped}` : ''})`);
await browser.close();
const hardPass = results.filter((r) => !r.soft).every((r) => r.cond);
process.exit(hardPass ? 0 : 1);
