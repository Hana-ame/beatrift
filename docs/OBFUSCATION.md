# 生产混淆 (OBFUSCATION.md)

现状: 纯前端游戏, 无服务端秘密。混淆只能提高逆向成本(小时→天), 不能防住确定性的逆向者。

## 目标
- 只混淆 app 自身逻辑 chunk(pc/mobile/connection/constants/attitude)
- vendor(three/physics/net/browser/OrbitControls/ahrs)、vite 运行时(screens)、
  调试页(test/ahrs/sword)、entry(main) 一律不动
- 不碰 qrcode chunk(browser-*.js)

## 实现
vite.config.js 的 obfuscateApp 插件, 用**模块来源过滤**(非 chunk 名前缀):
- 排除条件: chunk.isEntry / 模块含 node_modules / \0 虚拟模块(vite runtime) / 路径含 test|ahrs|sword
- 只混淆: 模块 100% 来自项目 src/ 或 lib/ 的 chunk
- 关键开关: `renameGlobals:false` `selfDefending:false`(必须, 否则跨 chunk 引用断裂 / DevTools 卡死)
- 其它: stringArray + base64 编码 + threshold 1.0、splitStrings(8)、controlFlowFlattening(0.3)、
  numbersToExpressions、target:'browser'

## 实测映射 (2026-08-06, 哈希随构建变化)
混淆: `pc-*.js`(游戏端) / `mobile-*.js` / `connection-*.js` / `constants-*.js` / `attitude-*.js`(游戏共享)
不动: `three` / `physics` / `net`(peerjs+mqtt) / `browser`(qrcode) / `OrbitControls` / `ahrs` /
  `screens` / `main` / `test` / `sword` / `phone`

## 验证
1. `CI=false npm run build`
2. `grep -l "_0x[0-9a-f]" dist/assets/*.js` → 只命中上面"混淆"列表
3. `grep "wss://\|beatrift/rooms" dist/assets/constants-*.js` → 无明文
4. `timeout 150 node e2e/e2e.mjs` + 手动 PC/Mobile 双端冒烟

## 已知残留明文(obfuscator 限制, 可接受)
- 字符串下标访问的字符串(如房间码字母表 `ABCDEFGH…`, 经 `str[i]` 取字符)不加密
- 对象属性键名(如 `hitSteps`、`P.*` 消息名若作 key)不加密

## 权衡
- stringArrayThreshold 1.0: 所有字符串进数组, 体积增加极小, 收益高
- controlFlowFlattening 提高乱序但增大体积/减慢构建, 阈值 0.3 折中
- 混淆不覆盖谱面 charts/*.json(仍明文)
