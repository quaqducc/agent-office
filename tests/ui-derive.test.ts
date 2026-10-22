import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- browser ES modules without type declarations
import { initialState, reduce } from "../ui/js/state.js";
// @ts-ignore
import { activeLinks, activityFeed, duration, logGroup, overview, extractQuestions, filterQuestionData, extractCommands, isTestCommand, parseTestOutput } from "../ui/js/derive.js";

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

test("extractQuestions extracts single question per finished run from run summary", () => {
  const runs = [
    { runId: "r2", startedAt: "2026-10-23T10:00:00Z", endedAt: "2026-10-23T10:05:00Z", status: "done", firstMessage: "Thêm trang giới thiệu sản phẩm" },
    { runId: "r1", startedAt: "2026-10-23T09:00:00Z", endedAt: "2026-10-23T09:10:00Z", status: "stopped", firstMessage: "Sửa lỗi crash khi load dữ liệu" },
  ];
  const questions = extractQuestions({ runs });
  assert.equal(questions.length, 2);
  assert.equal(questions[0].runId, "r2");
  assert.equal(questions[0].status, "done");
  assert.equal(questions[0].text, "Thêm trang giới thiệu sản phẩm");
  assert.equal(questions[0].isCurrent, true);
  assert.equal(questions[1].runId, "r1");
  assert.equal(questions[1].status, "stopped");
  assert.equal(questions[1].isCurrent, false);
});

test("extractQuestions extracts mid-run follow-up messages from liveLog as distinct questions", () => {
  const liveLog = [
    { runId: "r1", seq: 1, ts: "2026-10-23T08:00:00Z", type: "user_message", data: { text: "Viết hàm helper tính thuế" } },
    { runId: "r1", seq: 2, ts: "2026-10-23T08:00:05Z", type: "task_created", data: { taskId: "t1" } },
    { runId: "r1", seq: 3, ts: "2026-10-23T08:01:00Z", type: "manager_reply", data: { text: "Đã tạo hàm helper" } },
    { runId: "r1", seq: 4, ts: "2026-10-23T08:02:00Z", type: "user_message", data: { text: "Thêm cả test case kiểm tra biên" } },
    { runId: "r1", seq: 5, ts: "2026-10-23T08:02:05Z", type: "task_created", data: { taskId: "t2" } },
  ];
  const runs = [
    { runId: "r1", startedAt: "2026-10-23T08:00:00Z", status: "active", firstMessage: "Viết hàm helper tính thuế" },
  ];
  const questions = extractQuestions({ runs, liveLog, activeRunId: "r1" });
  assert.equal(questions.length, 2);
  // Newest first
  assert.equal(questions[0].text, "Thêm cả test case kiểm tra biên");
  assert.equal(questions[0].status, "running");
  assert.equal(questions[0].isCurrent, true);

  assert.equal(questions[1].text, "Viết hàm helper tính thuế");
  assert.equal(questions[1].status, "done");
  assert.equal(questions[1].isCurrent, false);
});

test("extractQuestions marks active run question as running and finished run questions as done/stopped", () => {
  const runs = [
    { runId: "r2", startedAt: "2026-10-23T11:00:00Z", status: "active", firstMessage: "Tạo schema DB" },
    { runId: "r1", startedAt: "2026-10-23T10:00:00Z", endedAt: "2026-10-23T10:05:00Z", status: "cancelled", firstMessage: "Kiểm tra kết nối" },
  ];
  const questions = extractQuestions({ runs, activeRunId: "r2" });
  assert.equal(questions[0].status, "running");
  assert.equal(questions[1].status, "stopped");
});

