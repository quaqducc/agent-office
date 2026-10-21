import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { browseDirectory, clearDrivesCache, getDrives } from "../src/fs-browse.ts";
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
    assert.equal((await api("PATCH", `/workspaces/${ws.id}`, { name: "a".repeat(81) })).status, 400, "name > 80 chars rejected");
    assert.equal((await api("PATCH", `/workspaces/${ws.id}`, { name: "Bad\x00Name" })).status, 400, "null byte rejected");
    assert.equal((await api("PATCH", `/workspaces/${ws.id}`, { name: "Bad\x1fName" })).status, 400, "control char rejected");
    assert.equal((await api("PATCH", `/workspaces/${ws.id}`, { name: "Bad\x7fName" })).status, 400, "delete char rejected");
    assert.equal((await api("PATCH", "/workspaces/unknown-id-xyz", { name: "Valid" })).status, 404);

    const nonJson = await fetch(`${srv.url}/workspaces/${ws.id}`, { method: "PATCH", headers: { "content-type": "text/plain" }, body: "name=foo" });
    assert.equal(nonJson.status, 415);
  } finally { await srv.close(); }
});

test("offices endpoint and PUT /workspaces/:id/config", async () => {
  const { srv, api } = await setup(async () => "ok");
  try {
    const offices = await api("GET", "/offices");
    assert.equal(offices.status, 200);
    assert.ok(Array.isArray(offices.json));
    assert.equal(offices.json.length, 4);
    for (const t of offices.json) {
      assert.ok(t.id && t.name && t.desc);
      assert.ok(Array.isArray(t.roles) && t.roles.includes("researcher"));
      assert.ok(Array.isArray(t.rooms) && t.rooms.length > 0);
    }

    const ws = (await api("POST", "/workspaces", { path: tmp("ws-cfg-") })).json;

    // Reject uninstalled roles with missing list
    const uninstalled = await api("PUT", `/workspaces/${ws.id}/config`, { roles: ["manager", "super-agent-xyz"] });
    assert.equal(uninstalled.status, 400);
    assert.ok(uninstalled.json.missing?.includes("super-agent-xyz"));

    // Reject unknown workspace
    const unknownWs = await api("PUT", "/workspaces/unknown-ws-123/config", { roles: ["manager"] });
    assert.equal(unknownWs.status, 404);

    // Save valid config
    const valid = await api("PUT", `/workspaces/${ws.id}/config`, {
      template: "startup-mvp",
      roles: ["manager", "developer", "researcher", "critic"],
      rooms: [
        { id: "exec", name: "Ban Giám Đốc", roles: ["manager"] },
        { id: "team", name: "Nhóm Dự Án", roles: ["developer", "researcher", "critic"] },
      ],
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.json.template, "startup-mvp");
    assert.deepEqual(valid.json.roles, ["manager", "developer", "researcher", "critic"]);
    assert.equal(valid.json.rooms?.length, 2);

    // GET /workspaces/:id/config returns the saved configuration
    const fetched = await api("GET", `/workspaces/${ws.id}/config`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.template, "startup-mvp");
    assert.deepEqual(fetched.json.rooms, valid.json.rooms);
  } finally { await srv.close(); }
});

test("PUT /workspaces/:id/config returns 409 when run is active", async () => {
  const { srv, api, ws } = await setup(async () => {
    await sleep(200);
    return "ok";
  });
  try {
    // Start a run in the workspace
    await api("POST", `/workspaces/${ws.id}/messages`, { text: "start" });
    // Attempt to update config while run is active
    const res = await api("PUT", `/workspaces/${ws.id}/config`, { roles: ["manager"] });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, "Đang có lần chạy — lưu lại sau khi đội rảnh");
  } finally { await srv.close(); }
});

