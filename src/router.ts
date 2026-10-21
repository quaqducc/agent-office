import { randomUUID } from "node:crypto";
import { compileTrail, type EventLog } from "./event-log.ts";
import type { CheckpointArgs, HandoffArgs, Limits, Task, TaskStatus, TeamEventType, Trail } from "./types.ts";

export interface RoleRunner {
  /** Runs one prompt to completion; resolves with the final assistant text. */
  run(text: string): Promise<string>;
  abort(): Promise<void>;
  dispose(): void;
}

export interface RunnerHooks {
  /** Emit an event attributed to the work currently running on this role. `usage` needs `data.tokens`. */
  emit(type: TeamEventType, data: Record<string, unknown>): void;
}

export type RunnerFactory = (role: string, hooks: RunnerHooks) => Promise<RoleRunner>;

export interface RouterOptions {
  workspaceId: string;
  roles: string[];
  limits: Limits;
  log: EventLog;
  createRunner: RunnerFactory;
  onRunFinished?: (runId: string, status: string, usage: { tokens: number }) => void;
  now?: () => number;
}

interface WorkItem {
  runId: string;
  /** Task this item executes; undefined for notices (task results, checkpoints, follow-up user messages). */
  taskId?: string;
  text: string;
  /** Blocking handoff: resolves the caller's tool call with the outcome. */
  resolve?: (outcome: { status: TaskStatus; text: string }) => void;
  /** Active model time accounting (timeout counts only this). */
  activeSince?: number;
  timer?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
  overBudget?: boolean;
}

export interface PendingApproval {
  id: string;
  runId: string;
  role: string;
  title: string;
  summary: string;
  action: string;
  createdAt: string;
}

interface RoleState {
  queue: WorkItem[];
  busy: boolean;
  current?: WorkItem;
  runner?: Promise<RoleRunner>;
  holdsSlot: boolean;
  /** Roles this role is blocked on (one entry per in-flight blocking handoff). */
  waitingOn: string[];
  /** In-flight blocking waits (parallel tool calls in one turn can block several times at once). */
  waits: number;
}

interface Run {
  id: string;
  status: "active" | "done" | "stopped" | "budget_exceeded";
  rootTaskId: string;
  tokens: number;
  pairRounds: Map<string, number>;
  firstMessage: string;
}

const MANAGER = "manager";

export class Router {
  private o: RouterOptions;
  private states = new Map<string, RoleState>();
  private taskMap = new Map<string, Task>();
  private runs = new Map<string, Run>();
  private active?: string;
  private slotsInUse = 0;
  private slotWaiters: (() => void)[] = [];
  private idleWaiters: (() => void)[] = [];
  private decisions = new Map<string, { runId: string; role: string; title: string; reminded: boolean; resolve: (answer: string) => void }>();
  private approvals = new Map<string, PendingApproval & { resolve: (answer: string) => void }>();
  private lastCheckpointSeq = new Map<string, number>();

  constructor(o: RouterOptions) {
    this.o = o;
    for (const r of o.roles) this.states.set(r, { queue: [], busy: false, holdsSlot: false, waitingOn: [], waits: 0 });
  }

  activeRunId(): string | undefined { return this.active; }

  tasks(runId: string): Task[] { return [...this.taskMap.values()].filter(t => t.runId === runId); }

  whenIdle(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise(r => this.idleWaiters.push(r));
  }

  // ---------- user entry ----------

  sendUserMessage(text: string): { runId: string } {
    if (this.active) {
      const runId = this.active;
      this.emit(runId, "user_message", { text }, undefined, "user");
      this.enqueue(MANAGER, { runId, text: `User: ${text}` });
      return { runId };
    }
    const runId = randomUUID();
    const root = this.newTask(runId, { from: "user", to: MANAGER, goal: text, inputs: "", expectedOutput: "", depth: 0 });
    this.runs.set(runId, { id: runId, status: "active", rootTaskId: root.id, tokens: 0, pairRounds: new Map(), firstMessage: text });
    this.active = runId;
    this.emit(runId, "run_started", { firstMessage: text });
    this.emit(runId, "user_message", { text }, root.id, "user");
    this.emitTaskCreated(root, undefined);
    this.enqueue(MANAGER, { runId, taskId: root.id, text: `User: ${text}` });
    return { runId };
  }

