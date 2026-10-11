/**
 * node:crypto 的浏览器桩：writer-ui 的面板路径只用 domain 的 frontmatter/纯文本解析，
 * contentHash 在浏览器半不可用（调用即抛，响亮失败而非静默错值）。
 * 由 build-client.mjs 的 esbuild 插件把 `node:crypto` 重定向到本文件。
 */
export function createHash() {
  throw new Error('dsh-writer-ui: node:crypto createHash 不可用于浏览器 bundle')
}
