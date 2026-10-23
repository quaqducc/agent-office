import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_LIMITS } from "./config.ts";
import { roleIds } from "./library.ts";
import type { Limits } from "./types.ts";
import { assertSafeWindowsPath } from "./fs-browse.ts";

export function validateWorkspaceName(name: string): string {
  const label = name?.trim();
  if (!label) throw new Error("name is required");
  if (label.length > 80) throw new Error("name must be 80 characters or less");
  if (/[\x00-\x1f\x7f]/.test(label)) throw new Error("name contains invalid control characters");
  return label;
}

export interface Workspace { id: string; name: string; path: string }

export interface RunIndexEntry {
  runId: string;
  startedAt: string;
  endedAt?: string;
  status: string;
  firstMessage: string;
  tokens: number;
}

export interface RoomDef {
  id: string;
  name: string;
  roles: string[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: string;
  hmac?: string;
  untrusted?: boolean;
}

export interface WorkspaceConfig {
  roles: string[];
  limits: Limits;
  template?: string;
  rooms?: RoomDef[];
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";

export const companyDir = (ws: Workspace) => join(ws.path, ".company");
export const runsDir = (ws: Workspace) => join(companyDir(ws), "runs");
export const queueFile = (ws: Workspace) => join(companyDir(ws), "queue.json");

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

  rename(id: string, name: string): Workspace {
    const label = validateWorkspaceName(name);
    const all = this.list();
    const found = all.find(w => w.id === id);
    if (!found) throw new Error(`unknown workspace ${id}`);
    if (label === found.name) return found;
    const renamed = { ...found, name: label };
    writeFileSync(this.file, JSON.stringify(all.map(w => (w.id === found.id ? renamed : w)), null, 2));
    return renamed;
  }

  /** Register a folder; a folder that is already registered keeps its id and takes the new name, if one is given. */
  add(path: string, name?: string): Workspace {
    // pasted paths often carry quotes ("Copy as path") or stray spaces
    const cleaned = path.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    assertSafeWindowsPath(cleaned);
    const abs = resolve(cleaned);
    assertSafeWindowsPath(abs);
    if (!cleaned || !existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`${cleaned || "(empty)"} is not a folder`);
    const all = this.list();
    const found = all.find(w => w.path.toLowerCase() === abs.toLowerCase());
    if (found) {
      return name !== undefined && name !== null ? this.rename(found.id, name) : found;
    }
    const label = name !== undefined && name !== null ? validateWorkspaceName(name) : (abs.split(/[\\/]/).filter(Boolean).pop() || "workspace");
    const ws: Workspace = { id: `${slug(label)}-${createHash("sha1").update(abs.toLowerCase()).digest("hex").slice(0, 6)}`, name: label, path: abs };
    for (const d of ["runs", "sessions"]) mkdirSync(join(companyDir(ws), d), { recursive: true });
    writeFileSync(this.file, JSON.stringify([...all, ws], null, 2));
    return ws;
  }

  config(ws: Workspace): WorkspaceConfig {
    const f = join(companyDir(ws), "config.json");
    let raw: any = {};
    if (existsSync(f)) {
      try {
        raw = JSON.parse(readFileSync(f, "utf8"));
      } catch (err) {
        console.warn(`[config] warning: corrupted config.json in ${ws.path}, falling back to defaults`, err);
        raw = {};
      }
    }
    const all = roleIds();
    const chosen: string[] = Array.isArray(raw.roles) ? raw.roles.filter((r: string) => all.includes(r)) : all;
    const roles = chosen.includes("manager") ? chosen : ["manager", ...chosen];
    const template = typeof raw.template === "string" ? raw.template : undefined;

    let rooms: RoomDef[] | undefined;
    if (Array.isArray(raw.rooms) && raw.rooms.length > 0) {
      const validRooms: RoomDef[] = [];
      const assigned = new Set<string>();

      for (const rm of raw.rooms) {
        if (!rm || typeof rm.id !== "string" || typeof rm.name !== "string") continue;
        const id = String(rm.id).trim();
        const name = String(rm.name).trim();
        if (!id || !name) continue;

        const roomRoles: string[] = [];
        if (Array.isArray(rm.roles)) {
          for (const r of rm.roles) {
            if (roles.includes(r) && !assigned.has(r)) {
              roomRoles.push(r);
              assigned.add(r);
            }
          }
        }
        validRooms.push({ id, name, roles: roomRoles });
      }

      if (validRooms.length > 0) {
        for (const r of roles) {
          if (!assigned.has(r)) {
            validRooms[0].roles.push(r);
            assigned.add(r);
          }
        }
        rooms = validRooms;
      }
    }

    return { roles, limits: { ...DEFAULT_LIMITS, ...(raw.limits ?? {}) }, ...(template ? { template } : {}), ...(rooms ? { rooms } : {}) };
  }

