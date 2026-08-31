/**
 * #1 目标验收模式（移植 Yan-Agent opencode-sidecar 的 Goal Acceptance，MIT）。
 *
 * 触发：`/goal <目标>` 前缀（引擎侧解析，index.ts）或 session.send 直接置 goal 标志。
 * 语义：用户请求是"带验收标准的目标"，不是"要一份早期草稿"——工作阶段完成后，
 * 引擎以原始目标回头验收，最多 GOAL_MAX_ACCEPTANCE_ROUNDS 轮：
 * - 每轮要求只陈述具体验证/修复证据（禁止用户向总结），可做最小修复
 * - 机械失败判定：todo 快照存在未完成项（Yan 同款）
 * - 显式判定：轮次文本含 ACCEPTANCE_FAIL_MARKER → 未通过（原因取该行）；
 *   含 ACCEPTANCE_PASS_MARKER 或无失败信号 → 通过
 * - 轮次耗尽仍未通过：推送最终 failed（reason 携带轮次上限），由 Y3 总结轮
 *   报告未解决项收尾
 *
 * 纯逻辑模块；事件泵集成在 PiEngine.beginTurn。
 */

export const GOAL_MAX_ACCEPTANCE_ROUNDS = 6;
export const ACCEPTANCE_PASS_MARKER = "验收结果：通过";
export const ACCEPTANCE_FAIL_MARKER = "验收结果：未通过";

/** 工作阶段包装：让模型知道交付将被按原始目标验收（Yan goal 模式提示词语义） */
export function buildGoalWorkInstruction(goal: string): string {
    return [
        "【目标验收模式】用户的请求是一个带验收标准的目标，不是要一份早期草稿。",
        "完成实现后，引擎会按下面的原始目标逐轮回头验收（最多 6 轮）：",
        "请把待办清单（todo）维护到全部完成，并确保交付物经得起验证。",
        "",
        `原始目标：${goal}`,
    ].join("\n");
}

/** 验收轮提示词：重发原始目标，只取证与最小修复（Yan goalAcceptancePrompt 语义） */
export function buildAcceptancePrompt(originalGoal: string, round: number): string {
    return [
        `【目标验收轮 ${round}】`,
        "工作阶段已结束。现在按原始目标逐项验收：",
        "1. 用只读方式核对每个验收点（读文件/跑验证命令/检查产物），只陈述具体的验证证据或修复动作，不要面向用户做总结。",
        "2. 若发现未达标项：做最小修复（不得借机扩大改动面），然后继续取证。",
        "3. 待办清单必须全部 completed。",
        "4. 最后单独一行输出判定：",
        `   - 通过：${ACCEPTANCE_PASS_MARKER}`,
        `   - 未通过：${ACCEPTANCE_FAIL_MARKER}：<具体原因>`,
        "",
        `原始目标：${originalGoal}`,
    ].join("\n");
}

export interface AcceptanceVerdict {
    passed: boolean;
    reason: string;
}

/**
 * 轮次判定（确定性规则，Yan 的 todo 机械检查 + 显式标记）：
 * - todo 快照存在未完成项 → 未通过（机械判定优先）
 * - 轮次文本含未通过标记 → 未通过（原因取标记行内容）
 * - 其余（含通过标记或仅完成取证陈述）→ 通过
 */
export function evaluateAcceptanceRound(args: {
    roundText: string;
    incompleteTodos: number | null;
}): AcceptanceVerdict {
    const { roundText, incompleteTodos } = args;
    if (incompleteTodos !== null && incompleteTodos > 0) {
        return { passed: false, reason: `待办清单还有 ${incompleteTodos} 项未完成` };
    }
    const text = String(roundText ?? "");
    if (text.includes(ACCEPTANCE_FAIL_MARKER)) {
        const line = text
            .split("\n")
            .find((l) => l.includes(ACCEPTANCE_FAIL_MARKER));
        const reason = line?.split(ACCEPTANCE_FAIL_MARKER)[1]?.trim() || "模型自报未通过";
        return { passed: false, reason };
    }
    return { passed: true, reason: text.includes(ACCEPTANCE_PASS_MARKER) ? "模型自报通过" : "无失败信号" };
}

/**
 * 从 todo 扩展的工具结果快照数未完成项（防御式解析）。
 * 快照形态：{ details: { tasks: [{ status: "pending"|"in_progress"|"completed"|"deleted" }] } }。
 * 非 todo 结果 / 形态不符返回 null（调用方保持上次快照）。
 */
export function parseTodoIncomplete(result: unknown): number | null {
    if (!result || typeof result !== "object") return null;
    const details = (result as { details?: unknown }).details;
    if (!details || typeof details !== "object") return null;
    const tasks = (details as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return null;
    return tasks.filter(
        (task) =>
            task &&
            typeof task === "object" &&
            typeof (task as { status?: unknown }).status === "string" &&
            (task as { status: string }).status !== "completed" &&
            (task as { status: string }).status !== "deleted",
    ).length;
}
