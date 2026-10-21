import { existsSync, readdirSync, statSync } from "node:fs";
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

export function getDrives(): { roots: string[]; home: string } {
  const home = homedir();
  if (process.platform === "win32") {
    const roots: string[] = [];
    for (let i = 65; i <= 90; i++) {
      const drive = String.fromCharCode(i) + ":\\";
      try {
        if (existsSync(drive)) roots.push(drive);
      } catch {}
    }
    return { roots: roots.length ? roots : ["C:\\"], home };
  }
  return { roots: ["/"], home };
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  home: string;
  roots: string[];
  folders: { name: string; path: string }[];
  error?: string;
}

export function browseDirectory(targetPath?: string, readdir: typeof readdirSync = readdirSync): BrowseResult {
  const { roots, home } = getDrives();
  const raw = targetPath?.trim();
  const current = raw ? resolve(raw) : (home && existsSync(home) ? home : roots[0]);

  if (!existsSync(current)) throw new Error("folder not found");
  if (!statSync(current).isDirectory()) throw new Error("not a folder");

  const parent = resolve(current) === resolve(dirname(current)) ? null : dirname(current);

  const folders: { name: string; path: string }[] = [];
  let error: string | undefined;

  try {
    const entries = readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SYSTEM_DIRS.has(entry.name.toLowerCase())) continue;
      let isDir = false;
      try {
        if (entry.isDirectory()) {
          isDir = true;
        } else if (entry.isSymbolicLink()) {
          isDir = statSync(join(current, entry.name)).isDirectory();
        }
      } catch {
        continue;
      }
      if (isDir) {
        folders.push({ name: entry.name, path: join(current, entry.name) });
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (err: any) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      error = "permission denied";
    } else {
      throw err;
    }
  }

  return { current, parent, home, roots, folders, ...(error ? { error } : {}) };
}