  // ---------- handoff tool ----------

  async handoff(caller: string, a: HandoffArgs): Promise<string> {
    const cur = this.states.get(caller)?.current;
    if (!cur) return "ERROR: handoff called outside of an active task.";
    const run = this.runs.get(cur.runId)!;
    const refuse = (msg: string, limit?: string) => {
      this.emit(run.id, limit ? "limit_hit" : "error", limit ? { limit, message: msg } : { message: msg }, cur.taskId, caller);
      if (limit && caller !== MANAGER) this.autoCheckpoint(cur, caller, `Limit hit: ${limit}`, msg);
      return `ERROR: ${msg}`;
    };
    if (!this.states.has(a.to)) return refuse(`unknown role "${a.to}". Available: ${[...this.states.keys()].join(", ")}`);
    if (a.to === caller) return refuse("you cannot hand off to yourself.");
    if (a.to === MANAGER) return refuse("you cannot hand off to the manager; use the checkpoint tool to report to the manager.");
    // Work the manager does while handling a notice (task result, checkpoint) belongs to the run's root task.
    const parentId = cur.taskId ?? (caller === MANAGER ? run.rootTaskId : undefined);
    const parent = parentId ? this.taskMap.get(parentId) : undefined;
    const depth = (parent?.depth ?? 0) + 1;
    if (depth > this.o.limits.maxDepth) return refuse(`max handoff depth ${this.o.limits.maxDepth} reached; finish this yourself or report via checkpoint.`, "maxDepth");
    const pair = [caller, a.to].sort().join("<>");
    const rounds = (run.pairRounds.get(pair) ?? 0) + 1;
    if (rounds > this.o.limits.maxPairRounds) return refuse(`max rounds (${this.o.limits.maxPairRounds}) between ${caller} and ${a.to} reached in this run; decide or report via checkpoint.`, "maxPairRounds");
    if (caller !== MANAGER && this.waitsOn(a.to, caller)) return refuse(`${a.to} is waiting on you; return your result instead of handing work back.`);
    run.pairRounds.set(pair, rounds);

    const task = this.newTask(run.id, {
      from: caller, to: a.to, goal: a.goal, inputs: a.inputs ?? "", expectedOutput: a.expected_output ?? "",
      depth, parentTaskId: parentId, checkpoints: a.checkpoints ?? [],
    });
    this.emitTaskCreated(task, cur.taskId);
    const text = this.taskPrompt(task);

    if (caller === MANAGER) {
      this.enqueue(a.to, { runId: run.id, taskId: task.id, text });
      return `Task ${task.id} queued for ${a.to}. Its result will arrive as a later message.`;
    }
    const st = this.states.get(caller)!;
    st.waitingOn.push(a.to);
    const outcome = await this.waitReleasing(caller, new Promise<{ status: TaskStatus; text: string }>(resolve =>
      this.enqueue(a.to, { runId: run.id, taskId: task.id, text, resolve })));
    st.waitingOn.splice(st.waitingOn.indexOf(a.to), 1);
    if (outcome.status !== "done") return `ERROR: task ${task.id} for ${a.to} ${outcome.status}: ${outcome.text}`;
    return `Result from ${a.to} (task ${task.id}):\n${outcome.text}`;
  }

  // ---------- checkpoint tools ----------

