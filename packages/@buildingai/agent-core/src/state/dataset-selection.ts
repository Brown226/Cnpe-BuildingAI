/**
 * 会话级知识库挂载注册表（对齐 Kun thread knowledgeBases 语义）：
 * 桌面端输入条的「知识库」选择器随每轮 session.send 下发所选数据集 id，
 * 侧车进程按会话记录；dataset_search 工具执行时按 sessionId 取当前挂载集合。
 * 生命周期与会话一致：进程退出即失效（会话本身也不跨进程持久挂载状态）。
 */

/** sessionId → 已挂载的数据集 id 列表（保持用户选择顺序） */
const selection = new Map<string, string[]>();

export function setDatasetSelection(sessionId: string, datasetIds: string[]): void {
    const ids = [...new Set(datasetIds.filter((id) => typeof id === "string" && id.trim()))];
    if (ids.length === 0) {
        selection.delete(sessionId);
        return;
    }
    selection.set(sessionId, ids);
}

export function getDatasetSelection(sessionId: string): string[] {
    return selection.get(sessionId) ?? [];
}
