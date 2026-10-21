// Real-model check that the Manager delegates small follow-up work instead of doing it (not part of `npm test`).
// Run: node tests/e2e/delegation.ts
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server.ts";
import type { TeamEvent } from "../../src/types.ts";

// Messages that the Manager used to handle itself by writing scripts (one run each, like real follow-ups).
const MESSAGES = [
  "Project này chưa có môi trường ảo. Setup giúp tôi venv Python và cài thư viện requests.",
  "Tôi chạy file setup.bat thì báo lỗi: \"python was unexpected at this time.\" Sửa giúp tôi.",
];

const srv = await startServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "deleg-data-")) });
const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(srv.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;

async function runOnce(wsId: string, text: string): Promise<TeamEvent[]> {
  const { runId } = await api("POST", `/workspaces/${wsId}/messages`, { text });
  const deadline = Date.now() + 15 * 60_000; // a developer may debug for several minutes
  for (;;) {
    const runs = await api("GET", `/workspaces/${wsId}/runs`);
    const r = runs.find((x: any) => x.runId === runId);
    if (r && r.status !== "active") break;
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise(res => setTimeout(res, 3000));
  }
  return api("GET", `/runs/${runId}/events`);
}

try {
  const folder = mkdtempSync(join(tmpdir(), "deleg-ws-"));
  // The classic cmd bug: parentheses inside an echo within an IF block → "... was unexpected at this time."
  writeFileSync(join(folder, "setup.bat"), [
    "@echo off", "if not exist .venv (", "  echo Tao moi truong (.venv)...", "  python -m venv .venv", ")", "echo Xong", "",
  ].join(String.fromCharCode(13, 10)));
  const ws = await api("POST", "/workspaces", { path: folder, name: "Delegation" });
  let failures = 0;
  for (const text of MESSAGES) {
    const log = await runOnce(ws.id, text);
    const handoffs = log.filter(e => e.type === "task_created" && e.data.from === "manager").map(e => e.data.to);
    const managerWrites = log.filter(e => e.type === "tool_call" && e.role === "manager" && ["write", "edit", "bash"].includes(String(e.data.tool)));
    const reply = log.filter(e => e.type === "manager_reply").at(-1)?.data.text as string | undefined;
    console.log(`\n> ${text}\n  handoffs: ${JSON.stringify(handoffs)}  manager writes: ${managerWrites.length}  tokens: ${(log.at(-1)?.data.usage as any)?.tokens}`);
    console.log(`  reply: ${(reply ?? "").slice(0, 300).replace(/\n/g, " ")}`);
    try {
      assert.equal(managerWrites.length, 0, "manager must not write files");
      assert.ok(handoffs.some(r => r === "devops" || r === "developer"), "work goes to devops/developer");
    } catch (e) { failures++; console.log(`  FAIL: ${(e as Error).message}`); }
  }
  console.log(failures ? `\nDELEGATION FAIL (${failures})` : "\nDELEGATION PASS");
  process.exitCode = failures ? 1 : 0;
} finally {
  await srv.close();
}
