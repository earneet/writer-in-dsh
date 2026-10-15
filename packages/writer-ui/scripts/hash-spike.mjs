/**
 * hash spike（roadmap §4.1 M1a，一次性验证脚本，node scripts/hash-spike.mjs 运行）：
 * 验证 dsh-writer-domain 纯函数可打进 client bundle（浏览器形态、node:crypto 桩重定向）。
 * 内存构建（write:false）不落盘——lib/ 是 npm pack 发布目录，不得混入 spike 产物。
 * 结论回写 docs/ui-capabilities-and-roadmap.md §4.1 与 implementation-plan §8 轮次 25；
 * M1b 接线 graph.ts 进浏览器入口后应复测真实 lib/client.js 体积增量。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const nodeCryptoStub = {
  name: 'node-crypto-stub',
  setup(build) {
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: fileURLToPath(new URL('../src/client/crypto-stub.js', import.meta.url)),
    }))
  },
}

const result = await build({
  // 入口：实体图（引 domain 纯函数 validateTimeline/parseMilestones；domain 全量随之打包）
  entryPoints: [fileURLToPath(new URL('../src/client/graph.ts', import.meta.url))],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  plugins: [nodeCryptoStub],
  write: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  logLevel: 'warning',
})
const size = result.outputFiles[0]?.text.length ?? 0
console.log(`hash-spike: graph.ts + dsh-writer-domain 打进浏览器 bundle 成功（内存构建不落盘），产物 ${size} bytes`)
console.log('（contentHash 依赖 node:crypto → 桩不可用；纯函数 parseTimeline/validateTimeline/parseMilestones 可用）')
