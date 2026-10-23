import { existsSync, realpathSync, promises as fs } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { createHash } from "node:crypto";

export interface ShadowFileEntry {
  status: "A" | "M";
  originalSha256?: string;
  originalSize?: number;
  capturedAt: string;
}

export interface ShadowManifest {
  runId: string;
  files: Record<string, ShadowFileEntry>;
}

export const MAX_SHADOW_FILE_SIZE = 256 * 1024; // 256KB per file
export const MAX_TOTAL_SHADOW_BYTES = 20 * 1024 * 1024; // 20MB total quota

export function shadowBaseDir(wsPath: string): string {
  return join(wsPath, ".company", "shadow");
}

export function shadowRunDir(wsPath: string, runId: string): string {
  return join(shadowBaseDir(wsPath), runId);
}

export function manifestFilePath(wsPath: string, runId: string): string {
  return join(shadowRunDir(wsPath, runId), ".manifest.json");
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Capture shadow copy of a file before a tool modifies it in a run.
 * Guaranteed never to throw or disrupt the role's execution.
 */
export async function captureShadow(wsPath: string, runId: string, filePath: string): Promise<void> {
  try {
    if (!wsPath || !runId || !filePath) return;

    // Resolve target path within workspace
    const norm = normalizeRelPath(filePath);
    const fullTarget = resolve(wsPath, norm);
    const relFromWs = relative(wsPath, fullTarget);
    if (relFromWs.startsWith("..") || relFromWs.startsWith(".company")) {
      return; // Do not shadow files outside workspace or inside .company
    }

    const cleanRelPath = normalizeRelPath(relFromWs);
    const runDir = shadowRunDir(wsPath, runId);
    const manifestPath = manifestFilePath(wsPath, runId);

    // Read or init manifest
    let manifest: ShadowManifest = { runId, files: {} };
    if (existsSync(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        manifest = JSON.parse(raw);
        if (!manifest.files) manifest.files = {};
      } catch {
        manifest = { runId, files: {} };
      }
    }

    // Only capture on first modification within this run
    if (manifest.files[cleanRelPath]) {
      return;
    }

    const now = new Date().toISOString();

    if (!existsSync(fullTarget)) {
      // File does not exist yet -> Added file ("A")
      manifest.files[cleanRelPath] = {
        status: "A",
        capturedAt: now,
      };
    } else {
      // File exists -> Modified file ("M")
      const stat = await fs.stat(fullTarget);
      if (stat.isFile()) {
        const size = stat.size;
        let sha256: string | undefined;

        if (size <= MAX_SHADOW_FILE_SIZE) {
          const content = await fs.readFile(fullTarget);
          sha256 = createHash("sha256").update(content).digest("hex");

          // Save shadow backup file
          const destShadowFile = join(runDir, cleanRelPath);
          await fs.mkdir(dirname(destShadowFile), { recursive: true });
          await fs.writeFile(destShadowFile, content);
        }

        manifest.files[cleanRelPath] = {
          status: "M",
          originalSize: size,
          originalSha256: sha256,
          capturedAt: now,
        };
      }
    }

    // Save manifest
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    // Enforce quota
    await enforceShadowQuota(wsPath).catch(() => {});
  } catch (err) {
    // Non-fatal, never break the role execution
    console.warn(`[shadow] failed to capture shadow for ${filePath} in run ${runId}:`, err);
  }
}

const VALID_RUN_ID = /^[a-zA-Z0-9_-]+$/;

function isInsideDir(child: string, parent: string): boolean {
  const normChild = process.platform === "win32" ? child.toLowerCase() : child;
  const normParent = process.platform === "win32" ? parent.toLowerCase() : parent;
  return normChild === normParent || normChild.startsWith(normParent.endsWith(sep) ? normParent : normParent + sep);
}

/**
 * Enforce 20MB total shadow quota using FIFO cleanup of oldest run directories.
 */
export async function enforceShadowQuota(wsPath: string, maxBytes: number = MAX_TOTAL_SHADOW_BYTES): Promise<void> {
  const baseDir = shadowBaseDir(wsPath);
  if (!existsSync(baseDir)) return;

  const lstatBase = await fs.lstat(baseDir).catch(() => null);
  if (!lstatBase || lstatBase.isSymbolicLink()) return;

  const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
  const runDirs: Array<{ name: string; fullPath: string; mtimeMs: number; size: number }> = [];

  let totalBytes = 0;

  const realBase = existsSync(baseDir) ? realpathSync(baseDir) : baseDir;

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    if (!VALID_RUN_ID.test(entry.name)) continue;

    const fullPath = join(baseDir, entry.name);
    try {
      const realEntry = realpathSync(fullPath);
      if (!isInsideDir(realEntry, realBase)) continue;

      const dirInfo = await getDirSizeAndMtime(fullPath);
      runDirs.push({ name: entry.name, fullPath, mtimeMs: dirInfo.mtimeMs, size: dirInfo.totalBytes });
      totalBytes += dirInfo.totalBytes;
    } catch {
      // Skip unreadable dirs
    }
  }

  if (totalBytes <= maxBytes) return;

  // Sort oldest first (FIFO)
  runDirs.sort((a, b) => a.mtimeMs - b.mtimeMs);

  for (const dir of runDirs) {
    if (totalBytes <= maxBytes) break;
    try {
      await fs.rm(dir.fullPath, { recursive: true, force: true });
      totalBytes -= dir.size;
    } catch {
      // Ignore cleanup error
    }
  }
}

async function getDirSizeAndMtime(dirPath: string): Promise<{ totalBytes: number; mtimeMs: number }> {
  let totalBytes = 0;
  let oldestMtime = Infinity;

  async function walk(cur: string) {
    const list = await fs.readdir(cur, { withFileTypes: true });
    for (const item of list) {
      if (item.isSymbolicLink()) continue;
      const p = join(cur, item.name);
      const s = await fs.lstat(p);
      if (s.mtimeMs < oldestMtime) oldestMtime = s.mtimeMs;
      if (item.isDirectory()) {
        await walk(p);
      } else {
        totalBytes += s.size;
      }
    }
  }

  await walk(dirPath);
  return { totalBytes, mtimeMs: oldestMtime === Infinity ? Date.now() : oldestMtime };
}

/**
 * Retrieve list of file changes for a specific run from its manifest.
 */
export async function getRunChanges(wsPath: string, runId: string): Promise<Array<{ path: string; status: "A" | "M" }>> {
  const manifestPath = manifestFilePath(wsPath, runId);
  if (!existsSync(manifestPath)) return [];

  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest: ShadowManifest = JSON.parse(raw);
    const result: Array<{ path: string; status: "A" | "M" }> = [];
    for (const [path, entry] of Object.entries(manifest.files || {})) {
      result.push({ path, status: entry.status });
    }
    result.sort((a, b) => a.path.localeCompare(b.path));
    return result;
  } catch {
    return [];
  }
}

/**
 * Get shadow content of a file for a run.
 * Returns null if file was created newly ("A") or no shadow copy exists.
 */
export async function getShadowFileContent(wsPath: string, runId: string, relPath: string): Promise<string | null> {
  const norm = normalizeRelPath(relPath);
  const shadowFile = join(shadowRunDir(wsPath, runId), norm);
  if (!existsSync(shadowFile)) return null;

  try {
    return await fs.readFile(shadowFile, "utf-8");
  } catch {
    return null;
  }
}
