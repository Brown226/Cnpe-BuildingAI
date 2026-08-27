/**
 * 全局快捷键注册表（T2.2，Kun shared/keyboard-shortcuts 语义）。
 * 只拦截已注册的组合键；输入框内复制粘贴等不受影响。
 * 组合键规范：ctrl+k / ctrl+shift+p / alt+1 …
 */
type Handler = () => void;
const handlers = new Map<string, Handler>();
let installed = false;

function comboOf(e: KeyboardEvent): string | null {
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    const key = e.key.toLowerCase();
    if (key.length === 1) parts.push(key);
    else if (key === " ") parts.push("space");
    else if (["escape", "enter", "tab", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
        parts.push(key);
    else return null;
    return parts.join("+");
}

export function registerShortcut(combo: string, handler: Handler): () => void {
    handlers.set(combo, handler);
    return () => {
        if (handlers.get(combo) === handler) handlers.delete(combo);
    };
}

/** 安装全局 keydown 监听（幂等，进程内一次） */
export function installGlobalKeymap(): void {
    if (installed) return;
    installed = true;
    window.addEventListener("keydown", (e) => {
        const combo = comboOf(e);
        if (!combo) return;
        const handler = handlers.get(combo);
        if (handler) {
            e.preventDefault();
            handler();
        }
    });
}
