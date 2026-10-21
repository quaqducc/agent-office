import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapPiEvent, buildRoleSession } from "../src/pi-runner.ts";
import { makeTools } from "../src/tools.ts";
import { makeRouter } from "./helpers/fake-runner.ts";
import { loadConfig, saveConfig } from "../src/settings.ts";
import { homePaths } from "../src/home.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Sessions resolve their model from the app settings: give this test file its own home and config.
process.env.AGENT_COMPANY_HOME = mkdtempSync(join(tmpdir(), "pi-runner-home-"));
saveConfig({
  providers: [{ id: "fake", name: "Fake", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-fake-key-000000", search: "none" }],
  defaultModel: { provider: "fake", model: "m-default" },
  roleModels: { critic: { provider: "fake", model: "m-critic" } },
  search: { mode: "auto" },
});

test("maps text delta, message, usage, tool events", () => {
  assert.deepEqual(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hel" } }),
    [{ type: "message_delta", data: { delta: "Hel" } }]);
  assert.deepEqual(mapPiEvent({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "pong" }], usage: { input: 1441, output: 12, totalTokens: 1453 } },
  }), [
    { type: "message", data: { text: "pong" } },
    { type: "usage", data: { tokens: 1453, input: 1441, output: 12 } },
  ]);
  assert.deepEqual(mapPiEvent({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "hi" }] } }), []);
  assert.deepEqual(mapPiEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls -la" } }),
    [{ type: "tool_call", data: { tool: "bash", toolCallId: "c1", args: { command: "ls -la" } } }]);
  assert.deepEqual(mapPiEvent({
    type: "tool_execution_end", toolCallId: "c1", toolName: "bash", isError: false,
    result: { content: [{ type: "text", text: "complete output" }], details: {} },
  }), [{ type: "tool_result", data: { tool: "bash", toolCallId: "c1", ok: true, preview: "complete output" } }]);
});

test("skips orchestration tools in tool_call", () => {
  for (const name of ["handoff", "checkpoint", "reply_checkpoint"]) {
    assert.deepEqual(mapPiEvent({ type: "tool_execution_start", toolCallId: "c", toolName: name, args: {} }), []);
    assert.deepEqual(mapPiEvent({ type: "tool_execution_end", toolCallId: "c", toolName: name, isError: false, result: { content: [] } }), []);
  }
});

test("makeTools gives reply_checkpoint only to the manager", () => {
  const { router } = makeRouter(async () => "");
  assert.deepEqual(makeTools("manager", () => router).map(t => t.name), ["handoff", "checkpoint", "internet_search", "web_fetch", "reply_checkpoint"]);
  assert.deepEqual(makeTools("critic", () => router).map(t => t.name), ["handoff", "checkpoint", "internet_search", "web_fetch"]);
});

test("role session gets only its skills and tools", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ws-"));
  const { router } = makeRouter(async () => "");
  const session = await buildRoleSession({ role: "critic", workspacePath: ws, router: () => router });
  try {
    assert.deepEqual(session.getActiveToolNames().sort(), ["checkpoint", "find", "grep", "handoff", "internet_search", "ls", "read", "web_fetch"]);
    const skills = session.resourceLoader.getSkills().skills.map(s => s.name).sort();
    assert.deepEqual(skills, ["council", "doubt-driven-development", "identify-assumptions-new", "pre-mortem", "prioritize-assumptions", "strategy-red-team"]);
    assert.ok(session.systemPrompt.includes("# Critic"));
    assert.ok(session.systemPrompt.includes("`handoff` tool"));
  } finally {
    session.dispose();
  }
});

test("finalAssistantText returns the last assistant text and throws on aborted/error", async () => {
  const { finalAssistantText } = await import("../src/pi-runner.ts");
  const user = { role: "user", content: [{ type: "text", text: "q" }] };
  const old = { role: "assistant", content: [{ type: "text", text: "old answer" }], stopReason: "stop" };
  assert.equal(finalAssistantText([user, old]), "old answer");
  assert.throws(() => finalAssistantText([old, user, { role: "assistant", content: [], stopReason: "aborted" }]), /aborted/);
  assert.throws(() => finalAssistantText([old, user, { role: "assistant", content: [], stopReason: "error", errorMessage: "429 rate limit" }]), /429 rate limit/);
  assert.throws(() => finalAssistantText([old, user]), /no assistant reply/);
});

test("config disables pi telemetry for every process", async () => {
  await import("../src/config.ts");
  assert.equal(process.env.PI_TELEMETRY, "0");
});

