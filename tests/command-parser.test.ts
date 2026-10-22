import test from "node:test";
import assert from "node:assert/strict";
import { extractCommands, type CommandEntry } from "../src/command-parser.ts";

test("extractCommands trích xuất các lệnh bash từ danh sách sự kiện", () => {
  const events = [
    {
      seq: 1,
      ts: "2026-10-24T10:00:00.000Z",
      type: "tool_call",
      role: "developer",
      runId: "run-1",
      data: {
        tool: "bash",
        toolCallId: "call-1",
        args: { command: "npm test" },
      },
    },
    {
      seq: 2,
      ts: "2026-10-24T10:00:02.500Z",
      type: "tool_result",
      role: "developer",
      runId: "run-1",
      data: {
        tool: "bash",
        toolCallId: "call-1",
        ok: true,
        preview: "✔ all tests pass",
        output: "✔ all tests pass (2500ms)",
      },
    },
  ];

  const commands = extractCommands(events);
  assert.equal(commands.length, 1);
  const cmd = commands[0];
  assert.equal(cmd.id, "call-1");
  assert.equal(cmd.runId, "run-1");
  assert.equal(cmd.role, "developer");
  assert.equal(cmd.command, "npm test");
  assert.equal(cmd.tool, "bash");
  assert.equal(cmd.ok, true);
  assert.equal(cmd.preview, "✔ all tests pass");
  assert.equal(cmd.output, "✔ all tests pass (2500ms)");
  assert.equal(cmd.durationMs, 2500);
});

test("extractCommands bỏ qua các công cụ không phải shell (như read, write, handoff)", () => {
  const events = [
    {
      seq: 1,
      ts: "2026-10-24T10:00:00.000Z",
      type: "tool_call",
      role: "developer",
      data: { tool: "write", toolCallId: "call-w", args: { path: "a.txt" } },
    },
    {
      seq: 2,
      ts: "2026-10-24T10:00:01.000Z",
      type: "tool_call",
      role: "tester",
      data: { tool: "powershell", toolCallId: "call-ps", args: { command: "dir" } },
    },
  ];

  const commands = extractCommands(events);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].id, "call-ps");
  assert.equal(commands[0].tool, "powershell");
  assert.equal(commands[0].command, "dir");
  assert.equal(commands[0].ok, undefined); // Chưa có result
});

test("extractCommands giới hạn output ở mức tối đa 50KB an toàn", () => {
  const bigOutput = "X".repeat(70000);
  const events = [
    {
      seq: 1,
      ts: "2026-10-24T10:00:00.000Z",
      type: "tool_call",
      role: "developer",
      data: { tool: "bash", toolCallId: "call-big", args: { command: "cat huge.log" } },
    },
    {
      seq: 2,
      ts: "2026-10-24T10:00:01.000Z",
      type: "tool_result",
      role: "developer",
      data: { tool: "bash", toolCallId: "call-big", ok: true, output: bigOutput },
    },
  ];

  const commands = extractCommands(events);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].output.length <= 51000);
  assert.ok(commands[0].output.includes("[truncated"));
});
