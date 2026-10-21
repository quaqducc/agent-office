import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TeamEvent, TeamEventType, Trail } from "./types.ts";

export interface EmitInput {
  runId: string;
  type: TeamEventType;
  taskId?: string;
  role?: string;
  data: object;
}

const SECRET_PATTERNS = [/sk-[A-Za-z0-9_-]{8,}/g, /AIza[0-9A-Za-z_-]{20,}/g, /(Bearer\s+)[^\s'"]+/gi];
const SECRET_KEYS = /^(api[_-]?key|authorization|token|password|secret)$/i;

export function redact<T>(v: T): T {
  if (typeof v === "string") {
    let s: string = v;
    for (const p of SECRET_PATTERNS) s = s.replace(p, (_m, bearer) => (typeof bearer === "string" ? `${bearer}***` : "***"));
    return s as T;
  }
  if (Array.isArray(v)) return v.map(redact) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "***" : redact(x)])) as T;
  }
  return v;
}

export class EventLog {
  private seq = 0;
  private subs = new Set<(e: TeamEvent) => void>();
  private byRun = new Map<string, TeamEvent[]>();
  private runsDir: string;
  private workspaceId: string;

  constructor(runsDir: string, workspaceId: string) {
    this.runsDir = runsDir;
    this.workspaceId = workspaceId;
    mkdirSync(runsDir, { recursive: true });
  }

  emit(e: EmitInput): TeamEvent {
    const ev: TeamEvent = {
      ts: new Date().toISOString(), seq: ++this.seq, workspaceId: this.workspaceId,
      runId: e.runId, taskId: e.taskId, role: e.role, type: e.type,
      data: redact(e.data as Record<string, unknown>),
    };
    if (ev.type !== "message_delta") {
      appendFileSync(join(this.runsDir, `${ev.runId}.jsonl`), JSON.stringify(ev) + "\n");
      const list = this.byRun.get(ev.runId) ?? [];
      list.push(ev);
      this.byRun.set(ev.runId, list);
    }
    for (const fn of this.subs) fn(ev);
    return ev;
  }

  subscribe(fn: (e: TeamEvent) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  eventsOf(runId: string): TeamEvent[] {
    return this.byRun.get(runId) ?? [];
  }
}

export function readRun(runsDir: string, runId: string): TeamEvent[] {
  const f = join(runsDir, `${runId}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
}

export function compileTrail(events: TeamEvent[], taskIds: Set<string>, sinceSeq: number): Trail {
  const trail: Trail = { handoffs: [], files: [], commands: [], errors: [], tokens: 0 };
  for (const e of events) {
    if (e.seq <= sinceSeq || !e.taskId || !taskIds.has(e.taskId)) continue;
    const d = e.data as Record<string, any>;
    if (e.type === "task_created") trail.handoffs.push({ from: d.from, to: d.to, goal: d.goal, status: "queued" });
    else if (e.type === "tool_call" && (d.tool === "write" || d.tool === "edit") && d.args?.path) {
      if (!trail.files.includes(d.args.path)) trail.files.push(d.args.path);
    } else if (e.type === "tool_call" && d.tool === "bash" && d.args?.command) trail.commands.push(d.args.command);
    else if (e.type === "error") trail.errors.push(String(d.message));
    else if (e.type === "usage") trail.tokens += Number(d.tokens) || 0;
  }
  return trail;
}
