import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_LIMITS } from "./config.ts";
import { roleIds } from "./library.ts";
import type { Limits } from "./types.ts";

export interface Workspace { id: string; name: string; path: string }

export interface RunIndexEntry {
  runId: string;
  startedAt: string;
  endedAt?: string;
  status: string;
  firstMessage: string;
  tokens: number;
}

export interface WorkspaceConfig { roles: string[]; limits: Limits }

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";

export const companyDir = (ws: Workspace) => join(ws.path, ".company");
export const runsDir = (ws: Workspace) => join(companyDir(ws), "runs");

export class WorkspaceStore {
  readonly dataDir: string;
  private file: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "workspaces.json");
  }

  list(): Workspace[] {
    return existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : [];
  }

  get(id: string): Workspace | undefined {
    return this.list().find(w => w.id === id);
  }

  /** Register a folder; a folder that is already registered keeps its id and takes the new name, if one is given. */
  add(path: string, name?: string): Workspace {
    // pasted paths often carry quotes ("Copy as path") or stray spaces
    const cleaned = path.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    const abs = resolve(cleaned);
    if (!cleaned || !existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`${cleaned || "(empty)"} is not a folder`);
    const all = this.list();
    const found = all.find(w => w.path.toLowerCase() === abs.toLowerCase());
    if (found) {
      const label = name?.trim();
      if (!label || label === found.name) return found;
      const renamed = { ...found, name: label };
      writeFileSync(this.file, JSON.stringify(all.map(w => (w.id === found.id ? renamed : w)), null, 2));
      return renamed;
    }
    const label = name?.trim() || abs.split(/[\\/]/).filter(Boolean).pop() || "workspace";
    const ws: Workspace = { id: `${slug(label)}-${createHash("sha1").update(abs.toLowerCase()).digest("hex").slice(0, 6)}`, name: label, path: abs };
    for (const d of ["runs", "sessions"]) mkdirSync(join(companyDir(ws), d), { recursive: true });
    writeFileSync(this.file, JSON.stringify([...all, ws], null, 2));
    return ws;
  }

  config(ws: Workspace): WorkspaceConfig {
    const f = join(companyDir(ws), "config.json");
    const raw = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
    const all = roleIds();
    const chosen: string[] = Array.isArray(raw.roles) ? raw.roles.filter((r: string) => all.includes(r)) : all;
    const roles = chosen.includes("manager") ? chosen : ["manager", ...chosen];
    return { roles, limits: { ...DEFAULT_LIMITS, ...(raw.limits ?? {}) } };
  }

  /** Append or replace (by runId) a run summary. */
  appendRun(ws: Workspace, entry: RunIndexEntry) {
    const others = this.runs(ws).filter(r => r.runId !== entry.runId);
    writeFileSync(join(runsDir(ws), "index.json"), JSON.stringify([...others, entry], null, 2));
  }

  runs(ws: Workspace): RunIndexEntry[] {
    const f = join(runsDir(ws), "index.json");
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  }
}