  async checkpoint(role: string, a: CheckpointArgs): Promise<string> {
    const cur = this.states.get(role)?.current;
    if (!cur) return "ERROR: checkpoint called outside of an active task.";
    if (a.approval_required && !a.action?.trim()) return "ERROR: approval_required needs an exact action (amount, recipient, target, content).";
    const id = `cp-${randomUUID().slice(0, 8)}`;
    const trail = this.trailFor(cur, role);
    const fields = { checkpointId: id, title: a.title, summary: a.summary, decisions: a.decisions, open_issues: a.open_issues, trail };

    if (a.approval_required) {
      const pending: PendingApproval = { id, runId: cur.runId, role, title: a.title, summary: a.summary, action: a.action!, createdAt: new Date().toISOString() };
      this.emit(cur.runId, "approval_request", { ...fields, action: a.action }, cur.taskId, role);
      if (role !== MANAGER) this.enqueue(MANAGER, { runId: cur.runId, text:
        `APPROVAL PENDING ${id} from ${role}: ${a.title}\nAction: ${a.action}\n${a.summary}\n` +
        `This is waiting for the user. You cannot approve it; do not call reply_checkpoint for it.` });
      return this.waitReleasing(role, new Promise<string>(resolve => this.approvals.set(id, { ...pending, resolve })));
    }

    this.emit(cur.runId, "checkpoint", { ...fields, needs_decision: !!a.needs_decision, to: role === MANAGER ? "user" : MANAGER }, cur.taskId, role);
    if (role === MANAGER) return `Checkpoint ${id} shown to the user.`;
    const body = `CHECKPOINT ${id} from ${role}: ${a.title}\n${a.summary}` +
      (a.decisions ? `\nDecisions: ${a.decisions}` : "") + (a.open_issues ? `\nOpen issues: ${a.open_issues}` : "") +
      `\nTrail: ${formatTrail(trail)}`;
    if (!a.needs_decision) {
      this.enqueue(MANAGER, { runId: cur.runId, text: body });
      return `Checkpoint ${id} delivered to manager.`;
    }
    return this.waitReleasing(role, new Promise<string>(resolve => {
      this.decisions.set(id, { runId: cur.runId, role, title: a.title, reminded: false, resolve });
      this.enqueue(MANAGER, { runId: cur.runId, text: `${body}\nDecision needed: answer with reply_checkpoint (checkpoint_id=${id}).` });
    }));
  }

  /** Manager answers a decision checkpoint. Approvals are not answerable here. */
  replyCheckpoint(id: string, answer: string): string {
    if (this.approvals.has(id)) return `ERROR: ${id} is a real-world action approval; only the user can approve it.`;
    const d = this.decisions.get(id);
    if (!d) return `ERROR: no pending decision checkpoint ${id}.`;
    this.decisions.delete(id);
    this.emit(d.runId, "checkpoint_reply", { checkpointId: id, answer, by: MANAGER }, undefined, MANAGER);
    d.resolve(`Manager decision: ${answer}`);
    return "Reply delivered.";
  }

  /** User answers an approval request (API only). */
  replyApproval(id: string, decision: "approve" | "reject" | "edit", note = ""): boolean {
    const a = this.approvals.get(id);
    if (!a) return false;
    this.approvals.delete(id);
    this.emit(a.runId, "checkpoint_reply", { checkpointId: id, decision, answer: note, by: "user" }, undefined, "user");
    a.resolve(`User decision: ${decision}.${note ? ` ${note}` : ""}`);
    return true;
  }

  pendingApprovals(): PendingApproval[] {
    return [...this.approvals.values()].map(({ resolve: _r, ...p }) => p);
  }

  // ---------- stop ----------

