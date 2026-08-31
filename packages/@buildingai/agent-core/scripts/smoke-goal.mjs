/**
 * #1 目标验收模式冒烟：纯逻辑（触发解析除外，覆盖判定/提示词/todo 解析）。
 * 用法：先 `pnpm build` 产出 dist，再 `node scripts/smoke-goal.mjs`。
 */
import {
    ACCEPTANCE_FAIL_MARKER,
    ACCEPTANCE_PASS_MARKER,
    buildAcceptancePrompt,
    buildGoalWorkInstruction,
    evaluateAcceptanceRound,
    GOAL_MAX_ACCEPTANCE_ROUNDS,
    parseTodoIncomplete,
} from "../dist/engine/goal-acceptance.js";

let failures = 0;
function check(name, cond, detail = "") {
    if (cond) console.log(`  PASS ${name}`);
    else {
        failures += 1;
        console.error(`  FAIL ${name} ${detail}`);
    }
}

console.log("== #1 目标验收：提示词构造 ==");
const work = buildGoalWorkInstruction("给报告加封面");
check("工作包装含原始目标", work.includes("给报告加封面"));
check("工作包装声明 6 轮上限", work.includes("6 轮"));
const prompt3 = buildAcceptancePrompt("给报告加封面", 3);
check("验收轮 3 提示词含轮次号与原始目标", prompt3.includes("验收轮 3") && prompt3.includes("给报告加封面"));
check("提示词含通过/未通过标记", prompt3.includes(ACCEPTANCE_PASS_MARKER) && prompt3.includes(ACCEPTANCE_FAIL_MARKER));

console.log("== #1 目标验收：轮次判定 ==");
check("todo 未清 → 未通过（机械判定优先）", evaluateAcceptanceRound({ roundText: `xxx ${ACCEPTANCE_PASS_MARKER}`, incompleteTodos: 2 }).passed === false);
check("未通过标记 → 未通过且取行内原因", (() => {
    const v = evaluateAcceptanceRound({
        roundText: `证据：检查了文件。\n${ACCEPTANCE_FAIL_MARKER}：封面页缺失`,
        incompleteTodos: 0,
    });
    return v.passed === false && v.reason.includes("封面页缺失");
})());
check("通过标记 → 通过", evaluateAcceptanceRound({ roundText: `验证完成 ${ACCEPTANCE_PASS_MARKER}`, incompleteTodos: 0 }).passed === true);
check("无失败信号 → 默认通过", evaluateAcceptanceRound({ roundText: "逐项核对了交付物，均符合。", incompleteTodos: null }).passed === true);
check("todo 快照缺失不误判", evaluateAcceptanceRound({ roundText: "", incompleteTodos: null }).passed === true);

console.log("== #1 目标验收：todo 快照解析 ==");
check("标准快照数未完成", parseTodoIncomplete({ details: { tasks: [{ status: "completed" }, { status: "pending" }, { status: "in_progress" }] } }) === 2);
check("deleted 墓碑不计", parseTodoIncomplete({ details: { tasks: [{ status: "deleted" }, { status: "completed" }] } }) === 0);
check("全部完成返回 0", parseTodoIncomplete({ details: { tasks: [{ status: "completed" }] } }) === 0);
check("非 todo 结果返回 null", parseTodoIncomplete({ summary: "ok" }) === null);
check("畸形输入返回 null", parseTodoIncomplete(null) === null && parseTodoIncomplete("garbage") === null);
check("上限为 6", GOAL_MAX_ACCEPTANCE_ROUNDS === 6);

if (failures > 0) {
    console.error(`SMOKE-FAIL：${failures} 项未过`);
    process.exit(1);
}
console.log("SMOKE-ALL-PASS");
