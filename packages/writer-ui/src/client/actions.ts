interface ActionContext {
    sessions?: { binding(id: string): { ctx: unknown } | undefined }
    conversation?: { input: {
        for(ctx: unknown): { state: { getSnapshot(): { phase: string } } }
        requestDraftInitialization(binding: unknown, options: { prompt: string; whenDraftExists: 'append' }): 'applied' | 'preserved' | 'blocked'
    } }
}

export interface ActionOwner {
    inputActions?: { persistDraft(): void }
    openView?: (view: string, focus: string) => void
}

let context: ActionContext | null = null

export function setActionContext(value: ActionContext | null): void {
    context = value
}

export function appendRequest(sessionId: string, prompt: string, owner: ActionOwner): { status: 'applied' | 'preserved' | 'blocked' | 'unavailable'; message: string } {
    const input = context?.conversation?.input
    try {
        const binding = context?.sessions?.binding(sessionId)
        if (!input || !binding) return { status: 'unavailable', message: '当前会话或对话草稿服务不可用，可以复制要求到对话。' }
        const phase = input.for(binding.ctx).state.getSnapshot().phase
        if (phase !== 'plain') return { status: 'blocked', message: phase === 'claimed' ? '对话中已有命令草稿，请先处理该命令，再追加写作要求。' : '对话正在提交，请稍后重试；要求已保留。' }
        const result = input.requestDraftInitialization(binding, { prompt, whenDraftExists: 'append' })
        if (result !== 'applied') return { status: result, message: '尚未追加到对话草稿，要求已保留，可稍后重试或复制。' }
        try {
            owner.inputActions?.persistDraft()
            owner.openView?.('chat', '')
        } catch {
            return { status: 'applied', message: '要求已添加到草稿，保存或导航未完成；请手动切回对话核对，避免重复追加。' }
        }
        return { status: 'applied', message: '已添加到对话草稿，请在对话中发送。' }
    } catch (error) {
        return { status: 'unavailable', message: `无法准备对话草稿：${error instanceof Error ? error.message : String(error)}。可以复制要求。` }
    }
}
