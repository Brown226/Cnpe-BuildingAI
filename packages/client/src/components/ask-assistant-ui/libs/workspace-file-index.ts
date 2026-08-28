/**
 * 工作区文件索引（对齐 Kun workspace-file-index，适配 BuildingAI 的 desktopApi.fsList）。
 * BFS 遍历工作区目录，生成 ComposerFileReference 索引；带文本文件过滤、
 * 忽略目录、深度/目录/文件上限、TTL+LRU 缓存、路径式 @ 查询按需列目录。
 */
import {
  composerFileReferenceKey,
  isFileWithinDirectory,
  relativeWorkspacePath,
  type ComposerFileReference,
} from "./composer-file-references";
import { desktopApi } from "@/services/desktop/desktop-api";

const FILE_MENTION_TEXT_EXTENSIONS = new Set([
  ".astro", ".bash", ".c", ".cc", ".cjs", ".cpp", ".cs", ".css", ".csv", ".dart",
  ".env", ".fish", ".go", ".h", ".hpp", ".html", ".ini", ".java", ".js", ".json",
  ".jsx", ".kt", ".less", ".lock", ".log", ".md", ".mdx", ".mjs", ".php", ".py",
  ".rb", ".rs", ".sass", ".scss", ".sh", ".sql", ".svelte", ".swift", ".toml",
  ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
]);

const FILE_MENTION_TEXT_NAMES = new Set([
  ".env", ".gitignore", "dockerfile", "makefile", "package-lock.json", "pnpm-lock.yaml", "readme",
]);

const FILE_MENTION_IGNORED_DIRS = new Set([
  ".git", ".hg", ".svn", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "out",
]);

const FILE_MENTION_MAX_DEPTH = 10;
const FILE_MENTION_MAX_DIRECTORIES = 200;
const FILE_MENTION_MAX_FILES = 1600;
const FILE_MENTION_MAX_DIRECTORY_SUGGESTIONS = 400;
const FILE_MENTION_CACHE_TTL_MS = 30_000;
const MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES = 16;
const MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES = 128;

export type WorkspaceFileIndex = {
  files: ComposerFileReference[];
  directories: ComposerFileReference[];
  loadedAt: number;
};

/** BuildingAI fsList 返回的条目（无 path/ext，type 为 dir） */
type FsEntry = { name: string; type: "file" | "dir"; size?: number };

const workspaceFileIndexCache = new Map<string, WorkspaceFileIndex | Promise<WorkspaceFileIndex>>();
const workspaceMentionDirectoryCache = new Map<
  string,
  ComposerFileReference[] | Promise<ComposerFileReference[]>
