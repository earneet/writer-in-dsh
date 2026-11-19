import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { clearScan, publishScan, publishWatchState, readBus, subscribeBus } from './bus.ts'
import { ProjectCommandUnavailableError, projectCommand, scanNovel, watchProject } from './load.ts'
import type { WorkspaceProjectState } from 'dsh-writer-core'

export function useProject(sessionId: string, scanEnabled = true) {
    const snapshot = useCallback(() => readBus(sessionId), [sessionId])
    const bus = useSyncExternalStore(subscribeBus, snapshot, snapshot)
    const [ui, setUi] = useState({ loading: false, error: null as string | null, progress: '', project: null as WorkspaceProjectState | null })
    const [initializing, setInitializing] = useState(false)
    const [didInitialize, setDidInitialize] = useState(false)
    const initialization = useRef<AbortController | null>(null)
    const checked = useRef(false)
    const [nonce, setNonce] = useState(0)
    const [watchDirectories, setWatchDirectories] = useState<string[]>([])
    const generation = useRef(0)
    const reload = useCallback(() => setNonce(value => value + 1), [])
    const refresh = useCallback(() => {
        checked.current = false
        setUi(state => ({ ...state, error: null }))
        reload()
    }, [reload])

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
            setDidInitialize(true)
            refresh()
        } catch (error) {
            if (!controller.signal.aborted) {
                checked.current = false
                setUi(state => ({ ...state, error: error instanceof Error ? error.message : String(error) }))
                reload()
            }
        } finally {
            initialization.current = null
            if (!controller.signal.aborted) setInitializing(false)
        }
    }, [sessionId, refresh, reload])

    useEffect(() => {
        const controller = new AbortController()
        const token = ++generation.current
        if (!sessionId) { setUi({ loading: false, error: '请先打开一个写作会话。', progress: '', project: null }); return }
        setUi(state => ({ ...state, loading: true, progress: '' }))
        let scanRoot = ui.project?.scanRoot
        const inspect = async () => {
            const project = await projectCommand(sessionId, 'status', controller.signal)
            if (controller.signal.aborted || token !== generation.current) return null
            if (!scanEnabled) {
                setUi(state => ({ ...state, loading: false, project }))
                return project
            }
            if (project.status !== 'ready') {
                clearScan(sessionId)
                setWatchDirectories([])
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
            if (!scanEnabled) {
                await inspect()
                return
            }
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
            setWatchDirectories(previous => previous.length === scan.watchDirectories.length && previous.every((path, index) => path === scan.watchDirectories[index]) ? previous : scan.watchDirectories)
            setUi(state => ({ ...state, loading: false, error: null, progress: '' }))
        }).catch(async (error: unknown) => {
            if (controller.signal.aborted || token !== generation.current) return
            if (!scanEnabled) {
                setUi(state => ({ ...state, loading: false, project: null, error: error instanceof ProjectCommandUnavailableError ? null : error instanceof Error ? error.message : String(error) }))
                return
            }
            try {
                const project = await inspect()
                if (project && project.status !== 'ready') return
            } catch (inspectionError) {
                if (inspectionError instanceof ProjectCommandUnavailableError) error = inspectionError
            }
            if (!controller.signal.aborted && token === generation.current) setUi(state => ({ ...state, loading: false, project: state.project?.status === 'ready' ? state.project : null, error: error instanceof Error ? error.message : String(error), progress: '' }))
        })
        return () => controller.abort()
    }, [sessionId, nonce, scanEnabled])

    useEffect(() => {
        if (!watchDirectories.length || !sessionId) return
        const controller = new AbortController()
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
                    if (!unavailable && ready.size === watchDirectories.length) publishWatchState(true, sessionId)
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
        for (const path of watchDirectories) void run(path)
        return () => { controller.abort(); clearTimeout(timer) }
    }, [sessionId, watchDirectories, reload])

    return { ...ui, initializing, didInitialize, initialize, bus, refresh }
}
