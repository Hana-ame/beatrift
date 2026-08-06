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

// 只混淆主入口 chunk(app 自身逻辑: 网络协议/MQTT 地址/谱面常量等),
// vendor(three/cannon/peerjs/mqtt)与调试页(test/ahrs/sword)不动, 避免体积与风险。
function obfuscateMain() {
  const opts = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    simplify: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.8,
    splitStrings: true,
    splitStringsChunkLength: 8,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    target: 'es2020',
  };
  return {
    name: 'obfuscate-main',
    enforce: 'post',
    generateBundle(_out, bundle) {
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!name.startsWith('browser')) continue;
        chunk.code = obfuscator.obfuscate(chunk.code, opts).getObfuscatedCode();
      }
    },
  };
}

export default defineConfig({
  plugins: [versionPlugin(), obfuscateMain()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['wsl-5173.moonchan.xyz'],
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2, drop_console: true },
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
