// End-to-end smoke test against the real model (not part of `npm test`).
// Run: company env (see company.cmd), then `node tests/e2e/smoke.ts`
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server.ts";
import type { TeamEvent } from "../../src/types.ts";

const MESSAGE = "Có ý tưởng: app nhắc uống nước cho dân văn phòng. Hãy nhờ Brainstormer mở rộng ý tưởng, " +
  "Brainstormer nhờ Critic phản biện, rồi tóm tắt cho tôi. Yêu cầu Brainstormer báo checkpoint cho bạn khi đã có danh sách ý tưởng.";

const srv = await startServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "e2e-data-")) });
const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(srv.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;

try {
  const ws = await api("POST", "/workspaces", { path: mkdtempSync(join(tmpdir(), "e2e-ws-")), name: "E2E" });
  const res = await fetch(`${srv.url}/events?workspace=${ws.id}`);
  const reader = res.body!.getReader();
  const { runId } = await api("POST", `/workspaces/${ws.id}/messages`, { text: MESSAGE });
  console.log(`run ${runId} started`);

  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 10 * 60_000;
  let finished: TeamEvent | undefined;
  while (!finished) {
    if (Date.now() > deadline) throw new Error("timeout waiting for run_finished");
    const { value, done } = await reader.read();
    if (done) throw new Error("event stream closed");
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find(l => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const e = JSON.parse(line.slice(6)) as TeamEvent;
      if (e.type !== "message_delta" && e.type !== "usage") console.log(`${e.type.padEnd(16)} ${(e.role ?? "").padEnd(13)} ${JSON.stringify(e.data).slice(0, 160)}`);
      if (e.type === "run_finished" && e.runId === runId) finished = e;
    }
  }
  await reader.cancel();

  const log: TeamEvent[] = await api("GET", `/runs/${runId}/events`);
  const created = log.filter(e => e.type === "task_created").map(e => e.data);
  assert.ok(created.some(d => d.from === "manager" && d.to === "brainstormer"), "manager → brainstormer");
  assert.ok(created.some(d => d.from === "brainstormer" && d.to === "critic"), "brainstormer → critic");
  for (const role of ["manager", "brainstormer", "critic"]) assert.ok(log.some(e => e.type === "message" && e.role === role), `message from ${role}`);
  assert.ok(log.some(e => e.type === "manager_reply"), "manager_reply");
  assert.equal(log.filter(e => e.type === "error").length, 0, "no errors");
  assert.equal(finished.data.status, "done");
  console.log(`\nSMOKE PASS — ${log.length} events, ${(finished.data.usage as any)?.tokens} tokens, checkpoints: ${log.filter(e => e.type === "checkpoint").length}`);
  console.log(`final reply:\n${log.filter(e => e.type === "manager_reply").at(-1)?.data.text}`);
} finally {
  await srv.close();
}
