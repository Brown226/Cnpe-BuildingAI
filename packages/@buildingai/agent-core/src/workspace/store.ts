import fs from "node:fs";
import path from "node:path";

/**
 * 工作区白名单存储（ADR-06 硬规则的载体）。
 * 仅管理绝对目录路径；Containment 判定统一走本类，
 * 并用 realpath 消解符号链接逃逸。
 */
export class WorkspaceStore {
    private roots: string[] = [];

    setAll(dirs: string[]): void {
        this.roots = dirs.map((d) => norm(path.resolve(d))).filter((d) => {
            try {
                return fs.statSync(d).isDirectory();
            } catch {
                return false;
            }
        });
    }

    add(dir: string): boolean {
        const abs = norm(path.resolve(dir));
        if (this.roots.some((r) => r === abs)) return false;
        try {
            if (!fs.statSync(abs).isDirectory()) return false;
        } catch {
            return false;
        }
        this.roots.push(abs);
        return true;
    }

    remove(dir: string): boolean {
        const abs = norm(path.resolve(dir));
        const before = this.roots.length;
        this.roots = this.roots.filter((r) => r !== abs);
        return this.roots.length !== before;
    }

    list(): string[] {
        return [...this.roots];
    }

    /** 目标路径是否落在任一工作区内（含符号链接逃逸防护；根目录自身视为在内） */
    isInsideWorkspace(targetAbs: string): boolean {
        if (this.roots.length === 0) return false;
        let resolved: string;
        try {
            resolved = resolveReal(targetAbs);
        } catch {
            return false;
        }
        // 等于某个工作区根目录也算在内（list 根目录 / exec cwd 场景）
        if (this.roots.some((root) => root === resolved)) return true;
        return this.roots.some((root) => isInside(resolved, root));
    }
}

function samePath(a: string, b: string): boolean {
    return process.platform === "win32"
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;
}

/** Windows 下路径大小写不敏感：统一小写后参与比较 */
function norm(p: string): string {
    return process.platform === "win32" ? p.toLowerCase() : p;
}

function isInside(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** 解析目标自身及其最深已存在的祖先的真实路径，防符号链接与 .. 逃逸 */
function resolveReal(targetAbs: string): string {
    let current = path.resolve(targetAbs);
    const suffixes: string[] = [];
    while (current.length > 1) {
        try {
            let real = fs.realpathSync(current);
            // 把未存在部分重新拼接回去
            for (let i = suffixes.length - 1; i >= 0; i--) real = path.join(real, suffixes[i]!);
            return process.platform === "win32" ? real.toLowerCase() : real;
        } catch {
            const parentPath = path.dirname(current);
            suffixes.unshift(path.basename(current));
            if (parentPath === current) throw new Error("到达根目录仍未解析");
            current = parentPath;
        }
    }
    throw new Error("无法解析真实路径");
}
