import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { clearScan, publishScan, publishWatchState, readBus, subscribeBus } from './bus.ts'
import { ProjectCommandUnavailableError, projectCommand, scanNovel, watchProject } from './load.ts'
import type { WorkspaceProjectState } from 'dsh-writer-core'

export function useProject(sessionId: string) {
    const snapshot = useCallback(() => readBus(sessionId), [sessionId])
    const bus = useSyncExternalStore(subscribeBus, snapshot, snapshot)
    const [ui, setUi] = useState({ loading: false, error: null as string | null, progress: '', project: null as WorkspaceProjectState | null })
    const [initializing, setInitializing] = useState(false)
    const initialization = useRef<AbortController | null>(null)
    const checked = useRef(false)
    const [nonce, setNonce] = useState(0)
    const [watchRoot, setWatchRoot] = useState<string | null>(null)
    const generation = useRef(0)
    const reload = useCallback(() => setNonce(value => value + 1), [])
    const refresh = useCallback(() => { checked.current = false; reload() }, [reload])

    useEffect(() => () => initialization.current?.abort(), [sessionId])
    const initialize = useCallback(async () => {
        if (initialization.current) return
        const controller = new AbortController()
        initialization.current = controller
        setInitializing(true)
        setUi(state => ({ ...state, error: null }))
        try {
            const project = await projectCommand(sessionId, 'init', controller.signal)
            if (controller.signal.aborted) return
            checked.current = true
            setUi(state => ({ ...state, project }))
            refresh()
        } catch (error) {
            if (!controller.signal.aborted) {
                checked.current = false
                setUi(state => ({ ...state, error: error instanceof Error ? error.message : String(error) }))
                refresh()
            }
        } finally {
            initialization.current = null
            if (!controller.signal.aborted) setInitializing(false)
        }
    }, [sessionId, refresh])

    useEffect(() => {
        const controller = new AbortController()
        const token = ++generation.current
        if (!sessionId) { setUi({ loading: false, error: '请先打开一个写作会话。', progress: '', project: null }); return }
        setUi(state => ({ ...state, loading: true, progress: '' }))
        let scanRoot = ui.project?.scanRoot
        const inspect = async () => {
            const project = await projectCommand(sessionId, 'status', controller.signal)
            if (controller.signal.aborted || token !== generation.current) return null
            if (project.status !== 'ready') {
                clearScan(sessionId)
                setWatchRoot(null)
                checked.current = false
                setUi(state => ({ ...state, loading: false, project, progress: '' }))
                return project
            }
            checked.current = true
            scanRoot = project.scanRoot
            setUi(state => ({ ...state, project }))
            return project
        }
        void (async () => {
            if (!checked.current) {
                try {
                    const project = await inspect()
                    if (project === null || project.status !== 'ready') return
                } catch (error) {
                    if (!(error instanceof ProjectCommandUnavailableError)) throw error
                }
            }
            return scanNovel(sessionId, controller.signal, (done, total) => {
                if (!controller.signal.aborted && token === generation.current) setUi(state => ({ ...state, progress: `${done}/${total}` }))
            }, scanRoot)
        })().then(scan => {
            if (!scan) return
            if (controller.signal.aborted || token !== generation.current) return
            publishScan(scan, sessionId)
            setWatchRoot(scan.root === '.' ? '' : scan.root)
            setUi(state => ({ ...state, loading: false, error: null, progress: '' }))
        }).catch(async (error: unknown) => {
            if (controller.signal.aborted || token !== generation.current) return
            try {
                const project = await inspect()
                if (project && project.status !== 'ready') return
            } catch (inspectionError) {
                if (inspectionError instanceof ProjectCommandUnavailableError) error = inspectionError
            }
            if (!controller.signal.aborted && token === generation.current) setUi(state => ({ ...state, loading: false, project: state.project?.status === 'ready' ? state.project : null, error: error instanceof Error ? error.message : String(error), progress: '' }))
        })
        return () => controller.abort()
    }, [sessionId, nonce])

    const paths = bus.scan === null ? '' : [...new Set([
        ...bus.scan.graph.chapters.map(row => row.path.slice(0, row.path.lastIndexOf('/'))),
        ...(bus.scan.graph.characters.length ? ['characters'] : []),
        ...(bus.scan.graph.plots.length ? ['plots'] : []),
        ...(bus.scan.graph.worldEntries.length ? ['worldbuilding'] : []),
        ...(bus.scan.graph.styleRefs.length ? ['style'] : []),
        '.writer/derived/maintenance',
    ])].sort().join('\n')

    useEffect(() => {
        if (watchRoot === null || !sessionId) return
        const controller = new AbortController()
        const directories = [watchRoot, ...paths.split('\n').filter(Boolean).map(path => watchRoot ? `${watchRoot}/${path}` : path)]
        const ready = new Set<string>()
        let timer: ReturnType<typeof setTimeout> | undefined
        let unavailable = false
        publishWatchState(null, sessionId)
        const invalidate = () => {
            clearTimeout(timer)
            timer = setTimeout(() => { if (!controller.signal.aborted) reload() }, 600)
        }
        const run = async (path: string) => {
            for (let attempt = 0; attempt < 4 && !controller.signal.aborted; attempt++) {
                let connected = false
                const outcome = await watchProject(sessionId, path, controller.signal, invalidate, () => {
                    if (controller.signal.aborted) return
                    connected = true
                    ready.add(path)
                    if (!unavailable && ready.size === directories.length) publishWatchState(true, sessionId)
                    if (attempt > 0) invalidate()
                })
                if (controller.signal.aborted) return
                ready.delete(path)
                publishWatchState(false, sessionId)
                if (outcome === 'unsupported' || !connected || attempt === 3) { unavailable = true; return }
                await new Promise<void>(resolve => {
                    const timeout = setTimeout(done, 1000 * 2 ** attempt)
                    function done() { clearTimeout(timeout); controller.signal.removeEventListener('abort', done); resolve() }
                    controller.signal.addEventListener('abort', done, { once: true })
                })
            }
        }
        for (const path of directories) void run(path)
        return () => { controller.abort(); clearTimeout(timer) }
    }, [sessionId, watchRoot, paths, reload])

    return { ...ui, initializing, initialize, bus, refresh }
}
