import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import obfuscator from 'javascript-obfuscator';

const versionUrl = new URL('./src/version.js', import.meta.url);
function writeVersion() {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch { /* not a git checkout */ }
  let dirty = '';
  try {
    dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() ? '+' : '';
  } catch { /* ignore */ }
  const app = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  writeFileSync(
    versionUrl,
    `// auto-generated (vite) — do not edit\n` +
    `export const VERSION = { app: '${app}', commit: '${commit}${dirty}', built: '${stamp}' };\n` +
    `export const VERSION_STR = \`v\${VERSION.app} (\${VERSION.commit}) \${VERSION.built}\`;\n`,
  );
}

function versionPlugin() {
  return {
    name: 'generate-version',
    configResolved() { writeVersion(); },
    buildStart() { writeVersion(); },
  };
}

// 生产混淆: 只混淆"app 自身逻辑"chunk(pc/mobile/connection/constants/attitude 等 src|lib 源码)。
// 按模块来源过滤(非 chunk 名前缀):
//   排除 = chunk.isEntry(入口) / 模块含 node_modules(vendor) / \0 虚拟模块(vite runtime) / test|ahrs|sword(调试页)
//   只混淆 = 模块 100% 来自项目 src/ 或 lib/ 的 chunk
// renameGlobals/selfDefending 必须为 false, 否则跨 chunk 引用断裂 / DevTools 卡死。
function obfuscateApp() {
  const opts = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.3,
    deadCodeInjection: false,
    identifierNamesGenerator: 'hexadecimal',
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: false,
    simplify: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 1.0,
    splitStrings: true,
    splitStringsChunkLength: 8,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    target: 'browser',
  };
  return {
    name: 'obfuscate-app',
    enforce: 'post',
    generateBundle(_out, bundle) {
      const proj = process.cwd();
      const isAppModule = (p) =>
        p.startsWith(proj) &&
        !p.includes('node_modules') &&
        !/\b(?:test|ahrs|sword)\//.test(p) &&
        !p.startsWith('\0');
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (chunk.isEntry) continue;
        const mods = Object.keys(chunk.modules || {});
        if (!mods.length) continue;
        if (!mods.every(isAppModule)) continue;
        chunk.code = obfuscator.obfuscate(chunk.code, opts).getObfuscatedCode();
      }
    },
  };
}

export default defineConfig({
  plugins: [versionPlugin(), obfuscateApp()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['wsl-5173.moonchan.xyz'],
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: { passes: 3, drop_console: true },
      mangle: {},
      format: { comments: false },
    },
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        test: fileURLToPath(new URL('./test/index.html', import.meta.url)),
        ahrs: fileURLToPath(new URL('./ahrs/index.html', import.meta.url)),
        sword: fileURLToPath(new URL('./sword/index.html', import.meta.url)),
      },
      output: {
        manualChunks: {
          three: ['three'],
          physics: ['cannon-es'],
          net: ['peerjs', 'mqtt'],
        },
      },
    },
  },
});