test("manager session is read-only: it can delegate but not write files", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ws-"));
  const { router } = makeRouter(async () => "");
  const session = await buildRoleSession({ role: "manager", workspacePath: ws, router: () => router });
  try {
    assert.deepEqual(session.getActiveToolNames().sort(), ["checkpoint", "find", "grep", "handoff", "ls", "read", "reply_checkpoint"]);
    assert.ok(session.systemPrompt.includes("Everything else is delegated"));
  } finally {
    session.dispose();
  }
});

test("researcher session can search and fetch the web, but not write", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ws-"));
  const { router } = makeRouter(async () => "");
  const session = await buildRoleSession({ role: "researcher", workspacePath: ws, router: () => router });
  try {
    assert.deepEqual(session.getActiveToolNames().sort(), ["checkpoint", "find", "grep", "handoff", "internet_search", "ls", "read", "web_fetch"]);
    assert.ok(session.systemPrompt.includes("Chưa kiểm chứng"));
  } finally {
    session.dispose();
  }
});

test("web_fetch requires a internet_search first unless the URL was given in the task", async () => {
  const { router } = makeRouter(async () => "");
  const research = { searched: false, prompt: "Read https://nonexistent-host.invalid/spec please" };
  const fetchTool = makeTools("researcher", () => router, research).find(t => t.name === "web_fetch")!;
  const call = async (url: string) => ((await fetchTool.execute("c1", { url } as any, undefined as any, undefined as any, undefined as any)) as any).content[0].text as string;
  assert.match(await call("https://okfn.org"), /^ERROR: search first/);
  assert.doesNotMatch(await call("https://nonexistent-host.invalid/spec"), /search first/, "URL from the task is allowed");
  research.searched = true;
  assert.doesNotMatch(await call("https://okfn.org/x"), /search first/);
});

test("role override model is used, others get the default", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ws-"));
  const { router } = makeRouter(async () => "");
  const critic = await buildRoleSession({ role: "critic", workspacePath: ws, router: () => router });
  const dev = await buildRoleSession({ role: "developer", workspacePath: ws, router: () => router });
  try {
    assert.equal(critic.model?.id, "m-critic");
    assert.equal(dev.model?.id, "m-default");
  } finally { critic.dispose(); dev.dispose(); }
});

test("web_fetch on a search-engine page runs internet_search instead", async () => {
  const queries: string[] = [];
  const searx = createServer((req, res) => {
    queries.push(new URL(req.url!, "http://x").searchParams.get("q") ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ results: [{ title: "OKF spec", url: "https://example.org/okf", content: "Open Knowledge Format" }] }));
  });
  await new Promise<void>(r => searx.listen(0, "127.0.0.1", r));
  const saved = loadConfig();
  saveConfig({ ...saved, search: { mode: "searxng", searxngUrl: `http://127.0.0.1:${(searx.address() as AddressInfo).port}` } });
  try {
    const { router } = makeRouter(async () => "");
    const research = { searched: false, prompt: "Bạn biết Open Knowledge Format không" };
    const fetchTool = makeTools("researcher", () => router, research).find(t => t.name === "web_fetch")!;
    const call = async (url: string) => ((await fetchTool.execute("c", { url } as any, undefined as any, undefined as any, undefined as any)) as any).content[0].text as string;
    assert.match(await call("https://nonexistent-host.invalid/search?q=x"), /^ERROR: search first/, "not a search engine");
    const out = await call("https://html.duckduckgo.com/html/?q=%22Open+Knowledge+Format%22");
    assert.deepEqual(queries, ['"Open Knowledge Format"']);
    assert.ok(out.includes("OKF spec — https://example.org/okf"), out);
    assert.equal(research.searched, true, "a search page counts as searching");
  } finally {
    saveConfig(saved);
    searx.closeAllConnections();
    await new Promise(r => searx.close(r));
  }
});

test("roles written for the old web_search tool name still get web search", async () => {
  const lib = homePaths().library;
  mkdirSync(join(lib, "roles"), { recursive: true });
  writeFileSync(join(lib, "roles", "legacy.md"), "---\nname: Legacy\ndescription: old role file\nowns: Old things\ntools: read,web_search\n---\nbody\n");
  const { router } = makeRouter(async () => "");
  const session = await buildRoleSession({ role: "legacy", workspacePath: mkdtempSync(join(tmpdir(), "ws-")), router: () => router });
  try { assert.ok(session.getActiveToolNames().includes("internet_search")); }
  finally { session.dispose(); }
});
