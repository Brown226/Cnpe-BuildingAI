import { MarkdownPlugin, remarkMdx, remarkMention } from "@platejs/markdown";
import type { SlatePlugin } from "platejs";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// MarkdownPlugin.configure 的泛型与 platejs SlatePlugin 在
// remark/platejs 版本交错下存在深层类型错配，运行时行为一致，断言收口。
export const MarkdownKit: SlatePlugin[] = [
  MarkdownPlugin.configure({
    options: {
      plainMarks: [],
      remarkPlugins: [remarkMath, remarkGfm, remarkMdx, remarkMention],
    },
  }),
] as unknown as SlatePlugin[];
