import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- browser ES modules without type declarations
import { initialState, reduce } from "../ui/js/state.js";
// @ts-ignore
import { activeLinks, activityFeed, duration, logGroup, overview } from "../ui/js/derive.js";

let seq = 0;
const ev = (type: string, data: Record<string, unknown> = {}, role?: string, taskId?: string) =>
  ({ ts: new Date(Date.UTC(2026, 9, 20, 10, 0, seq)).toISOString(), seq: ++seq, workspaceId: "w", runId: "r1", role, taskId, type, data });
const run = (events: any[]) => events.reduce(reduce, initialState(["manager", "planner", "critic"]));
const names = { manager: "Manager", planner: "Planner", critic: "Critic" };

const scenario = () => {
  seq = 0;
  return [
    ev("run_started", { firstMessage: "plan" }),
    ev("user_message", { text: "plan it" }, "user", "t0"),
    ev("task_created", { taskId: "t0", from: "user", to: "manager", goal: "plan it" }, "user", "t0"),
    ev("task_status", { status: "running" }, "manager", "t0"),
    ev("task_created", { taskId: "t1", parentTaskId: "t0", from: "manager", to: "planner", goal: "make a plan" }, "manager", "t0"),
    ev("task_status", { status: "running" }, "planner", "t1"),
    ev("task_created", { taskId: "t2", parentTaskId: "t1", from: "planner", to: "critic", goal: "review" }, "planner", "t1"),
    ev("task_status", { status: "running" }, "critic", "t2"),
  ];
};

test("reducer records run and task timestamps", () => {
  let s = run(scenario());
  assert.equal(s.startedAt, scenario()[0].ts);
  assert.equal(s.tasks.t2.startedAt, scenario()[7].ts);
  s = reduce(s, ev("task_status", { status: "done" }, "critic", "t2"));
  assert.ok(s.tasks.t2.endedAt);
  s = reduce(s, ev("run_finished", { status: "done" }));
  assert.equal(s.endedAt, s.log.at(-1).ts);
});

test("overview counts tasks, waits and elapsed time", () => {
  const s = run(scenario());
  const o = overview(s, Date.parse(s.startedAt) + 65_000);
  assert.equal(o.elapsedMs, 65_000);
  assert.equal(o.running, 3);
  assert.equal(o.queued, 0);
  assert.deepEqual(o.waits, [{ role: "planner", on: "critic" }]);
  assert.deepEqual(o.working.sort(), ["critic", "manager"]);
  assert.equal(o.approvals, 0);
});

test("overview of a finished run uses its end time", () => {
  const s = run([...scenario(), ev("run_finished", { status: "done" })]);
  const o = overview(s, Date.parse(s.startedAt) + 999_999);
  assert.equal(o.elapsedMs, 8_000);
});

test("active links follow open tasks and approvals", () => {
  let s = run(scenario());
  assert.deepEqual(activeLinks(s).map((l: any) => [l.from, l.to, l.kind]),
    [["user", "manager", "task"], ["manager", "planner", "task"], ["planner", "critic", "task"]]);
  s = reduce(s, ev("approval_request", { checkpointId: "cp", title: "Buy", action: "Pay", summary: "" }, "critic", "t2"));
  assert.deepEqual(activeLinks(s).at(-1), { id: "cp", from: "critic", to: "user", kind: "approval" });
});

test("activity feed lists interactions newest first in Vietnamese", () => {
  let s = run(scenario());
  s = reduce(s, ev("message", { text: "Looks fine" }, "critic", "t2"));
  s = reduce(s, ev("task_status", { status: "done" }, "critic", "t2"));
  const feed = activityFeed(s, names);
  assert.deepEqual(feed.map((f: any) => [f.from, f.to, f.kind]), [
    ["critic", "planner", "done"],
    ["planner", "critic", "handoff"],
    ["manager", "planner", "handoff"],
    ["user", "manager", "user"],
  ]);
  assert.equal(feed[0].text, "Looks fine");
  assert.match(feed[1].verb, /giao việc/);
});

test("duration formats short and long spans", () => {
  assert.equal(duration(0), "0:00");
  assert.equal(duration(65_000), "1:05");
  assert.equal(duration(3_725_000), "1:02:05");
});

test("log groups cover the event types", () => {
  assert.equal(logGroup("task_created"), "task");
  assert.equal(logGroup("tool_result"), "tool");
  assert.equal(logGroup("approval_request"), "approval");
  assert.equal(logGroup("error"), "error");
  assert.equal(logGroup("manager_reply"), "message");
  assert.equal(logGroup("usage"), "system");
});

// @ts-ignore
import { plain } from "../ui/js/util.js";
test("plain strips Markdown markers for one-line previews", () => {
  assert.equal(plain("### **Báo cáo** của `critic`\n- điểm 1\n> trích | cột"), "Báo cáo của critic điểm 1 trích cột");
  assert.equal(plain("@shop_bot giá 25.000đ"), "@shop_bot giá 25.000đ");
});