  async stopRun(runId: string, status: "stopped" | "budget_exceeded" = "stopped"): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "active") return;
    run.status = status;
    for (const [id, d] of this.decisions) if (d.runId === runId) { this.decisions.delete(id); d.resolve("ERROR: run stopped"); }
    for (const [id, a] of this.approvals) if (a.runId === runId) { this.approvals.delete(id); a.resolve("User decision: reject. run stopped"); }
    for (const [, st] of this.states) {
      for (const item of st.queue.filter(i => i.runId === runId)) item.resolve?.({ status: "cancelled", text: "run stopped" });
      st.queue = st.queue.filter(i => i.runId !== runId);
    }
    for (const t of this.tasks(runId)) if (t.status === "queued" || t.status === "running") this.setStatus(t, "cancelled", "run stopped");
    const aborts: Promise<void>[] = [];
    for (const [, st] of this.states) if (st.current?.runId === runId && st.runner) aborts.push(st.runner.then(r => r.abort()));
    await Promise.allSettled(aborts);
    this.finishRun(run);
  }

  // ---------- internals ----------

  private subtree(taskId: string): Set<string> {
    const ids = new Set([taskId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of this.taskMap.values()) if (t.parentTaskId && ids.has(t.parentTaskId) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
    }
    return ids;
  }

  private trailFor(item: WorkItem, role: string): Trail {
    const key = item.taskId ?? `${item.runId}:${role}`;
    const ids = item.taskId ? this.subtree(item.taskId) : new Set<string>();
    const events = this.o.log.eventsOf(item.runId);
    const trail = compileTrail(events, ids, this.lastCheckpointSeq.get(key) ?? 0);
    this.lastCheckpointSeq.set(key, events.at(-1)?.seq ?? 0);
    return trail;
  }

  /** Router-raised checkpoint (no model involved). */
  private autoCheckpoint(item: WorkItem, role: string, title: string, summary: string) {
    const id = `cp-${randomUUID().slice(0, 8)}`;
    const trail = this.trailFor(item, role);
    this.emit(item.runId, "checkpoint", { checkpointId: id, title, summary, trail, automatic: true, to: MANAGER }, item.taskId, role);
    this.enqueue(MANAGER, { runId: item.runId, text: `CHECKPOINT ${id} (automatic) about ${role}: ${title}\n${summary}\nTrail: ${formatTrail(trail)}` });
  }

  private startActive(role: string) {
    const item = this.states.get(role)!.current;
    const task = item?.taskId ? this.taskMap.get(item.taskId) : undefined;
    if (!item || !task) return;
    item.activeSince = this.now();
    const remaining = Math.max(0, this.o.limits.taskTimeoutMs - task.activeMs);
    item.timer = setTimeout(() => {
      item.timedOut = true;
      this.emit(item.runId, "limit_hit", { limit: "taskTimeoutMs", message: `task ${task.id} exceeded ${this.o.limits.taskTimeoutMs} ms of active time` }, task.id, role);
      this.states.get(role)!.runner?.then(r => r.abort());
    }, remaining);
    item.timer.unref?.(); // never keep the process alive just for a timeout
  }

  private stopActive(role: string) {
    const item = this.states.get(role)!.current;
    const task = item?.taskId ? this.taskMap.get(item.taskId) : undefined;
    if (!item || item.activeSince === undefined) return;
    clearTimeout(item.timer);
    if (task) task.activeMs += this.now() - item.activeSince;
    item.activeSince = undefined;
  }

  private now(): number { return this.o.now?.() ?? Date.now(); }

  /** True if `from` is (transitively) blocked waiting on `target`. */
  private waitsOn(from: string, target: string, seen = new Set<string>()): boolean {
    if (seen.has(from)) return false;
    seen.add(from);
    for (const w of this.states.get(from)?.waitingOn ?? []) if (w === target || this.waitsOn(w, target, seen)) return true;
    return false;
  }

  private taskPrompt(t: Task): string {
    const lines = [`Task ${t.id} from ${t.from}.`, `Goal: ${t.goal}`, `Inputs: ${t.inputs || "-"}`, `Expected output: ${t.expectedOutput || "-"}`];
    if (t.checkpoints.length) lines.push(`Checkpoints to report to the Manager (use the checkpoint tool):\n${t.checkpoints.map(c => `- ${c}`).join("\n")}`);
    return lines.join("\n");
  }

  private newTask(runId: string, p: { from: string; to: string; goal: string; inputs: string; expectedOutput: string; depth: number; parentTaskId?: string; checkpoints?: string[] }): Task {
    const t: Task = {
      id: randomUUID().slice(0, 8), runId, parentTaskId: p.parentTaskId, from: p.from, to: p.to, goal: p.goal,
      inputs: p.inputs, expectedOutput: p.expectedOutput, checkpoints: p.checkpoints ?? [], status: "queued",
      depth: p.depth, createdAt: new Date().toISOString(), activeMs: 0, tokens: 0,
    };
    this.taskMap.set(t.id, t);
    return t;
  }

  private emitTaskCreated(t: Task, byTaskId: string | undefined) {
    this.emit(t.runId, "task_created", {
      taskId: t.id, parentTaskId: t.parentTaskId, from: t.from, to: t.to, goal: t.goal, inputs: t.inputs,
      expectedOutput: t.expectedOutput, checkpoints: t.checkpoints, depth: t.depth,
    }, byTaskId ?? t.id, t.from);
  }

  private setStatus(t: Task, status: TaskStatus, reason?: string) {
    t.status = status;
    if (status !== "queued" && status !== "running") t.endedAt = new Date().toISOString();
    this.emit(t.runId, "task_status", { status, reason }, t.id, t.to);
  }

  private emit(runId: string, type: TeamEventType, data: Record<string, unknown>, taskId?: string, role?: string) {
    this.o.log.emit({ runId, type, data, taskId, role });
  }

  private enqueue(role: string, item: WorkItem) {
    this.states.get(role)!.queue.push(item);
    queueMicrotask(() => this.pump(role));
  }

  private acquireSlot(): Promise<void> {
    if (this.slotsInUse < this.o.limits.maxConcurrent) { this.slotsInUse++; return Promise.resolve(); }
    return new Promise(r => this.slotWaiters.push(() => { this.slotsInUse++; r(); }));
  }

  private releaseSlot() {
    this.slotsInUse--;
    this.slotWaiters.shift()?.();
  }

  /** Wait for `p` without holding a concurrency slot (blocked callers don't occupy the model). */
  private async waitReleasing<T>(role: string, p: Promise<T>): Promise<T> {
    const st = this.states.get(role)!;
    if (st.waits++ === 0) {
      this.stopActive(role);
      if (st.holdsSlot) { st.holdsSlot = false; this.releaseSlot(); }
    }
    try {
      return await p;
    } finally {
      if (--st.waits === 0) { await this.acquireSlot(); st.holdsSlot = true; this.startActive(role); }
    }
  }

  private runnerFor(role: string): Promise<RoleRunner> {
    const st = this.states.get(role)!;
    st.runner ??= this.o.createRunner(role, {
      emit: (type, data) => {
        const cur = st.current;
        if (!cur) return;
        this.emit(cur.runId, type, data, cur.taskId, role);
        if (type === "usage") this.addTokens(cur, Number(data.tokens) || 0);
      },
    });
    return st.runner;
  }

  private addTokens(item: WorkItem, n: number) {
    const run = this.runs.get(item.runId);
    if (run) {
      run.tokens += n;
      if (run.status === "active" && run.tokens >= this.o.limits.runTokenBudget) {
        this.emit(run.id, "limit_hit", { limit: "runTokenBudget", message: `run used ${run.tokens} tokens (budget ${this.o.limits.runTokenBudget})` });
        void this.stopRun(run.id, "budget_exceeded");
      }
    }
    const t = item.taskId ? this.taskMap.get(item.taskId) : undefined;
    if (t) {
      t.tokens += n;
      if (t.status === "running" && t.tokens > this.o.limits.maxTaskTokens && !item.overBudget) {
        item.overBudget = true;
        this.emit(item.runId, "limit_hit", { limit: "maxTaskTokens", message: `task ${t.id} used ${t.tokens} tokens (cap ${this.o.limits.maxTaskTokens})` }, t.id, t.to);
        this.states.get(t.to)?.runner?.then(r => r.abort());
      }
    }
  }

  private async pump(role: string): Promise<void> {
    const st = this.states.get(role)!;
    if (st.busy || !st.queue.length) return;
    const item = st.queue.shift()!;
    const run = this.runs.get(item.runId);
    if (!run || run.status !== "active") { item.resolve?.({ status: "cancelled", text: "run not active" }); return this.pump(role); }
    st.busy = true;
    st.current = item;
    const task = item.taskId ? this.taskMap.get(item.taskId) : undefined;
    let status: TaskStatus = "done";
    let text = "";
    try {
      await this.acquireSlot();
      st.holdsSlot = true;
      if (run.status !== "active") throw new Error("run stopped");
      if (task) this.setStatus(task, "running");
      this.startActive(role);
      const runner = await this.runnerFor(role);
      text = await runner.run(item.text);
    } catch (e) {
      status = "failed";
      text = item.timedOut ? `timeout: exceeded ${this.o.limits.taskTimeoutMs} ms of active model time`
        : item.overBudget ? `token cap: task used more than ${this.o.limits.maxTaskTokens} tokens`
        : e instanceof Error ? e.message : String(e);
    } finally {
      this.stopActive(role);
      if (st.holdsSlot) { st.holdsSlot = false; this.releaseSlot(); }
      st.busy = false;
      st.current = undefined;
    }
    if (run.status === "active") this.complete(role, item, task, status, text);
    else item.resolve?.({ status: "cancelled", text: "run stopped" });
    if (role === MANAGER && run.status === "active") this.nudgeManager(run);
    this.pump(role);
    this.maybeFinish(run);
  }

  private complete(role: string, item: WorkItem, task: Task | undefined, status: TaskStatus, text: string) {
    if (status === "failed") this.emit(item.runId, "error", { message: text }, item.taskId, role);
    if (role === MANAGER && status === "done") this.emit(item.runId, "manager_reply", { text }, item.taskId, MANAGER);
    if (task) {
      task.result = text;
      this.setStatus(task, status, status === "failed" ? text : undefined);
    }
    if (status === "failed" && task && task.from !== MANAGER && role !== MANAGER) this.autoCheckpoint(item, role, `Task ${task.id} failed`, text);
    if (item.resolve) item.resolve({ status, text });
    else if (task && task.from === MANAGER) {
      this.enqueue(MANAGER, { runId: item.runId, text: `Task ${task.id} from ${role} finished (${status}):\n${text}` });
    }
  }

  /** Decision checkpoints the Manager left unanswered: remind once, then release the waiting roles. */
  private nudgeManager(run: Run) {
    if (this.states.get(MANAGER)!.queue.some(i => i.runId === run.id)) return;
    const pending = [...this.decisions].filter(([, d]) => d.runId === run.id);
    if (!pending.length) return;
    const fresh = pending.filter(([, d]) => !d.reminded);
    if (fresh.length) {
      for (const [, d] of fresh) d.reminded = true;
      this.enqueue(MANAGER, { runId: run.id, text: "REMINDER: these decision checkpoints are still waiting for you. " +
        "Answer each with the reply_checkpoint tool (plain text does not reach the role):\n" +
        fresh.map(([id, d]) => `- ${id} from ${d.role}: ${d.title}`).join("\n") });
      return;
    }
    for (const [id, d] of pending) {
      this.decisions.delete(id);
      this.emit(run.id, "checkpoint_reply", { checkpointId: id, answer: "no answer from manager", by: "router" }, undefined, d.role);
      d.resolve("ERROR: manager did not answer this decision; decide yourself or report via checkpoint.");
    }
  }

  private maybeFinish(run: Run | undefined) {
    if (!run || run.status !== "active") return;
    for (const [, st] of this.states) if (st.current?.runId === run.id || st.queue.some(i => i.runId === run.id)) return;
    if (this.tasks(run.id).some(t => t.status === "queued" || t.status === "running")) return;
    run.status = "done";
    this.finishRun(run);
  }

  private finishRun(run: Run) {
    this.emit(run.id, "run_finished", { status: run.status, usage: { tokens: run.tokens } });
    if (this.active === run.id) this.active = undefined;
    this.o.onRunFinished?.(run.id, run.status, { tokens: run.tokens });
    for (const w of this.idleWaiters.splice(0)) w();
  }
}

function formatTrail(tr: Trail): string {
  const parts = [
    tr.handoffs.length ? `handoffs: ${tr.handoffs.map(h => `${h.from}->${h.to} (${h.goal})`).join("; ")}` : "",
    tr.files.length ? `files: ${tr.files.join(", ")}` : "",
    tr.commands.length ? `commands: ${tr.commands.join(" | ")}` : "",
    tr.errors.length ? `errors: ${tr.errors.join(" | ")}` : "",
    `tokens: ${tr.tokens}`,
  ];
  return parts.filter(Boolean).join("; ");
}
