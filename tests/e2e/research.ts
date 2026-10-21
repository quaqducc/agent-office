// Real-model check of research + verification (not part of `npm test`). Run: node tests/e2e/research.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server.ts";
import { searchPageQuery } from "../../src/web.ts";
import type { TeamEvent } from "../../src/types.ts";

const QUESTION = "Bạn biết Open Knowledge Format không";

const srv = await startServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "research-data-")) });
const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(srv.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;

try {
  const ws = await api("POST", "/workspaces", { path: mkdtempSync(join(tmpdir(), "research-ws-")), name: "Research" });
  const { runId } = await api("POST", `/workspaces/${ws.id}/messages`, { text: QUESTION });
  const deadline = Date.now() + 8 * 60_000;
  for (;;) {
    const r = (await api("GET", `/workspaces/${ws.id}/runs`)).find((x: any) => x.runId === runId);
    if (r && r.status !== "active") break;
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise(res => setTimeout(res, 3000));
  }
  const log: TeamEvent[] = await api("GET", `/runs/${runId}/events`);
  const handoffs = log.filter(e => e.type === "task_created" && e.data.from !== "user").map(e => `${e.data.from}->${e.data.to}`);
  const research = log.filter(e => e.type === "tool_call" && ["internet_search", "web_fetch"].includes(String(e.data.tool)))
    .map(e => `${e.role}:${e.data.tool} ${JSON.stringify(e.data.args).slice(0, 90)}`);
  const reply = String(log.filter(e => e.type === "manager_reply").at(-1)?.data.text ?? "");
  console.log("handoffs:", handoffs);
  console.log("research calls:\n  " + research.join("\n  "));
  console.log("tokens:", (log.at(-1)?.data.usage as any)?.tokens);
  console.log("\nreply:\n" + reply);
  assert.ok(handoffs.includes("manager->researcher"), "question of fact goes to the researcher");
  // web_fetch of a search-engine page runs the configured web search (see tools.ts)
  const searched = log.some(e => e.type === "tool_call" && (e.data.tool === "internet_search"
    || (e.data.tool === "web_fetch" && searchPageQuery(String((e.data.args as any)?.url ?? "")) !== undefined)));
  assert.ok(searched, "the team searched the web");
  assert.match(reply, /Google/i, "identifies Google Cloud's OKF");
  assert.match(reply, /https?:\/\//, "cites at least one source URL");
  console.log("\nRESEARCH PASS");
} catch (e) {
  console.log(`\nRESEARCH FAIL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await srv.close();
}
