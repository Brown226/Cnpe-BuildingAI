import { MODEL_FEATURES, type ModelFeatureType } from "@buildingai/ai-sdk/interfaces";

import { MODEL_SPECS } from "./model-specs.data";

// —— 兜底启发式（仅用于规格表未收录的模型） ——

/** 主流支持工具调用/结构化输出的大模型厂商族名称标记 */
const TOOL_CALLING_MODELS =
  /gpt|o1|o3|o4|claude|gemini|deepseek|glm|qwen|ernie|doubao|kimi|moonshot|llama|mistral|minimax|spark|hunyuan|baichuan|grok|intern|command/i;

/** 推理/深度思考模型命名标记（o 系列、R1、Think 等） */
const REASONING_MODEL = /(thinking|reasoner|reasoning|o1|o3|o4|r1|qwq|deepseek.*think|glm-4\.6)/;

/** 多模态命名标记 */
const VISION_MODEL = /(vision|vlm|\bvl\b|4o|4v|omni|gemini|claude|internvl|llava|glm-4v|florence|qvq|phi-4v)/;
const AUDIO_MODEL = /(audio|omni|realtime|voice|whisper|tts|speech|gemini|4o)/;
const DOCUMENT_MODEL = /(document|file|gemini|claude|4o|analysis)/;
const VIDEO_MODEL = /video|gemini/;

function isReasoningModel(id: string, modelType?: string): boolean {
  return (!modelType || modelType === "llm") && REASONING_MODEL.test(id);
}

type SpecRecord = {
  maxContext?: number;
  maxOutput?: number;
  features?: ModelFeatureType[];
  thinking?: boolean;
  enableThinkingParam?: boolean;
};

/** 查规格表：精确匹配 → 最长前缀匹配 → 去掉 "vendor/" 前缀后再匹配 */
function lookupSpec(modelId: string): SpecRecord | null {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return null;

  const toRecord = (entry: (typeof MODEL_SPECS)[number]): SpecRecord => ({
    maxContext: entry[1] ?? undefined,
    features: entry[2] ? (entry[2].split("|") as ModelFeatureType[]) : undefined,
    thinking: entry[3],
    enableThinkingParam: entry[4],
  });

  let prefixHit: (typeof MODEL_SPECS)[number] | undefined;
  for (const entry of MODEL_SPECS) {
    if (entry[0] === id) return toRecord(entry);
    // 记录最长前缀命中（表已按 id 长度降序排列，首个命中即最长）
    if (!prefixHit && id.startsWith(entry[0])) prefixHit = entry;
  }
  if (prefixHit) return toRecord(prefixHit);

  // 形如 "openai/gpt-5.1" 的 id 与不带厂商前缀的标识互查
  const bare = id.includes("/") ? id.split("/").pop()! : undefined;
  if (bare) {
    for (const entry of MODEL_SPECS) {
      if (entry[0] === bare || entry[0].endsWith(`/${bare}`)) return toRecord(entry);
    }
  }
  return null;
}

/**
 * 已知模型的“最大输出”补充表（种子数据只有上下文，没有输出上限）。
 * 数字来源：各厂商公开文档；未命中时表单保持默认值。
 */
const MAX_OUTPUT_OVERRIDES: Array<[prefix: string, maxOutput: number]> = [
  ["deepseek-v4", 284000],
  ["deepseek-reasoner", 65536],
  ["deepseek-chat", 8192],
  ["deepseek-coder", 8192],
  ["gpt-4.1", 32768],
  ["gpt-4o", 16384],
  ["chatgpt-4o", 16384],
  ["gpt-4-turbo", 4096],
  ["gpt-4", 4096],
  ["o4-mini", 100000],
  ["o3-mini", 100000],
  ["o3", 100000],
  ["o1-mini", 65536],
  ["o1", 100000],
  ["claude-3-7-sonnet", 64000],
  ["claude-3-5", 8192],
  ["claude-3", 4096],
  ["gemini-2.5", 65536],
  ["gemini-2.0", 8192],
  ["gemini-1.5", 8192],
  ["qwen", 8192],
];

function lookupMaxOutput(id: string): number | undefined {
  for (const [prefix, value] of MAX_OUTPUT_OVERRIDES) {
    if (id.startsWith(prefix)) return value;
  }
  return undefined;
}

export type ModelSpecs = { maxContext?: number; maxOutput?: number };

/**
 * 根据模型标识符推断“最大上下文/最大输出”。
 * 数据优先取自平台种子规格表（精确/前缀/去厂商前缀三级匹配），未收录时不填写。
 */
export function detectModelSpecs(modelId: string): ModelSpecs {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return {};

  const spec = lookupSpec(id);
  const result: ModelSpecs = {};
  if (spec?.maxContext !== undefined) result.maxContext = spec.maxContext;
  const maxOutput = lookupMaxOutput(id) ?? spec?.maxOutput;
  if (maxOutput !== undefined) result.maxOutput = maxOutput;
  return result;
}

/**
 * 根据模型标识符（及模型类型）推断模型能力，用于表单自动预填。
 * 规格表已收录的模型直接采用其官方能力列表；未收录的按命名约定启发式识别。
 * 识别结果属于建议值，用户可手动增减。
 */
export function detectModelFeatures(
  modelId: string,
  modelType?: string,
): ModelFeatureType[] {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return [];

  const spec = lookupSpec(id);
  if (spec?.features) return spec.features;

  const result: ModelFeatureType[] = [];
  const add = (...features: ModelFeatureType[]) => {
    for (const feature of features) {
      if (!result.includes(feature)) result.push(feature);
    }
  };

  // 多模态理解能力（图片/语音/文档/视频命名）
  if (VISION_MODEL.test(id)) add(MODEL_FEATURES.VISION);
  if (AUDIO_MODEL.test(id)) add(MODEL_FEATURES.AUDIO);
  if (DOCUMENT_MODEL.test(id)) add(MODEL_FEATURES.DOCUMENT);
  if (VIDEO_MODEL.test(id)) add(MODEL_FEATURES.VIDEO);

  // 推理与工具调用（仅对话类模型）
  if (!modelType || modelType === "llm") {
    if (isReasoningModel(id, modelType)) add(MODEL_FEATURES.AGENT_THOUGHT);
    if (TOOL_CALLING_MODELS.test(id)) {
      add(
        MODEL_FEATURES.TOOL_CALL,
        MODEL_FEATURES.MULTI_TOOL_CALL,
        MODEL_FEATURES.STREAM_TOOL_CALL,
        MODEL_FEATURES.STRUCTURED_OUTPUT,
      );
    }
  }

  // 语音识别/语音合成类型直接具备音频能力
  if (modelType === "speech2text" || modelType === "tts") {
    add(MODEL_FEATURES.AUDIO);
  }

  return result;
}

export type ModelThinkingConfig = {
  thinking: boolean;
  enableThinkingParam: boolean;
};

/**
 * 依据模型标识符推断“允许深度思考/传递思考参数”开关，与能力识别同源。
 * 规格表已收录的模型直接采用其配置；未收录的推理模型（o1/o3/o4/R1/Think 等）默认同开。
 */
export function detectThinkingConfig(
  modelId: string,
  modelType?: string,
): ModelThinkingConfig {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return { thinking: false, enableThinkingParam: false };

  const spec = lookupSpec(id);
  if (spec && spec.thinking !== undefined) {
    return { thinking: spec.thinking, enableThinkingParam: spec.enableThinkingParam ?? false };
  }
  const reasoning = isReasoningModel(id, modelType);
  return { thinking: reasoning, enableThinkingParam: reasoning };
}
