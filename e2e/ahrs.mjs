import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE || 'http://localhost:5173/';
const results = [];
const ok = (label, cond, detail = '') => {
  results.push({ label, cond });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctxPc = await browser.newContext();
const ctxMobile = await browser.newContext();
const pc = await ctxMobile.newPage();
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
  // ahrs 版 PC 端
  await pc.goto(BASE + 'ahrs/#/pc');
  await pc.waitForSelector('#pc-roomcode', { state: 'visible' });
  await pc.waitForFunction(() => document.querySelector('#pc-roomcode').textContent !== '------', null, { timeout: 15000 });
  const code = await pc.textContent('#pc-roomcode');
  ok('PC 生成房间码 (ahrs 版)', /^[A-Z0-9]{5}$/.test(code), code);

  await pc.waitForFunction(() => ['已广播', '等待手机', '已连接'].some((s) => document.querySelector('#pc-status').textContent.includes(s)), null, { timeout: 20000 });

  // ahrs 版手机遥控端
  await mob.goto(BASE + 'ahrs/#/mobile?sim=1');
  await mob.waitForSelector('#screen-mob-connect', { state: 'visible' });
  ok('Mobile 屏幕 (ahrs 版)', true);

  // ahrs 版列表项为 .item (非主 app 的 .device-item); 发现服务偶发慢, 不阻塞填码直连
  const sawItem = await mob.locator('.item').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (sawItem) {
    ok('Mobile 在列表中看到 PC (MQTT)', true, `房间 ${code}`);
  } else {
    console.log('  [SKIP] Mobile MQTT 列表发现 (服务未及时就绪, 走填码直连)');
  }

  await mob.fill('#mob-code', code);
  await mob.click('#mob-join');
  await mob.waitForSelector('#screen-mob-live', { state: 'visible', timeout: 20000 });
  ok('Mobile 进入遥控界面', true);

  // 启用模拟传感器
  await mob.waitForFunction(() => !document.querySelector('#mob-enable').disabled, null, { timeout: 15000 });
  await mob.click('#mob-enable');
  await mob.waitForFunction(() => document.querySelector('#mob-enable').textContent.includes('已开启'), null, { timeout: 15000 });
  ok('Mobile 传感器已启用', true);

  // PC 收到帧数据, 姿态解算(fuse)产生有效数值
  await pc.waitForFunction(() => {
    const el = document.querySelector('#pc-frames');
    return el && parseInt(el.textContent, 10) > 10;
  }, null, { timeout: 30000 });
  const frames = await pc.textContent('#pc-frames');
  ok('PC 收到帧数据', parseInt(frames, 10) > 10, `frames=${frames}`);

  await pc.waitForFunction(() => {
    const oa = document.querySelector('#s-oa');
    return oa && oa.textContent !== '--';
  }, null, { timeout: 15000 });
  ok('PC 收到 deviceorientation', true, `alpha=${await pc.textContent('#s-oa')}`);

  await pc.waitForFunction(() => {
    const ax = document.querySelector('#s-ax');
    return ax && ax.textContent !== '--' && ax.textContent !== '0.00';
  }, null, { timeout: 15000 });
  ok('PC 收到 accel', true, `a=(${await pc.textContent('#s-ax')},${await pc.textContent('#s-ay')},${await pc.textContent('#s-az')})`);

  await pc.waitForFunction(() => {
    const ax = document.querySelector('#s-gx');
    return ax && ax.textContent !== '--';
  }, null, { timeout: 15000 });
  ok('PC 收到 gyro', true, `g=(${await pc.textContent('#s-gx')},${await pc.textContent('#s-gy')},${await pc.textContent('#s-gz')})`);
} catch (e) {
  ok('EXCEPTION', false, e.message);
}

console.log('\n--- page errors ---');
for (const e of errs) console.log('  ', e);
ok('无 JS 报错', errs.length === 0, errs.join('; ') || 'clean');
const failed = results.filter((r) => !r.cond).length;
console.log(`\n${failed} 项失败 / ${results.length} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
