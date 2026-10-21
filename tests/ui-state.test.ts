import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- browser ES module without type declarations
import { initialState, reduce, mergeEvents } from "../ui/js/state.js";

let seq = 0;
const ev = (type: string, data: Record<string, unknown> = {}, role?: string, taskId?: string, runId = "r1") =>
  ({ ts: new Date(2026, 9, 20, 10, 0, seq).toISOString(), seq: ++seq, workspaceId: "w", runId, role, taskId, type, data });
const run = (events: any[], roles = ["manager", "brainstormer", "critic"]) => events.reduce(reduce, initialState(roles));

const scenario = () => [
  ev("run_started", { firstMessage: "idea" }),
  ev("user_message", { text: "idea" }, "user", "t0"),
  ev("task_created", { taskId: "t0", from: "user", to: "manager", goal: "idea", depth: 0 }, "user", "t0"),
  ev("task_status", { status: "running" }, "manager", "t0"),
  ev("task_created", { taskId: "t1", parentTaskId: "t0", from: "manager", to: "brainstormer", goal: "expand", depth: 1 }, "manager", "t0"),
  ev("task_status", { status: "done" }, "manager", "t0"),
  ev("task_status", { status: "running" }, "brainstormer", "t1"),
  ev("task_created", { taskId: "t2", parentTaskId: "t1", from: "brainstormer", to: "critic", goal: "critique", depth: 2 }, "brainstormer", "t1"),
  ev("task_status", { status: "running" }, "critic", "t2"),
];

test("task flow and role statuses", () => {
  let s = run(scenario());
  assert.equal(s.runStatus, "active");
  assert.deepEqual(Object.keys(s.tasks), ["t0", "t1", "t2"]);
  assert.equal(s.tasks.t2.parentTaskId, "t1");
  assert.equal(s.roles.manager.status, "idle");
  assert.equal(s.roles.brainstormer.status, "waiting");
  assert.equal(s.roles.brainstormer.waitingOn, "critic");
  assert.equal(s.roles.critic.status, "working");
  s = reduce(s, ev("message", { text: "weak point X" }, "critic", "t2"));
  s = reduce(s, ev("task_status", { status: "done" }, "critic", "t2"));
  assert.equal(s.tasks.t2.status, "done");
  assert.equal(s.tasks.t2.result, "weak point X");
  assert.equal(s.roles.critic.status, "idle");
  assert.equal(s.roles.brainstormer.status, "working");
  assert.equal(s.roles.brainstormer.waitingOn, undefined);
});

test("chat from user_message and manager_reply", () => {
  const s = run([...scenario(), ev("manager_reply", { text: "**done**" }, "manager", "t0")]);
  assert.deepEqual(s.chat.map((c: any) => [c.who, c.text]), [["user", "idea"], ["manager", "**done**"]]);
});

test("approval lifecycle", () => {
  let s = run([...scenario(), ev("approval_request", { checkpointId: "cp-1", title: "Buy", action: "Pay 10k", summary: "s" }, "critic", "t2")]);
  assert.equal(s.roles.critic.status, "approval");
  assert.deepEqual(s.approvals["cp-1"], { id: "cp-1", role: "critic", title: "Buy", action: "Pay 10k", summary: "s" });
  s = reduce(s, ev("checkpoint_reply", { checkpointId: "cp-1", decision: "approve", by: "user" }, "user"));
  assert.deepEqual(s.approvals, {});
  assert.equal(s.roles.critic.status, "working");
});

test("streaming deltas accumulate and are cleared by message", () => {
  let s = run(scenario());
  s = reduce(s, ev("message_delta", { delta: "Hel" }, "critic", "t2"));
  s = reduce(s, ev("message_delta", { delta: "lo" }, "critic", "t2"));
  assert.equal(s.streaming.critic, "Hello");
  s = reduce(s, ev("message", { text: "Hello" }, "critic", "t2"));
  assert.equal(s.streaming.critic, undefined);
  assert.equal(s.roles.critic.lastMessage, "Hello");
  assert.ok(!s.log.some((e: any) => e.type === "message_delta"), "deltas are not logged");
});

