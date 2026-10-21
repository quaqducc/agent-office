import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SYSTEM_DIRS = new Set([
  "$recycle.bin",
  "system volume information",
  "windows",
  "recovery",
  "proc",
  "sys",
  "dev",
]);

let drivesCache: { data: { roots: string[]; home: string }; ts: number } | null = null;

export function clearDrivesCache() {
  drivesCache = null;
}

export function assertSafeWindowsPath(p: string) {
  if (process.platform === "win32") {
    if (p.startsWith("\\\\") || p.startsWith("//")) {
      throw new Error("UNC and device paths are not allowed");
    }
    const resolved = resolve(p);
    if (!/^[a-zA-Z]:[\\/]/.test(resolved)) {
      throw new Error("invalid Windows drive path");
    }
  }
}

export function getDrives(now = Date.now()): { roots: string[]; home: string } {
  if (drivesCache && now - drivesCache.ts < 60_000) {
    return drivesCache.data;
  }

  const home = homedir();
  let roots: string[];
  if (process.platform === "win32") {
    roots = [];
    for (let i = 65; i <= 90; i++) {
      const drive = String.fromCharCode(i) + ":\\";
      try {
        if (existsSync(drive)) roots.push(drive);
      } catch {}
    }
    if (!roots.length) roots = ["C:\\"];
  } else {
    roots = ["/"];
  }

  const data = { roots, home };
  drivesCache = { data, ts: now };
  return data;
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  home: string;
  roots: string[];
  folders: { name: string; path: string }[];
  truncated?: boolean;
  error?: string;
}

export async function browseDirectory(
  targetPath?: string,
  customReaddir: (path: string, options: { withFileTypes: true }) => Promise<any[]> = readdir as any,
): Promise<BrowseResult> {
  const { roots, home } = getDrives();
  const raw = targetPath?.trim();
  if (raw) {
    assertSafeWindowsPath(raw);
  }
  const current = raw ? resolve(raw) : (home && existsSync(home) ? home : roots[0]);
  assertSafeWindowsPath(current);

  let curStat;
  try {
    curStat = await stat(current);
  } catch {
    throw new Error("folder not found or not a directory");
  }
  if (!curStat.isDirectory()) throw new Error("folder not found or not a directory");

  const parent = resolve(current) === resolve(dirname(current)) ? null : dirname(current);
  const isRoot = parent === null || roots.some(r => resolve(r).toLowerCase() === resolve(current).toLowerCase());

  const folders: { name: string; path: string }[] = [];
  let error: string | undefined;
  let truncated = false;

  try {
    const entries = await customReaddir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (isRoot && SYSTEM_DIRS.has(entry.name.toLowerCase())) continue;
      let isDir = false;
      try {
        if (entry.isDirectory()) {
          isDir = true;
        } else if (entry.isSymbolicLink()) {
          const s = await stat(join(current, entry.name));
          isDir = s.isDirectory();
        }
      } catch {
        continue;
      }
      if (isDir) {
        folders.push({ name: entry.name, path: join(current, entry.name) });
        if (folders.length >= 2000) {
          truncated = true;
          break;
        }
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (err: any) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      error = "permission denied";
    } else {
      error = "không đọc được thư mục";
    }
  }

  return { current, parent, home, roots, folders, ...(truncated ? { truncated: true } : {}), ...(error ? { error } : {}) };
}

