import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { fakeFactory } from "./helpers/fake-runner.ts";
import type { Router } from "../src/router.ts";

test("a role installed from the store can receive work without restarting", async () => {
  const saved = process.env.AGENT_COMPANY_HOME;
  process.env.AGENT_COMPANY_HOME = mkdtempSync(join(tmpdir(), "store-api-home-"));
  const results: string[] = [];
  const srv = await startServer({
    port: 0, dataDir: mkdtempSync(join(tmpdir(), "store-api-data-")),
    createRunner: (_ws, router: () => Router) => fakeFactory(async (role, text) => {
      if (role === "manager" && text.startsWith("User:")) {
        results.push(await router().handoff("manager", { to: "planner", goal: "plan", inputs: "", expected_output: "" }));
      }
      return "ok";
    }),
  });
  const api = async (method: string, path: string, body?: unknown) =>
    (await fetch(srv.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;
  try {
    const ws = await api("POST", "/workspaces", { path: mkdtempSync(join(tmpdir(), "store-api-ws-")), name: "S" });
    await api("GET", `/workspaces/${ws.id}/config`); // creates the workspace context before the install
    const before = (await api("GET", "/store")).roles.find((r: any) => r.id === "planner");
    assert.equal(before.installed, false);
    assert.deepEqual(await api("POST", "/store/roles/planner/install", {}), { installed: "planner" });
    assert.ok((await api("GET", `/workspaces/${ws.id}/config`)).roles.includes("planner"));
    await api("POST", `/workspaces/${ws.id}/messages`, { text: "go" });
    for (let i = 0; i < 100 && !results.length; i++) await new Promise(r => setTimeout(r, 20));
    assert.match(results[0] ?? "", /queued for planner/, results[0]);
    const base = await (await fetch(`${srv.url}/store/roles/manager`, { method: "DELETE", headers: { "content-type": "application/json" } }));
    assert.equal(base.status, 409);
    // removing a role also drops its model choice, so settings stay savable
    const provider = { id: "p", name: "P", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-test-key-123456", search: "none" };
    await api("PUT", "/settings", { providers: [provider], defaultModel: { provider: "p", model: "m" }, roleModels: { planner: { provider: "p", model: "m2" } }, search: { mode: "auto" } });
    assert.deepEqual(await api("DELETE", "/store/roles/planner", {}), { removed: "planner" });
    assert.equal((await api("GET", "/settings")).roleModels.planner, undefined);
    assert.ok(!(await api("GET", `/workspaces/${ws.id}/config`)).roles.includes("planner"), "the team is rebuilt without the removed role");
  } finally {
    await srv.close();
    if (saved === undefined) delete process.env.AGENT_COMPANY_HOME; else process.env.AGENT_COMPANY_HOME = saved;
  }
});

test("a second server on a busy port fails with EADDRINUSE instead of crashing", async () => {
  const first = await startServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "port-a-")) });
  try {
    const port = Number(new URL(first.url).port);
    await assert.rejects(startServer({ port, dataDir: mkdtempSync(join(tmpdir(), "port-b-")) }), (e: any) => e.code === "EADDRINUSE");
  } finally { await first.close(); }
});