>();

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name}`;
}

function entryExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function isMentionableWorkspaceFile(entry: FsEntry): boolean {
  if (entry.type !== "file") return false;
  const name = entry.name.toLowerCase();
  if (FILE_MENTION_TEXT_NAMES.has(name)) return true;
  const ext = entryExt(name);
  return ext ? FILE_MENTION_TEXT_EXTENSIONS.has(ext) : false;
}

function referenceFromEntry(
  entry: FsEntry,
  absolutePath: string,
  workspaceRoot: string,
  type: "file" | "directory",
): ComposerFileReference {
  return {
    path: absolutePath,
    relativePath: relativeWorkspacePath(absolutePath, workspaceRoot),
    name: entry.name,
    type,
  };
}

function trimCache<T>(cache: Map<string, T>, maxEntries: number, protectedKey?: string): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) return;
    if (oldestKey === protectedKey) {
      const protectedValue = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (protectedValue !== undefined) cache.set(oldestKey, protectedValue);
      continue;
    }
    cache.delete(oldestKey);
  }
}

function pruneWorkspaceFileIndexCache(now = Date.now()): void {
  for (const [key, value] of workspaceFileIndexCache) {
    if (!(value instanceof Promise) && now - value.loadedAt >= FILE_MENTION_CACHE_TTL_MS) {
      workspaceFileIndexCache.delete(key);
    }
  }
  trimCache(workspaceFileIndexCache, MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES);
}

async function buildWorkspaceFileIndex(root: string): Promise<WorkspaceFileIndex> {
  const files: ComposerFileReference[] = [];
  const directories: ComposerFileReference[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let visitedDirectories = 0;

  while (
    queue.length > 0 &&
    visitedDirectories < FILE_MENTION_MAX_DIRECTORIES &&
    files.length < FILE_MENTION_MAX_FILES
  ) {
    const current = queue.shift();
    if (!current) break;
    visitedDirectories += 1;
    const result = await desktopApi.fsList(current.path).catch(() => null);
    if (!result) continue;

    for (const entry of result.entries) {
      const absolutePath = joinPath(current.path, entry.name);
      if (entry.type === "dir") {
        if (FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())) continue;
        if (directories.length < FILE_MENTION_MAX_DIRECTORY_SUGGESTIONS) {
          directories.push(referenceFromEntry(entry, absolutePath, root, "directory"));
        }
        if (current.depth < FILE_MENTION_MAX_DEPTH) {
          queue.push({ path: absolutePath, depth: current.depth + 1 });
        }
        continue;
      }
      const entryAsFile: FsEntry = { name: entry.name, type: "file" };
      if (isMentionableWorkspaceFile(entryAsFile)) {
        files.push(referenceFromEntry(entryAsFile, absolutePath, root, "file"));
        if (files.length >= FILE_MENTION_MAX_FILES) break;
      }
    }
  }

  return { files, directories, loadedAt: Date.now() };
}

export async function loadWorkspaceFileIndex(workspaceRoot: string): Promise<WorkspaceFileIndex> {
  const root = workspaceRoot.trim();
  pruneWorkspaceFileIndexCache();
  const cached = workspaceFileIndexCache.get(root);
  if (cached && !(cached instanceof Promise) && Date.now() - cached.loadedAt < FILE_MENTION_CACHE_TTL_MS) {
    workspaceFileIndexCache.delete(root);
    workspaceFileIndexCache.set(root, cached);
    return cached;
  }
  if (cached instanceof Promise) return cached;

  const task = buildWorkspaceFileIndex(root);
  workspaceFileIndexCache.set(root, task);
  trimCache(workspaceFileIndexCache, MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES, root);
  try {
    const result = await task;
    workspaceFileIndexCache.delete(root);
    workspaceFileIndexCache.set(root, result);
    trimCache(workspaceFileIndexCache, MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES, root);
    return result;
  } catch (error) {
    workspaceFileIndexCache.delete(root);
    throw error;
  }
}

export function filesUnderDirectory(
  files: ComposerFileReference[],
  dirRelativePath: string,
): ComposerFileReference[] {
  return files.filter((file) => isFileWithinDirectory(file.relativePath, dirRelativePath));
}

/** 目录部分（path 式 @ 查询 `src/a/b/file` → `src/a/b`） */
export function mentionQueryDirectory(query: string): string | null {
  const normalized = query.replaceAll("\\", "/").replace(/\/+/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return null;
  return normalized.slice(0, lastSlash);
}

/** path 式 @ 查询按需列目录（BFS 索引受深度/目录上限约束，深路径文件也覆盖） */
export async function loadWorkspaceMentionPathSuggestions(
  workspaceRoot: string,
  query: string,
): Promise<ComposerFileReference[]> {
  const root = workspaceRoot.trim();
  if (!root) return [];
  const dir = mentionQueryDirectory(query);
  if (dir == null) return [];

  const cacheKey = `${root}::${dir}`;
  const cached = workspaceMentionDirectoryCache.get(cacheKey);
  if (cached) {
    workspaceMentionDirectoryCache.delete(cacheKey);
    workspaceMentionDirectoryCache.set(cacheKey, cached);
    return cached;
  }

  const task = (async () => {
    const result = await desktopApi.fsList(`${root.replace(/[\\/]+$/, "")}/${dir}`).catch(() => null);
    if (!result) return [];
    const references: ComposerFileReference[] = [];
    for (const entry of result.entries) {
      const absolutePath = joinPath(`${root.replace(/[\\/]+$/, "")}/${dir}`, entry.name);
      if (entry.type === "dir") {
        if (FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())) continue;
        references.push(referenceFromEntry(entry, absolutePath, root, "directory"));
      } else if (isMentionableWorkspaceFile({ name: entry.name, type: "file" })) {
        references.push(referenceFromEntry({ name: entry.name, type: "file" }, absolutePath, root, "file"));
      }
    }
    return references;
  })();

  workspaceMentionDirectoryCache.set(cacheKey, task);
  trimCache(workspaceMentionDirectoryCache, MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES, cacheKey);
  try {
    const references = await task;
    workspaceMentionDirectoryCache.delete(cacheKey);
    workspaceMentionDirectoryCache.set(cacheKey, references);
    trimCache(workspaceMentionDirectoryCache, MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES, cacheKey);
    setTimeout(() => {
      if (workspaceMentionDirectoryCache.get(cacheKey) === references) {
        workspaceMentionDirectoryCache.delete(cacheKey);
      }
    }, FILE_MENTION_CACHE_TTL_MS);
    return references;
  } catch (error) {
    workspaceMentionDirectoryCache.delete(cacheKey);
    throw error;
  }
}

export function clearWorkspaceFileIndexCaches(): void {
  workspaceFileIndexCache.clear();
  workspaceMentionDirectoryCache.clear();
}

export function workspaceFileIndexCacheSizes(): { indexes: number; mentionDirectories: number } {
  return {
    indexes: workspaceFileIndexCache.size,
    mentionDirectories: workspaceMentionDirectoryCache.size,
  };
}

/** 合并按需路径建议进索引候选，按 path 去重 */
export function mergeMentionCandidates(
  base: ComposerFileReference[],
  extra: ComposerFileReference[],
): ComposerFileReference[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map(composerFileReferenceKey));
  const merged = [...base];
  for (const reference of extra) {
    const key = composerFileReferenceKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(reference);
  }
  return merged;
}