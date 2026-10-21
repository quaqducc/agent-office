import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { browseDirectory } from "../src/fs-browse.ts";
import { fakeFactory, never, sleep } from "./helpers/fake-runner.ts";
import type { Router } from "../src/router.ts";
import type { TeamEvent } from "../src/types.ts";

type Script = (role: string, text: string, router: Router) => Promise<string>;
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

async function setup(script: Script) {
  const srv = await startServer({
    port: 0, dataDir: tmp("data-"),
    createRunner: (_ws, router) => fakeFactory((role, text) => script(role, text, router())),
  });
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(srv.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() as any };
  };
  const ws = (await api("POST", "/workspaces", { path: tmp("proj-"), name: "Test" })).json;
  return { srv, api, ws };
}

/** Collect SSE events for a workspace until `until` matches or timeout. */
async function collect(url: string, until: (e: TeamEvent) => boolean, ms = 3000): Promise<TeamEvent[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const out: TeamEvent[] = [];
  const res = await fetch(url, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = frame.split("\n").find(l => l.startsWith("data: "));
        if (!line) continue;
        const e = JSON.parse(line.slice(6)) as TeamEvent;
        out.push(e);
        if (until(e)) { ctrl.abort(); return out; }
      }
    }
  } catch (err) {
    if (!ctrl.signal.aborted) throw err;
  } finally { clearTimeout(timer); }
  return out;
}

test("registers workspace, lists it, and serves roles", async () => {
  const { srv, api, ws } = await setup(async () => "ok");
  try {
    assert.match(ws.id, /^test-/);
    assert.deepEqual((await api("GET", "/workspaces")).json.map((w: any) => w.id), [ws.id]);
    const roles = (await api("GET", "/roles")).json;
    assert.ok(roles.some((r: any) => r.id === "critic" && r.name === "Critic"));
    assert.equal((await api("POST", "/workspaces", { path: "Z:/nope/missing" })).status, 400);
    assert.equal((await api("GET", "/workspaces/nope/runs")).status, 404);
  } finally { await srv.close(); }
});

test("renames workspace via PATCH /workspaces/:id", async () => {
  const { srv, api, ws } = await setup(async () => "ok");
  try {
    const res = await api("PATCH", `/workspaces/${ws.id}`, { name: "  Renamed WS  " });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ws.id);
    assert.equal(res.json.name, "Renamed WS");
    assert.equal(res.json.path, ws.path);

    const list = (await api("GET", "/workspaces")).json;
    assert.equal(list.find((w: any) => w.id === ws.id)?.name, "Renamed WS");

    assert.equal((await api("PATCH", `/workspaces/${ws.id}`, { name: "   " })).status, 400);
    assert.equal((await api("PATCH", `/workspaces/${ws.id}`, {})).status, 400);
    assert.equal((await api("PATCH", "/workspaces/unknown-id-xyz", { name: "Valid" })).status, 404);

    const nonJson = await fetch(`${srv.url}/workspaces/${ws.id}`, { method: "PATCH", headers: { "content-type": "text/plain" }, body: "name=foo" });
    assert.equal(nonJson.status, 415);
  } finally { await srv.close(); }
});

test("fs endpoints: drives and browse directory", async () => {
  const { srv, api } = await setup(async () => "ok");
  try {
    const drives = await api("GET", "/fs/drives");
    assert.equal(drives.status, 200);
    assert.ok(Array.isArray(drives.json.roots));
    assert.ok(drives.json.roots.length > 0);
    assert.ok(typeof drives.json.home === "string");

    const base = tmp("fs-browse-");
    mkdirSync(join(base, "sub1"));
    mkdirSync(join(base, "sub2"));
    mkdirSync(join(base, ".hidden"));
    mkdirSync(join(base, "Windows"));
    writeFileSync(join(base, "file.txt"), "hello");

    const res = await api("POST", "/fs/browse", { path: base });
    assert.equal(res.status, 200);
    assert.equal(res.json.current, base);
    assert.ok(Array.isArray(res.json.folders));
    const names = res.json.folders.map((f: any) => f.name);
    assert.ok(names.includes("sub1"));
    assert.ok(names.includes("sub2"));
    assert.ok(!names.includes("file.txt"), "files must NOT be returned");
    assert.ok(!names.includes(".hidden"), "hidden folders must be skipped");
    assert.ok(!names.includes("Windows"), "system folders must be skipped");

    const missing = await api("POST", "/fs/browse", { path: join(base, "not-exist-xyz") });
    assert.equal(missing.status, 404);

    const notDir = await api("POST", "/fs/browse", { path: join(base, "file.txt") });
    assert.equal(notDir.status, 400);

    const def = await api("POST", "/fs/browse", {});
    assert.equal(def.status, 200);
    assert.ok(def.json.current);
  } finally { await srv.close(); }
});

