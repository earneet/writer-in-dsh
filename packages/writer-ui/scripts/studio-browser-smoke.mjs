import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startStudioFixture } from './studio-browser-fixture.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const checkScript = fileURLToPath(new URL('./studio-browser-check.mjs', import.meta.url))
const windows = process.platform === 'win32'

async function findBrowser() {
    const override = process.env.WRITER_BROWSER_EXECUTABLE
    if (override) {
        await access(override)
        return resolve(override)
    }
    const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    const names = windows ? ['msedge.exe', 'chrome.exe'] : ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser']
    const candidates = paths.flatMap(path => names.map(name => join(path, name)))
    if (windows) {
        const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
        candidates.push(...roots.flatMap(path => [join(path, 'Microsoft/Edge/Application/msedge.exe'), join(path, 'Google/Chrome/Application/chrome.exe')]))
    }
    for (const candidate of candidates) {
        if (await access(candidate).then(() => true, () => false)) return candidate
    }
    throw new Error('找不到 Edge 或 Chrome，请将 WRITER_BROWSER_EXECUTABLE 设为 Chromium 浏览器可执行文件路径')
}

function completion(child) {
    return new Promise(resolve => {
        child.once('error', error => resolve({ error }))
        child.once('exit', (code, signal) => resolve({ code, signal }))
    })
}

async function waitForBrowser(profile, exited, signal) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    while (!deadline.aborted) {
        const endpoint = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(error => {
            if (error.code !== 'ENOENT') throw error
            return ''
        })
        const [port, path] = endpoint.trim().split(/\r?\n/)
        if (/^\d+$/.test(port) && path?.startsWith('/devtools/browser/')) {
            const origin = `http://127.0.0.1:${port}`
            const pages = await fetch(origin + '/json/list', { signal: AbortSignal.any([deadline, AbortSignal.timeout(1000)]) })
                .then(response => response.json()).catch(() => [])
            if (pages.some(page => page.type === 'page')) return { origin, socket: `ws://127.0.0.1:${port}${path}` }
        }
        const result = await Promise.race([exited, delay(100)])
        if (result) throw result.error ?? new Error(`浏览器提前退出（${result.code ?? result.signal}）`)
    }
    signal.throwIfAborted()
    throw new Error('等待浏览器调试端口超时')
}

async function closeBrowser(child, exited, endpoint) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    if (endpoint) {
        const socket = new WebSocket(endpoint.socket)
        socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })), { once: true })
        try {
            if (await Promise.race([exited, delay(4000, null, { ref: false })])) return
        } finally {
            if (socket.readyState < WebSocket.CLOSING) socket.close()
        }
    }
    if (windows) {
        const kill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, timeout: 4000 })
        await completion(kill)
    }
    if (child.exitCode === null && child.signalCode === null) child.kill()
    if (!await Promise.race([exited, delay(4000, null, { ref: false })])) throw new Error('无法结束冒烟测试浏览器')
}

const interrupted = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => interrupted.abort(new Error(`冒烟测试已中断（${signal}）`)))
}
const executable = await findBrowser()
const temporaryPrefix = join(resolve(tmpdir()), 'writer-browser-smoke-')
const temporary = await mkdtemp(temporaryPrefix)
if (!temporary.startsWith(temporaryPrefix)) throw new Error('测试临时目录与预期路径不一致')
let fixture
let browser
let browserExited
let endpoint
let browserErrors = ''
try {
    fixture = await startStudioFixture({ output: join(temporary, 'fixture'), port: 0, tempParent: temporary })
    interrupted.signal.throwIfAborted()
    const profile = join(temporary, 'browser')
    browser = spawn(executable, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
        '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    browserExited = completion(browser)
    browser.stderr.setEncoding('utf8').on('data', chunk => { browserErrors = (browserErrors + chunk).slice(-8000) })
    endpoint = await waitForBrowser(profile, browserExited, interrupted.signal)
    const env = {
        ...process.env,
        WRITER_FIXTURE_CDP_ORIGIN: endpoint.origin,
        WRITER_FIXTURE_ORIGIN: fixture.origin,
        WRITER_FIXTURE_REPORT_DIR: resolve(process.env.WRITER_FIXTURE_REPORT_DIR ?? join(repo, '.tmp/ui-implementation/browser/smoke')),
    }
    console.log(`浏览器 ${executable}`)
    for (const mode of ['--blank-init', '--watch']) {
        const check = spawn(process.execPath, [checkScript, mode], {
            cwd: repo, env, stdio: 'inherit', windowsHide: true, timeout: 45_000, signal: interrupted.signal,
        })
        const result = await completion(check)
        if (result.code !== 0) throw result.error ?? new Error(`浏览器冒烟 ${mode} 失败（${result.code ?? result.signal}）`)
    }
} catch (error) {
    if (browserErrors) console.error(browserErrors.trim())
    throw error
} finally {
    try {
        if (browser) await closeBrowser(browser, browserExited, endpoint)
    } finally {
        try {
            await fixture?.close()
        } finally {
            await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
        }
    }
}