  saveConfig(ws: Workspace, patch: { roles: string[]; rooms?: RoomDef[] | null; template?: string | null }): WorkspaceConfig {
    if (!Array.isArray(patch.roles)) throw new Error("roles must be an array");
    const cleanRoles = [...new Set(patch.roles)];

    if (patch.rooms !== undefined && patch.rooms !== null) {
      if (!Array.isArray(patch.rooms)) throw new Error("rooms must be an array");
      if (patch.rooms.length > 6) throw new Error("maximum 6 rooms allowed");
      const roomIds = new Set<string>();
      for (const rm of patch.rooms) {
        if (!rm || typeof rm !== "object") throw new Error("invalid room definition");
        const id = String(rm.id ?? "").trim();
        if (!/^[a-z0-9-]{1,40}$/.test(id)) {
          throw new Error(`invalid room id: "${id}" (must match ^[a-z0-9-]{1,40}$)`);
        }
        if (roomIds.has(id)) {
          throw new Error(`duplicate room id: "${id}"`);
        }
        roomIds.add(id);

        const name = String(rm.name ?? "").trim();
        if (!name || name.length > 40) {
          throw new Error("room name must be 1 to 40 characters");
        }
        if (rm.roles !== undefined && !Array.isArray(rm.roles)) {
          throw new Error("room roles must be an array");
        }
      }
    }

    const dir = companyDir(ws);
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
      throw new Error(".company directory cannot be a symbolic link");
    }
    mkdirSync(dir, { recursive: true });

    const f = join(dir, "config.json");
    if (existsSync(f) && lstatSync(f).isSymbolicLink()) {
      throw new Error("config.json cannot be a symbolic link");
    }

    let raw: any = {};
    if (existsSync(f)) {
      try {
        raw = JSON.parse(readFileSync(f, "utf8"));
      } catch {
        raw = {};
      }
    }

    const updated: any = {
      ...raw,
      roles: cleanRoles,
    };
    if (patch.rooms !== undefined) {
      if (!patch.rooms || patch.rooms.length === 0) delete updated.rooms;
      else {
        updated.rooms = patch.rooms.map(rm => ({
          id: String(rm.id).trim(),
          name: String(rm.name).trim(),
          roles: Array.isArray(rm.roles) ? [...new Set(rm.roles.filter(r => cleanRoles.includes(r)))] : [],
        }));
      }
    }
    if (patch.template !== undefined) {
      if (!patch.template) delete updated.template;
      else updated.template = patch.template;
    }
    writeFileSync(f, JSON.stringify(updated, null, 2));
    return this.config(ws);
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

  private getQueueSecret(): string {
    const p = join(this.dataDir, "queue-secret");
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf8").trim();
      } catch {}
    }
    const sec = randomBytes(32).toString("hex");
    try {
      writeFileSync(p, sec, { encoding: "utf8", mode: 0o600 });
    } catch {}
    return sec;
  }

  computeQueueHmac(item: { id: string; text: string; createdAt: string }): string {
    const sec = this.getQueueSecret();
    return createHmac("sha256", sec).update(`${item.id}:${item.text}:${item.createdAt}`).digest("hex");
  }

  getQueue(ws: Workspace): QueuedMessage[] {
    const f = queueFile(ws);
    if (!existsSync(f)) return [];
    try {
      const parsed = JSON.parse(readFileSync(f, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.map((q: any) => {
        if (!q || typeof q !== "object") return q;
        const expected = this.computeQueueHmac({ id: q.id, text: q.text, createdAt: q.createdAt });
        if (!q.hmac || q.hmac !== expected) {
          return { ...q, untrusted: true };
        }
        return q;
      });
    } catch {
      return [];
    }
  }

  enqueue(ws: Workspace, text: string): { item: QueuedMessage; position: number } {
    if (typeof text !== "string" || text.length > 20000) {
      throw new Error("Message text too large (max 20000 characters)");
    }
    const current = this.getQueue(ws);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const hmac = this.computeQueueHmac({ id, text, createdAt });
    const item: QueuedMessage = {
      id,
      text,
      createdAt,
      hmac,
    };
    const updated = [...current, item];
    writeFileSync(queueFile(ws), JSON.stringify(updated, null, 2));
    return { item, position: updated.length };
  }

  dequeue(ws: Workspace): QueuedMessage | undefined {
    const current = this.getQueue(ws);
    if (!current.length) return undefined;
    const item = current[0];
    if (item.untrusted) {
      return undefined; // Do not auto-run untrusted items
    }
    const updated = current.slice(1);
    writeFileSync(queueFile(ws), JSON.stringify(updated, null, 2));
    return item;
  }

  removeQueueItem(ws: Workspace, qid: string): boolean {
    const current = this.getQueue(ws);
    const filtered = current.filter(q => q.id !== qid);
    if (filtered.length === current.length) return false;
    writeFileSync(queueFile(ws), JSON.stringify(filtered, null, 2));
    return true;
  }
}