test("PUT /workspaces/:id/config deduplicates roles and rejects invalid rooms", async () => {
  const { srv, api, ws } = await setup(async () => "ok");
  try {
    // Duplicate roles in payload are deduplicated
    const res = await api("PUT", `/workspaces/${ws.id}/config`, { roles: ["manager", "developer", "developer"] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.roles, ["manager", "developer"]);

    // More than 6 rooms rejected
    const tooMany = Array.from({ length: 7 }, (_, i) => ({ id: `r-${i}`, name: `R${i}`, roles: [] }));
    const r1 = await api("PUT", `/workspaces/${ws.id}/config`, { roles: ["manager"], rooms: tooMany });
    assert.equal(r1.status, 400);

    // Invalid room id format
    const r2 = await api("PUT", `/workspaces/${ws.id}/config`, { roles: ["manager"], rooms: [{ id: "Invalid ID", name: "Room", roles: [] }] });
    assert.equal(r2.status, 400);

    // Changing rooms does not rebuild router (preserves active context)
    const r3 = await api("PUT", `/workspaces/${ws.id}/config`, {
      roles: ["manager", "developer"],
      rooms: [{ id: "r1", name: "Executive", roles: ["manager", "developer"] }],
    });
    assert.equal(r3.status, 200);

    // Update only room name: router is kept
    const r4 = await api("PUT", `/workspaces/${ws.id}/config`, {
      roles: ["manager", "developer"],
      rooms: [{ id: "r1", name: "Renamed Room", roles: ["manager", "developer"] }],
    });
    assert.equal(r4.status, 200);
    assert.equal(r4.json.rooms[0].name, "Renamed Room");
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
    mkdirSync(join(base, "dev"));
    mkdirSync(join(base, ".hidden"));
    writeFileSync(join(base, "file.txt"), "hello");

    const res = await api("POST", "/fs/browse", { path: base });
    assert.equal(res.status, 200);
    assert.equal(res.json.current, base);
    assert.ok(Array.isArray(res.json.folders));
    const names = res.json.folders.map((f: any) => f.name);
    assert.ok(names.includes("sub1"));
    assert.ok(names.includes("sub2"));
    assert.ok(names.includes("dev"), "regular subfolder named dev must NOT be hidden");
    assert.ok(!names.includes("file.txt"), "files must NOT be returned");
    assert.ok(!names.includes(".hidden"), "hidden folders must be skipped");

    const missing = await api("POST", "/fs/browse", { path: join(base, "not-exist-xyz") });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, "folder not found or not a directory");

    const notDir = await api("POST", "/fs/browse", { path: join(base, "file.txt") });
    assert.equal(notDir.status, 404);
    assert.equal(notDir.json.error, "folder not found or not a directory");

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
  const res = await browseDirectory(target, fakeReaddir);
  assert.deepEqual(res.folders, []);
  assert.equal(res.error, "permission denied");
});

test("request body exceeding 1MB returns 413 payload too large", async () => {
  const { srv, ws } = await setup(async () => "ok");
  try {
    const huge = JSON.stringify({ text: "x".repeat(1024 * 1024 + 10) });
    const res = await fetch(`${srv.url}/workspaces/${ws.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: huge,
    });
    assert.equal(res.status, 413);
    const json = await res.json() as any;
    assert.equal(json.error, "payload too large");
  } finally { await srv.close(); }
});

test("rejects UNC and device paths in /fs/browse and /workspaces", async () => {
  const { srv, api } = await setup(async () => "ok");
  try {
    if (process.platform === "win32") {
      const b1 = await api("POST", "/fs/browse", { path: "\\\\server\\share" });
      assert.equal(b1.status, 400);
      assert.match(b1.json.error, /UNC and device paths are not allowed|invalid Windows drive path/);

      const b2 = await api("POST", "/fs/browse", { path: "//server/share" });
      assert.equal(b2.status, 400);

      const w1 = await api("POST", "/workspaces", { path: "\\\\server\\share" });
      assert.equal(w1.status, 400);

      const w2 = await api("POST", "/workspaces", { path: "//server/share" });
      assert.equal(w2.status, 400);
    }
  } finally { await srv.close(); }
});

test("drives cache with 60s TTL and browseDirectory truncated at 2000 folders", async () => {
  clearDrivesCache();
  const d1 = getDrives(1000);
  const d2 = getDrives(1000 + 30_000);
  assert.equal(d1, d2, "within 60s returns identical cached object reference");
  const d3 = getDrives(1000 + 61_000);
  assert.notEqual(d1, d3, "after 60s cache expires and recomputes");

  const target = tmp("trunc-test-");
  const fakeReaddir: any = async () => {
    const arr = [];
    for (let i = 0; i < 2050; i++) {
      arr.push({ name: `folder-${i}`, isDirectory: () => true, isSymbolicLink: () => false });
    }
    return arr;
  };
  const res = await browseDirectory(target, fakeReaddir);
  assert.equal(res.folders.length, 2000);
  assert.equal(res.truncated, true);
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
