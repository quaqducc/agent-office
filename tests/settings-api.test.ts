import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { homePaths } from "../src/home.ts";
import { startFakeProvider } from "./helpers/fake-provider.ts";
import type { TeamEvent } from "../src/types.ts";

async function withApp(fn: (api: (m: string, p: string, b?: unknown) => Promise<{ status: number; json: any }>, url: string) => Promise<void>) {
  const saved = process.env.AGENT_COMPANY_HOME;
  process.env.AGENT_COMPANY_HOME = mkdtempSync(join(tmpdir(), "settings-home-"));
  const srv = await startServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "settings-data-")) });
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(srv.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() as any };
  };
  try { await fn(api, srv.url); } finally {
    await srv.close();
    if (saved === undefined) delete process.env.AGENT_COMPANY_HOME; else process.env.AGENT_COMPANY_HOME = saved;
  }
}

const provider = (url: string, apiKey = "sk-good-key-123456") =>
  ({ id: "fake", name: "Fake", api: "openai-completions", baseUrl: `${url}/v1`, apiKey, search: "none" });

test("health reports version and whether a model is configured", () => withApp(async api => {
  const h = (await api("GET", "/health")).json;
  assert.match(h.version, /^\d+\.\d+\.\d+/);
  assert.equal(h.configured, false);
}));

test("settings API masks keys and keeps them on update", () => withApp(async api => {
  const fp = await startFakeProvider();
  try {
    const cfg = { providers: [provider(fp.url)], defaultModel: { provider: "fake", model: "model-a" }, roleModels: {}, search: { mode: "auto" } };
    assert.equal((await api("PUT", "/settings", cfg)).status, 200);
    const pub = (await api("GET", "/settings")).json;
    assert.equal(pub.providers[0].apiKey, "sk-…3456");
    assert.equal((await api("PUT", "/settings", { ...pub, roleModels: { critic: { provider: "fake", model: "model-b" } } })).status, 200);
    const stored = JSON.parse(readFileSync(homePaths().config, "utf8"));
    assert.equal(stored.providers[0].apiKey, "sk-good-key-123456");
    assert.equal(stored.roleModels.critic.model, "model-b");
    assert.ok(existsSync(homePaths().piModels), "pi models.json generated");
    assert.equal((await api("GET", "/health")).json.configured, true);
  } finally { await fp.close(); }
}));

test("PUT rejects invalid config", () => withApp(async api => {
  const r = await api("PUT", "/settings", { providers: [{ ...provider("ftp://x"), baseUrl: "ftp://x" }], roleModels: {}, search: { mode: "auto" } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /http/);
}));

test("provider test and model list endpoints (masked key resolves to the stored one)", () => withApp(async api => {
  const fp = await startFakeProvider();
  try {
    await api("PUT", "/settings", { providers: [provider(fp.url)], roleModels: {}, search: { mode: "auto" } });
    const masked = { ...provider(fp.url), apiKey: "sk-…3456" };
    assert.deepEqual((await api("POST", "/settings/providers/models", { provider: masked })).json.models, ["model-a", "model-b"]);
    const t = (await api("POST", "/settings/providers/test", { provider: masked, model: "model-a" })).json;
    assert.equal(t.ok, true);
    const bad = (await api("POST", "/settings/providers/test", { provider: { ...provider(fp.url), apiKey: "sk-wrong-00000000" }, model: "model-a" })).json;
    assert.equal(bad.ok, false);
  } finally { await fp.close(); }
}));

test("run without provider fails clearly", () => withApp(async (api, url) => {
  const ws = (await api("POST", "/workspaces", { path: mkdtempSync(join(tmpdir(), "np-ws-")), name: "NP" })).json;
  const { runId } = (await api("POST", `/workspaces/${ws.id}/messages`, { text: "hello" })).json;
  for (let i = 0; i < 100; i++) {
    const runs = (await api("GET", `/workspaces/${ws.id}/runs`)).json;
    if (runs.find((r: any) => r.runId === runId)?.status !== "active") break;
    await new Promise(r => setTimeout(r, 50));
  }
  const events: TeamEvent[] = (await api("GET", `/runs/${runId}/events`)).json;
  assert.ok(events.some(e => e.type === "error" && /Chưa cấu hình model/.test(String(e.data.message))), JSON.stringify(events.map(e => e.type)));
  assert.equal(events.at(-1)!.type, "run_finished");
  void url;
}));