test("filterQuestionData slices events and tasks between consecutive user_messages in the same run", () => {
  const events = [
    { runId: "r1", seq: 1, ts: "2026-10-23T08:00:00Z", type: "user_message", data: { text: "Câu hỏi 1" } },
    { runId: "r1", seq: 2, ts: "2026-10-23T08:00:05Z", type: "task_created", data: { taskId: "t1" }, taskId: "t1" },
    { runId: "r1", seq: 3, ts: "2026-10-23T08:00:10Z", type: "task_status", data: { status: "done" }, taskId: "t1" },
    { runId: "r1", seq: 4, ts: "2026-10-23T08:02:00Z", type: "user_message", data: { text: "Câu hỏi 2" } },
    { runId: "r1", seq: 5, ts: "2026-10-23T08:02:05Z", type: "task_created", data: { taskId: "t2" }, taskId: "t2" },
    { runId: "r1", seq: 6, ts: "2026-10-23T08:02:10Z", type: "task_status", data: { status: "running" }, taskId: "t2" },
  ];
  const tasks = {
    t1: { id: "t1", status: "done" },
    t2: { id: "t2", status: "running" },
  };
  const questions = [
    { id: "r1:seq-4", runId: "r1", seq: 4, text: "Câu hỏi 2", shortText: "Câu hỏi 2", ts: "2026-10-23T08:02:00Z", status: "running", isCurrent: true },
    { id: "r1:seq-1", runId: "r1", seq: 1, text: "Câu hỏi 1", shortText: "Câu hỏi 1", ts: "2026-10-23T08:00:00Z", status: "done", isCurrent: false },
  ];

  const sliceQ1 = filterQuestionData({ questionId: "r1:seq-1", questions, events, tasks });
  assert.equal(sliceQ1.log.length, 3);
  assert.deepEqual(sliceQ1.log.map((e: any) => e.seq), [1, 2, 3]);
  assert.deepEqual(Object.keys(sliceQ1.tasks), ["t1"]);

  const sliceQ2 = filterQuestionData({ questionId: "r1:seq-4", questions, events, tasks });
  assert.equal(sliceQ2.log.length, 3);
  assert.deepEqual(sliceQ2.log.map((e: any) => e.seq), [4, 5, 6]);
  assert.deepEqual(Object.keys(sliceQ2.tasks), ["t2"]);
});

test("filterQuestionData returns all tasks and events when run has only one question", () => {
  const events = [
    { runId: "r1", seq: 1, type: "user_message", data: { text: "Một câu duy nhất" } },
    { runId: "r1", seq: 2, type: "task_created", data: { taskId: "t1" }, taskId: "t1" },
  ];
  const tasks = { t1: { id: "t1", status: "done" } };
  const questions = [
    { id: "r1:seq-1", runId: "r1", seq: 1, text: "Một câu duy nhất", shortText: "Một câu duy nhất", ts: "2026-10-23T08:00:00Z", status: "done", isCurrent: true },
  ];

  const slice = filterQuestionData({ questionId: "r1:seq-1", questions, events, tasks });
  assert.equal(slice.log.length, 2);
  assert.deepEqual(Object.keys(slice.tasks), ["t1"]);
});

test("ui/js/derive extractCommands, isTestCommand, and parseTestOutput", () => {
  const events = [
    { type: "tool_call", seq: 1, runId: "r1", role: "developer", ts: "2026-10-24T10:00:00.000Z", data: { tool: "bash", toolCallId: "c1", args: { command: "npm test" } } },
    { type: "tool_result", seq: 2, runId: "r1", role: "developer", ts: "2026-10-24T10:00:01.500Z", data: { tool: "bash", toolCallId: "c1", ok: true, preview: "ℹ tests 1\nℹ pass 1" } },
  ];

  const cmds = extractCommands(events);
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].command, "npm test");
  assert.equal(cmds[0].ok, true);
  assert.equal(cmds[0].durationMs, 1500);

  assert.equal(isTestCommand("npm test"), true);
  assert.equal(isTestCommand("ls -la"), false);

  const testSummary = parseTestOutput(cmds[0].command, cmds[0].preview);
  assert.equal(testSummary.isTestCommand, true);
  assert.equal(testSummary.passed, true);
  assert.equal(testSummary.stats.total, 1);
  assert.equal(testSummary.stats.passed, 1);
});
