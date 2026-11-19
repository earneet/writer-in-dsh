import type { PendingSection } from './types.ts'

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
export function pendingConfirmationRequest(section: PendingSection, line: string, pendingPath: string): string | undefined {
    const { chapterId, sourceHash, heading, state } = section
    if (state !== 'current' || chapterId === undefined || sourceHash === undefined) return undefined
    return [
        `请用宿主文件工具重读 ${pendingPath}，核对“${heading}”一节仍在活跃清单中，下列建议及其源章稿哈希仍一致，并确认该节之后没有 chapter/${chapterId} 的重算标记。`,
        `用 writer_read(entity="chapter", id="${chapterId}") 核对当前章稿的完整 hash。源章稿哈希：${sourceHash}。`,
        `待核对的建议原文：\n\n${line}`,
        '如果建议已作废、找不到或无法读取任一来源，或哈希不一致，请停止处理并说明原因。',
        '请读取相关权威实体并向我说明依据及拟修改内容，等待我明确同意。写入前再次核对待办和章稿，确认仍然有效，再按目标工具的要求使用最新 expectHash 更新我明确同意的权威记录。请保留待办原文。',
    ].join('\n\n')
}
