/** 工作区条目（openwork WorkspaceWire 的最小子集） */
export interface WorkspaceEntry {
    /** ws_ + sha256(绝对路径)[:12] */
    id: string;
    /** 目录 basename，显示名 */
    name: string;
    /** 绝对路径（身份本体） */
    path: string;
    addedAt: number;
    /** C1 会话目录（Kun SidebarConversationsSection）：区别于项目工作区，侧栏归「对话」组 */
    kind?: "project" | "conversation";
}
