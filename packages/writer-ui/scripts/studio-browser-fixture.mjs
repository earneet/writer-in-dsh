import { build } from 'esbuild'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandHarness } from '../../writer-store/tests/command-harness.ts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const out = resolve(repo, '.tmp/ui-implementation/browser')
await mkdir(out, { recursive: true })
const assets = resolve(repo, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
const assetNames = await readdir(assets)
const indexName = assetNames.find(name => /^index-.*\.js$/.test(name))
if (!indexName) throw new Error('没有找到宿主浏览器产物')
const entry = await readFile(resolve(assets, indexName), 'utf8')
const cut = entry.indexOf('const Gs=globalThis.dshDesktopBoot')
const table = /function ([\w$]+)\(\)\{return\{react:[^}]+"@deepseek-ai\/dsh-client-ui-primitives"[^}]+\}\}/.exec(entry)
if (cut < 0 || !table) throw new Error('宿主引导形态已变化，需要重新核对测试适配')
await writeFile(resolve(out, 'host.js'), entry.slice(0, cut) + `\nexport const modules = ${table[1]}();\n`)
await build({ entryPoints: [fileURLToPath(new URL('./studio-browser-entry.tsx', import.meta.url))], outfile: resolve(out, 'fixture.js'), bundle: true, platform: 'browser', format: 'esm', plugins: [{ name: 'host-runtime', setup(builder) { builder.onResolve({ filter: /^writer-host-runtime$/ }, () => ({ path: '/assets/host.js', external: true })) } }] })
const theme = await readFile(resolve(repo, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
const conversation = await readFile(resolve(repo, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), 'utf8')
if (conversation.split('return module.exports;').length !== 2) throw new Error('宿主 Conversation 导出形态已变化')
await writeFile(resolve(out, 'conversation-fixture.js'), conversation.replace('return module.exports;', 'exports.__writerShellFixture = { ConversationContent, DefaultConversationViews, css: ConversationRoot_module_css_default }; return module.exports;'))
let themeCss = ''
for (const match of theme.matchAll(/var\s+[\w$]+\s*=\s*("(?:\\.|[^"\\])*");/g)) {
    const value = JSON.parse(match[1])
    if (value.includes('--dsw') && /^(body|:root|@supports)/.test(value)) themeCss += value
}
await writeFile(resolve(out, 'theme.css'), themeCss)
const styles = assetNames.filter(name => /^(index|vendor)-.*\.css$/.test(name)).map(name => `<link rel="stylesheet" href="/assets/${name}">`).join('')
await writeFile(resolve(out, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/theme.css"><style>html,body,#root{height:100%;margin:0}body{background:var(--dsw-alias-bg-layer-1);--dsw-font-family:"Microsoft YaHei",sans-serif}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`)
const routes = new Map([['/', resolve(out, 'index.html')], ['/index.html', resolve(out, 'index.html')], ['/fixture.js', resolve(out, 'fixture.js')], ['/assets/host.js', resolve(out, 'host.js')], ['/theme.css', resolve(out, 'theme.css')], ['/writer.js', resolve(repo, 'packages/writer-ui/lib/client.js')]])
routes.set('/conversation-fixture.js', resolve(out, 'conversation-fixture.js'))
const harness = process.argv.includes('--build-only') ? null : await commandHarness()
const fixtureAgents = new Map()
if (harness) {
    for (const id of ['init-empty', 'init-other', 'init-nonempty', 'init-hidden', 'init-race', 'init-error']) {
        const agent = await harness.createAgent(id)
        fixtureAgents.set(id, agent)
        if (id === 'init-nonempty' || id === 'init-hidden') await writeFile(resolve(agent.session.header.cwd, id === 'init-hidden' ? '.hidden' : 'notes.txt'), '已有内容，必须保留')
    }
}
const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname.startsWith('/project-')) {
        response.setHeader('Content-Type', 'application/json')
        try {
            let body = ''
            for await (const chunk of request) body += chunk
            const args = JSON.parse(body)
            const agent = fixtureAgents.get(args.sessionId)
            if (!agent) throw new Error('未知的测试会话')
            const signal = new AbortController().signal
            if (url.pathname === '/project-command') {
                if (args.sessionId === 'init-error') throw new Error('模拟目录读取失败：权限不足')
                const value = await harness.commands.execute(agent, args.line, [], signal)
                response.end(JSON.stringify({ ok: true, value }))
                return
            }
            const cwd = agent.session.header.cwd
            const path = resolve(cwd, args.path || '.')
            if (path !== cwd && !path.startsWith(cwd + sep)) throw new Error('测试路径越界')
            if (url.pathname === '/project-list') {
                const entries = await readdir(path, { withFileTypes: true })
                response.end(JSON.stringify({ ok: true, value: { entries: entries.map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } }))
            } else if (url.pathname === '/project-read') {
                const text = await readFile(path, 'utf8')
                const lines = text.split('\n').slice((args.offset || 1) - 1)
                response.end(JSON.stringify({ ok: true, value: { text: lines.join('\n'), lines: lines.length, eof: true } }))
            } else if (url.pathname === '/project-add-file') {
                await writeFile(resolve(cwd, 'notes.txt'), '初始化前新放入的文件')
                response.end(JSON.stringify({ ok: true }))
            } else throw new Error('未知测试请求')
        } catch (error) { response.end(JSON.stringify({ ok: false, error: { message: error.message } })) }
        return
    }
    const assetPath = url.pathname.startsWith('/assets/') ? resolve(assets, decodeURIComponent(url.pathname.slice(8))) : ''
    const path = routes.get(url.pathname) ?? (assetPath.startsWith(assets + sep) ? assetPath : undefined)
    if (!path) { response.writeHead(404).end(); return }
    try { const data = await readFile(path); response.writeHead(200, { 'Content-Type': path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store' }); response.end(data) }
    catch { response.writeHead(500).end() }
})
if (!process.argv.includes('--build-only')) server.listen(63438, '127.0.0.1', () => console.log('http://127.0.0.1:63438/'))
async function shutdown() {
    await new Promise(resolve => server.close(resolve))
    await harness?.dispose()
}
process.on('SIGINT', () => { void shutdown().finally(() => process.exit()) })
process.on('SIGTERM', () => { void shutdown().finally(() => process.exit()) })