test("fs browse handles permission error gracefully", async () => {
  const target = tmp("perm-test-");
  const fakeReaddir: any = () => {
    const err = new Error("EACCES: permission denied") as any;
    err.code = "EACCES";
    throw err;
  };
  const res = browseDirectory(target, fakeReaddir);
  assert.deepEqual(res.folders, []);
  assert.equal(res.error, "permission denied");
});

test("message starts run, SSE streams events, run is indexed and replayable", async () => {
  const { srv, api, ws } = await setup(async role => (role === "manager" ? "xin chào" : ""));
  try {
    const events = collect(`${srv.url}/events?workspace=${ws.id}`, e => e.type === "run_finished");
    await sleep(50);
    const { json } = await api("POST", `/workspaces/${ws.id}/messages`, { text: "hi" });
    const got = await events;
    assert.ok(got.some(e => e.type === "manager_reply" && e.data.text === "xin chào"));
    const runs = (await api("GET", `/workspaces/${ws.id}/runs`)).json;
    assert.equal(runs[0].runId, json.runId);
    assert.equal(runs[0].status, "done");
    const replay = (await api("GET", `/runs/${json.runId}/events`)).json as TeamEvent[];
    assert.deepEqual(replay.map(e => e.type).slice(0, 2), ["run_started", "user_message"]);
    assert.equal(replay.at(-1)!.type, "run_finished");
  } finally { await srv.close(); }
});

test("approval reply endpoint resolves pending approval", async () => {
  let devGot = "";
  const { srv, api, ws } = await setup(async (role, text, router) => {
    if (role === "manager") {
      if (text.startsWith("User:")) await router.handoff("manager", { to: "developer", goal: "buy", inputs: "", expected_output: "" });
      return "ok";
    }
    devGot = await router.checkpoint("developer", { title: "Buy", summary: "s", approval_required: true, action: "Pay 10k" });
    return "done";
  });
  try {
    await api("POST", `/workspaces/${ws.id}/messages`, { text: "go" });
    let pending: any[] = [];
    for (let i = 0; i < 100 && !pending.length; i++) { await sleep(10); pending = (await api("GET", `/workspaces/${ws.id}/approvals`)).json; }
    assert.equal(pending[0].action, "Pay 10k");
    assert.equal((await api("POST", `/checkpoints/${pending[0].id}/reply`, { decision: "approve", note: "ok" })).status, 200);
    assert.equal((await api("POST", `/checkpoints/nope/reply`, { decision: "approve" })).status, 404);
    for (let i = 0; i < 100 && !devGot; i++) await sleep(10);
    assert.equal(devGot, "User decision: approve. ok");
  } finally { await srv.close(); }
});

test("stop endpoint stops run", async () => {
  const { srv, api, ws } = await setup(async () => never());
  try {
    const events = collect(`${srv.url}/events?workspace=${ws.id}`, e => e.type === "run_finished");
    await sleep(50);
    const { json } = await api("POST", `/workspaces/${ws.id}/messages`, { text: "go" });
    await sleep(30);
    assert.equal((await api("POST", `/runs/${json.runId}/stop`)).status, 200);
    const fin = (await events).at(-1)!;
    assert.equal(fin.type, "run_finished");
    assert.equal(fin.data.status, "stopped");
  } finally { await srv.close(); }
});

test("binds 127.0.0.1", async () => {
  const { srv } = await setup(async () => "");
  try { assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/); } finally { await srv.close(); }
});

test("rejects cross-origin and foreign Host requests", async () => {
  const { srv, ws } = await setup(async () => "");
  try {
    const evil = await fetch(`${srv.url}/workspaces/${ws.id}/messages`, { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" }, body: JSON.stringify({ text: "rm -rf" }) });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    const plain = await fetch(`${srv.url}/workspaces/${ws.id}/messages`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ text: "x" }) });
    assert.equal(plain.status, 415);
    const { request } = await import("node:http");
    const status = await new Promise<number>((res, rej) => {
      const u = new URL(srv.url);
      request({ host: u.hostname, port: u.port, path: "/workspaces", headers: { host: "attacker.example" } }, r => { r.resume(); res(r.statusCode!); }).on("error", rej).end();
    });
    assert.equal(status, 403);
  } finally { await srv.close(); }
});

test("marks runs left active by a crash as interrupted on start", async () => {
  const dataDir = tmp("data-");
  const { WorkspaceStore } = await import("../src/workspace.ts");
  const store = new WorkspaceStore(dataDir);
  const ws = store.add(tmp("proj-"));
  store.appendRun(ws, { runId: "r-old", startedAt: "t0", status: "active", firstMessage: "hi", tokens: 0 });
  const srv = await startServer({ port: 0, dataDir, createRunner: () => fakeFactory(async () => "") });
  try {
    assert.equal(store.runs(ws)[0].status, "interrupted");
  } finally { await srv.close(); }
});