test("run_finished resets roles and approvals, keeps chat and log", () => {
  let s = run([...scenario(), ev("approval_request", { checkpointId: "cp-1", title: "t", action: "a", summary: "s" }, "critic", "t2")]);
  s = reduce(s, ev("usage", { tokens: 40 }, "critic", "t2"));
  s = reduce(s, ev("run_finished", { status: "stopped", usage: { tokens: 50 } }));
  assert.equal(s.runStatus, "stopped");
  assert.equal(s.tokens, 50);
  assert.ok(Object.values(s.roles).every((r: any) => r.status === "idle"));
  assert.deepEqual(s.approvals, {});
  assert.equal(s.chat.length, 1);
  assert.equal(s.log.at(-1).type, "run_finished");
});

test("a new run resets tasks, log and effects but keeps chat", () => {
  let s = run([...scenario(), ev("run_finished", { status: "done", usage: { tokens: 1 } })]);
  s = reduce(s, ev("run_started", { firstMessage: "next" }, undefined, undefined, "r2"));
  assert.equal(s.runId, "r2");
  assert.deepEqual(s.tasks, {});
  assert.equal(s.log.length, 1);
  assert.equal(s.effects.length, 0);
  assert.equal(s.chat.length, 1);
});

test("effects queued for handoff, checkpoint, approval and reply", () => {
  const s = run([
    ...scenario(),
    ev("checkpoint", { checkpointId: "cp-2", title: "Draft ready", to: "manager" }, "brainstormer", "t1"),
    ev("approval_request", { checkpointId: "cp-3", title: "Buy", action: "a", summary: "s" }, "critic", "t2"),
    ev("manager_reply", { text: "Here is the summary" }, "manager", "t0"),
  ]);
  assert.deepEqual(s.effects.map((e: any) => [e.kind, e.from, e.to, e.label]), [
    ["handoff", "user", "manager", "idea"],
    ["handoff", "manager", "brainstormer", "expand"],
    ["handoff", "brainstormer", "critic", "critique"],
    ["checkpoint", "brainstormer", "manager", "Draft ready"],
    ["approval", "critic", "user", "Buy"],
    ["reply", "manager", "user", "Here is the summary"],
  ]);
  assert.ok(s.effects.every((e: any) => typeof e.seq === "number"));
});

test("merge dedupes by run and seq and keeps order", () => {
  const a = [ev("run_started"), ev("user_message", { text: "x" })];
  const b = [a[1], ev("task_created", { taskId: "t", from: "user", to: "manager", goal: "x" })];
  const merged = mergeEvents(a, b);
  assert.deepEqual(merged.map((e: any) => e.type), ["run_started", "user_message", "task_created"]);
  assert.deepEqual(mergeEvents([b[1]], a).map((e: any) => e.seq), [a[0].seq, a[1].seq, b[1].seq]);
});

test("tasks remember creation order even with numeric-looking ids", () => {
  const s = run([
    ev("run_started"),
    ev("task_created", { taskId: "ab12cd34", from: "user", to: "manager", goal: "a" }, "user", "ab12cd34"),
    ev("task_created", { taskId: "12345678", parentTaskId: "ab12cd34", from: "manager", to: "critic", goal: "b" }, "manager", "ab12cd34"),
  ]);
  const ordered = Object.values(s.tasks).sort((a: any, b: any) => a.order - b.order).map((t: any) => t.id);
  assert.deepEqual(ordered, ["ab12cd34", "12345678"]);
});

test("a finished task clears that role's streaming text", () => {
  let s = run(scenario());
  s = reduce(s, ev("message_delta", { delta: "half a thought" }, "critic", "t2"));
  s = reduce(s, ev("task_status", { status: "failed", reason: "aborted" }, "critic", "t2"));
  assert.equal(s.streaming.critic, undefined);
});

test("manager shows working while handling notices, idle after replying", () => {
  let s = run([...scenario(), ev("task_status", { status: "done" }, "critic", "t2"), ev("task_status", { status: "done" }, "brainstormer", "t1")]);
  assert.equal(s.roles.manager.status, "idle");
  s = reduce(s, ev("message_delta", { delta: "Tổng hợp…" }, "manager"));
  assert.equal(s.roles.manager.status, "working");
  s = reduce(s, ev("manager_reply", { text: "Xong" }, "manager"));
  assert.equal(s.roles.manager.status, "idle");
  s = reduce(s, ev("tool_call", { tool: "read", args: {} }, "manager"));
  assert.equal(s.roles.manager.status, "working");
});
