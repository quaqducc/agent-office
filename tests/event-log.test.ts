import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, readRun, compileTrail } from "../src/event-log.ts";
import type { TeamEvent } from "../src/types.ts";

const dir = () => mkdtempSync(join(tmpdir(), "evlog-"));

test("persists events except message_delta", () => {
  const d = dir();
  const log = new EventLog(d, "ws1");
  log.emit({ runId: "r1", type: "run_started", data: {} });
  log.emit({ runId: "r1", type: "message_delta", role: "manager", data: { delta: "hi" } });
  log.emit({ runId: "r1", type: "message", role: "manager", data: { text: "hi" } });
  const events = readRun(d, "r1");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.type), ["run_started", "message"]);
  assert.ok(events[1].seq > events[0].seq);
  assert.equal(events[0].workspaceId, "ws1");
});

test("subscribers receive deltas", () => {
  const log = new EventLog(dir(), "ws1");
  const seen: string[] = [];
  const off = log.subscribe(e => seen.push(e.type));
  log.emit({ runId: "r1", type: "message_delta", data: { delta: "x" } });
  off();
  log.emit({ runId: "r1", type: "message", data: { text: "x" } });
  assert.deepEqual(seen, ["message_delta"]);
});

test("redacts secrets", () => {
  const d = dir();
  const log = new EventLog(d, "ws1");
  const seen: TeamEvent[] = [];
  log.subscribe(e => seen.push(e));
  log.emit({ runId: "r1", type: "tool_call", data: {
    args: { command: "curl -H 'Authorization: Bearer sk-abc123def456' https://x" },
    apiKey: "plain-secret", nested: { password: "p", keep: "AIzaSyA1234567890abcdefghijk" },
  } });
  const raw = readFileSync(join(d, "r1.jsonl"), "utf8");
  for (const s of ["sk-abc123def456", "plain-secret", "AIzaSyA1234567890abcdefghijk", '"p"']) {
    assert.ok(!raw.includes(s), `leaked ${s} to disk`);
    assert.ok(!JSON.stringify(seen).includes(s), `leaked ${s} to subscribers`);
  }
  assert.equal((readRun(d, "r1")[0].data as any).apiKey, "***");
});

test("compileTrail collects handoffs, files, commands, errors, tokens since seq", () => {
  const ev = (seq: number, taskId: string, type: TeamEvent["type"], data: object): TeamEvent =>
    ({ ts: "", seq, workspaceId: "w", runId: "r", taskId, type, data } as TeamEvent);
  const events = [
    ev(1, "t1", "tool_call", { tool: "bash", args: { command: "old" } }),
    ev(5, "t1", "task_created", { from: "developer", to: "reviewer", goal: "review" }),
    ev(6, "t2", "tool_call", { tool: "write", args: { path: "a.ts" } }),
    ev(7, "t1", "tool_call", { tool: "bash", args: { command: "npm test" } }),
    ev(8, "t1", "usage", { tokens: 10 }),
    ev(9, "t2", "error", { message: "boom" }),
    ev(10, "other", "tool_call", { tool: "edit", args: { path: "x.ts" } }),
  ];
  const trail = compileTrail(events, new Set(["t1", "t2"]), 2);
  assert.deepEqual(trail.handoffs, [{ from: "developer", to: "reviewer", goal: "review", status: "queued" }]);
  assert.deepEqual(trail.files, ["a.ts"]);
  assert.deepEqual(trail.commands, ["npm test"]);
  assert.deepEqual(trail.errors, ["boom"]);
  assert.equal(trail.tokens, 10);
});
