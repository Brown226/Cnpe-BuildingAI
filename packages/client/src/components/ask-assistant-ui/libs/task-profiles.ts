/**
 * 任务档案（对齐 Kun FloatingComposerTaskProfile 的 profile 概念）：
 * 选择本轮任务形态 → role 指令随 session.send（agentRole 链路）注入引擎。
 * surface（code/design）由全局模式 Tab 承担（我方无设计面），故只留 profile 档位。
 */
export interface TaskProfileDef {
    id: string;
    label: string;
    description: string;
    /** 注入引擎的指令段落（拼进 agentRole） */
    prompt: string;
}

export const TASK_PROFILES: TaskProfileDef[] = [
    {
        id: "standard",
        label: "标准",
        description: "平衡质量与速度的默认工作方式",
        prompt: "按领域最佳实践完成当前任务，先理解需求再动手，重要改动先说明方案。",
    },
    {
        id: "architect",
        label: "架构师",
        description: "优先整体设计、边界与可维护性",
        prompt: "此任务以架构视角执行：先梳理设计与边界，强调模块划分、接口稳定与可维护性，并说明关键取舍。",
    },
    {
        id: "reviewer",
        label: "审查者",
        description: "以审查视角核对问题与风险",
        prompt: "此任务以审查视角执行：核对产出与需求的一致性，主动找出缺陷、风险与遗漏并给出修复建议。",
    },
    {
        id: "researcher",
        label: "研究员",
        description: "先调研与求证，再给结论",
        prompt: "此任务以研究视角执行：先搜集事实与依据，标注不确定之处，再基于证据给出结论。",
    },
];

export function taskProfileById(id: string | null | undefined): TaskProfileDef | undefined {
    return TASK_PROFILES.find((p) => p.id === id);
}
