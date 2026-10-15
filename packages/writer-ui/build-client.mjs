/**
 * 浏览器半构建：esbuild 产出 factory-form CJS（lib/client.js）。
 * 形态与宿主 tsdown clientBundle 预设逐字对齐（references/deepseek-harness/
 * packages/client/tsdown.client.ts:618-624）：
 *   banner: window.__ModuleLoader__.load({ id, factory: (require) => {
 *   intro:  var module = { exports: {} }; var exports = module.exports;
 *   footer: return module.exports; } });
 * 基线模块（PLATFORM_MODULES）外部化为 require()，由浏览器模块表供给。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/** 把 `node:crypto` 重定向到浏览器桩（domain 包顶部 import createHash；面板路径不调用）。 */
const nodeCryptoStub = {
  name: 'node-crypto-stub',
  setup(build) {
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      // fileURLToPath 正确还原 percent-encoding（路径含空格/中文时 URL.pathname 手工剥盘符会解析到不存在路径）
      path: fileURLToPath(new URL('./src/client/crypto-stub.js', import.meta.url)),
    }))
  },
}

const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
  external: PLATFORM_MODULES,
  plugins: [nodeCryptoStub],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-writer-ui", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: '\nreturn module.exports; } });',
  },
  logLevel: 'info',
})
