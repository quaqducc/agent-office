import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type ServerOptions } from "../src/server.ts";
import { browseDirectory, clearDrivesCache, getDrives } from "../src/fs-browse.ts";
import { fakeFactory, never, sleep } from "./helpers/fake-runner.ts";
import type { Router } from "../src/router.ts";
import type { TeamEvent } from "../src/types.ts";

type Script = (role: string, text: string, router: Router) => Promise<string>;
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

async function setup(script: Script, extraOpts: Partial<ServerOptions> = {}) {
  const srv = await startServer({
    port: 0, dataDir: tmp("data-"),
    createRunner: (_ws, router) => fakeFactory((role, text) => script(role, text, router())),
    ...extraOpts,
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

test("fs endpoints: browse directory", async () => {
  const { srv, api } = await setup(async () => "ok");
  try {
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
  } finally { await srv.close(); }
});

test("POST /fs/pick-folder delegates to picker and returns json", async () => {
  const { srv, api } = await setup(async () => "ok", {
    pickFolder: async () => ({ canceled: false, path: "C:\\projects\\demo", name: "demo" }),
  } as any);
  try {
    const res = await api("POST", "/fs/pick-folder");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { canceled: false, path: "C:\\projects\\demo", name: "demo" });
  } finally { await srv.close(); }
});

test("POST /fs/pick-folder returns 400 when picker throws an error", async () => {
  const { srv, api } = await setup(async () => "ok", {
    pickFolder: async () => { throw new Error("UNC and device paths are not allowed"); },
  } as any);
  try {
    const res = await api("POST", "/fs/pick-folder");
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "UNC and device paths are not allowed");
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

test("queue: gửi 3 câu liên tiếp → 3 lần chạy tuần tự, không chồng nhau", async () => {
  let unblockFirst!: () => void;
  const firstBlocked = new Promise<void>(res => { unblockFirst = res; });
  let activeRuns = 0;
  let maxConcurrent = 0;
  const runOrder: string[] = [];
  const { srv, api, ws } = await setup(async (role, text) => {
    if (role === "manager" && text.startsWith("User: ")) {
      activeRuns++;
      maxConcurrent = Math.max(maxConcurrent, activeRuns);
      const msg = text.replace("User: ", "").trim();
      runOrder.push(msg);
      if (msg === "msg 1") {
        await firstBlocked;
      } else {
        await sleep(20);
      }
      activeRuns--;
      return "done";
    }
    return "ok";
  });
  try {
    const r1 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "msg 1" });
    assert.ok(r1.json.runId);
    assert.equal(r1.json.queued, undefined);

    const r2 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "msg 2" });
    assert.equal(r2.json.queued, true);
    assert.equal(r2.json.position, 1);
    assert.ok(r2.json.id);

    const r3 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "msg 3" });
    assert.equal(r3.json.queued, true);
    assert.equal(r3.json.position, 2);
    assert.ok(r3.json.id);

    unblockFirst();

    for (let i = 0; i < 100; i++) {
      await sleep(30);
      const q = await api("GET", `/workspaces/${ws.id}/queue`);
      if (q.json?.length === 0 && runOrder.length === 3 && activeRuns === 0) break;
    }
    assert.equal(maxConcurrent, 1);
    assert.deepEqual(runOrder, ["msg 1", "msg 2", "msg 3"]);
    const q = await api("GET", `/workspaces/${ws.id}/queue`);
    assert.deepEqual(q.json, []);
  } finally { await srv.close(); }
});

test("queue: xoá tin đang chờ", async () => {
  let unblockFirst!: () => void;
  const firstBlocked = new Promise<void>(res => { unblockFirst = res; });
  const executed: string[] = [];
  const { srv, api, ws } = await setup(async (role, text) => {
    if (role === "manager" && text.startsWith("User: ")) {
      const msg = text.replace("User: ", "").trim();
      executed.push(msg);
      if (msg === "msg 1") {
        await firstBlocked;
      } else {
        await sleep(20);
      }
      return "done";
    }
    return "ok";
  });
  try {
    const r1 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "msg 1" });
    assert.ok(r1.json.runId);

    const r2 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "msg 2" });
    assert.equal(r2.json.queued, true);
    const qid2 = r2.json.id;

    const r3 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "msg 3" });
    assert.equal(r3.json.queued, true);
    const qid3 = r3.json.id;

    const beforeDel = await api("GET", `/workspaces/${ws.id}/queue`);
    assert.equal(beforeDel.json.length, 2);

    const delRes = await api("DELETE", `/workspaces/${ws.id}/queue/${qid2}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.json.deleted, qid2);

    const afterDel = await api("GET", `/workspaces/${ws.id}/queue`);
    assert.equal(afterDel.json.length, 1);
    assert.equal(afterDel.json[0].id, qid3);

    unblockFirst();

    for (let i = 0; i < 100; i++) {
      await sleep(30);
      const q = await api("GET", `/workspaces/${ws.id}/queue`);
      if (q.json?.length === 0 && executed.length === 2) break;
    }

    assert.deepEqual(executed, ["msg 1", "msg 3"]);
  } finally { await srv.close(); }
});

test("queue: dừng lần chạy → chạy tiếp tin kế", async () => {
  const executed: string[] = [];
  let finishRun1: (() => void) | undefined;
  const { srv, api, ws } = await setup(async (role, text) => {
    if (role === "manager" && text.startsWith("User: ")) {
      const msg = text.replace("User: ", "").trim();
      executed.push(msg);
      if (msg === "slow") {
        await new Promise<void>(resolve => { finishRun1 = resolve; });
        return "done slow";
      }
      return "done next";
    }
    return "ok";
  });
  try {
    const r1 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "slow" });
    assert.ok(r1.json.runId);

    const r2 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "next" });
    assert.equal(r2.json.queued, true);

    await sleep(40);
    const stopRes = await api("POST", `/runs/${r1.json.runId}/stop`);
    assert.equal(stopRes.status, 200);
    finishRun1?.();

    for (let i = 0; i < 100; i++) {
      await sleep(30);
      const q = await api("GET", `/workspaces/${ws.id}/queue`);
      if (q.json?.length === 0 && executed.includes("next")) break;
    }

    assert.ok(executed.includes("slow"));
    assert.ok(executed.includes("next"));
  } finally {
    finishRun1?.();
    await srv.close();
  }
});

test("queue: hàng đợi còn sau khi tạo lại server", async () => {
  const dataDir = tmp("data-q-");
  const projDir = tmp("proj-q-");
  const executed: string[] = [];

  let unblockS1: (() => void) | undefined;
  const srv1 = await startServer({
    port: 0, dataDir,
    createRunner: () => fakeFactory(async (role, text) => {
      if (role === "manager" && text.startsWith("User: ")) {
        executed.push(text.replace("User: ", "").trim());
        await new Promise<void>(r => { unblockS1 = r; });
      }
      return "ok";
    }),
  });
  const api1 = async (m: string, p: string, b?: any) => {
    const r = await fetch(srv1.url + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json() as any };
  };
  const ws = (await api1("POST", "/workspaces", { path: projDir, name: "PersistTest" })).json;

  await api1("POST", `/workspaces/${ws.id}/messages`, { text: "run 1" });
  await api1("POST", `/workspaces/${ws.id}/messages`, { text: "queued 2" });
  await api1("POST", `/workspaces/${ws.id}/messages`, { text: "queued 3" });

  const qBefore = await api1("GET", `/workspaces/${ws.id}/queue`);
  assert.equal(qBefore.json.length, 2);

  unblockS1?.();
  await srv1.close();

  const srv2 = await startServer({
    port: 0, dataDir,
    createRunner: () => fakeFactory(async (role, text) => {
      if (role === "manager" && text.startsWith("User: ")) {
        executed.push(text.replace("User: ", "").trim());
      }
      return "ok";
    }),
  });
  const api2 = async (m: string, p: string, b?: any) => {
    const r = await fetch(srv2.url + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json() as any };
  };

  try {
    for (let i = 0; i < 100; i++) {
      await sleep(30);
      const q = await api2("GET", `/workspaces/${ws.id}/queue`);
      if (q.json?.length === 0 && executed.includes("queued 2") && executed.includes("queued 3")) break;
    }
    const qFinal = await api2("GET", `/workspaces/${ws.id}/queue`);
    assert.deepEqual(qFinal.json, []);
    assert.ok(executed.includes("queued 2"));
    assert.ok(executed.includes("queued 3"));
  } finally {
    await srv2.close();
  }
});

test("queue: reply checkpoint không bị xếp hàng", async () => {
  let devGot = "";
  const order: string[] = [];
  const { srv, api, ws } = await setup(async (role, text, router) => {
    if (role === "manager") {
      if (text.startsWith("User: ")) {
        const msg = text.replace("User: ", "").trim();
        order.push(msg);
        if (msg === "first") {
          await router.handoff("manager", { to: "developer", goal: "need approval", inputs: "", expected_output: "" });
        }
      }
      return "ok";
    }
    if (role === "developer") {
      devGot = await router.checkpoint("developer", { title: "Approve Payment", summary: "sum", approval_required: true, action: "Transfer 500" });
      return "done dev";
    }
    return "done";
  });
  try {
    await api("POST", `/workspaces/${ws.id}/messages`, { text: "first" });

    let pending: any[] = [];
    for (let i = 0; i < 100 && !pending.length; i++) {
      await sleep(20);
      pending = (await api("GET", `/workspaces/${ws.id}/approvals`)).json;
    }
    assert.equal(pending[0].action, "Transfer 500");

    const r2 = await api("POST", `/workspaces/${ws.id}/messages`, { text: "second" });
    assert.equal(r2.json.queued, true);

    const replyRes = await api("POST", `/checkpoints/${pending[0].id}/reply`, { decision: "approve", note: "approved right away" });
    assert.equal(replyRes.status, 200);

    for (let i = 0; i < 100 && !devGot; i++) await sleep(20);
    assert.match(devGot, /approved right away/);

    for (let i = 0; i < 100; i++) {
      await sleep(20);
      if (order.includes("second")) break;
    }
    assert.deepEqual(order, ["first", "second"]);
  } finally { await srv.close(); }
});

test("ide endpoints: GET /tree và GET /files", async () => {
  const { srv, api, ws } = await setup(async () => "ok");
  try {
    const wsDir = ws.path;
    writeFileSync(join(wsDir, "README.md"), "# Hello IDE");
    writeFileSync(join(wsDir, ".env"), "SECRET=true");
    mkdirSync(join(wsDir, "src"), { recursive: true });
    writeFileSync(join(wsDir, "src", "index.ts"), "export const x = 1;");

    // 1. GET /tree returns 200 and lists nodes
    const treeRes = await api("GET", `/workspaces/${ws.id}/tree?path=.&depth=1`);
    assert.equal(treeRes.status, 200);
    assert.ok(Array.isArray(treeRes.json));
    const names = treeRes.json.map((n: any) => n.name);
    assert.ok(names.includes("README.md"));
    assert.ok(names.includes("src"));
    assert.ok(names.includes(".env"));

    // 2. GET /tree with path traversal returns 403
    const travRes = await api("GET", `/workspaces/${ws.id}/tree?path=../`);
    assert.equal(travRes.status, 403);

    // 3. GET /files on valid file returns 200 and content
    const fileRes = await api("GET", `/workspaces/${ws.id}/files?path=README.md`);
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.json.content, "# Hello IDE");
    assert.equal(fileRes.json.path, "README.md");
    assert.ok(fileRes.json.sha256);

    // 4. GET /files on .env returns 403 Forbidden
    const secretRes = await api("GET", `/workspaces/${ws.id}/files?path=.env`);
    assert.equal(secretRes.status, 403);

    // 5. GET /files on nonexistent file returns 404
    const notFoundRes = await api("GET", `/workspaces/${ws.id}/files?path=nonexistent.txt`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    await srv.close();
  }
});

test("ide endpoints: PUT /files (atomic, 409, force, CRLF) và POST /files (create, 403)", async () => {
  const { srv, api, ws } = await setup(async () => "ok");
  try {
    const wsDir = ws.path;
    writeFileSync(join(wsDir, "hello.txt"), "hello world\n");
    writeFileSync(join(wsDir, "win.txt"), "line1\r\nline2\r\n");

    const readRes = await api("GET", `/workspaces/${ws.id}/files?path=hello.txt`);
    assert.equal(readRes.status, 200);
    const initialHash = readRes.json.sha256;

    // 1. PUT /files saves successfully with matching expectedSha256
    const putRes = await api("PUT", `/workspaces/${ws.id}/files`, {
      path: "hello.txt",
      content: "hello updated\n",
      expectedSha256: initialHash,
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.json.path, "hello.txt");
    assert.notEqual(putRes.json.sha256, initialHash);
    assert.equal(readFileSync(join(wsDir, "hello.txt"), "utf-8"), "hello updated\n");

    // 2. PUT /files returns 409 when expectedSha256 does not match disk
    const conflictRes = await api("PUT", `/workspaces/${ws.id}/files`, {
      path: "hello.txt",
      content: "divergent edit\n",
      expectedSha256: "stale-sha256-hash",
    });
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.json.diskContent, "hello updated\n");
    assert.ok(conflictRes.json.diskSha256);

    // 3. PUT /files with force: true succeeds despite stale hash
    const forceRes = await api("PUT", `/workspaces/${ws.id}/files`, {
      path: "hello.txt",
      content: "forced overwrite\n",
      expectedSha256: "stale-sha256-hash",
      force: true,
    });
    assert.equal(forceRes.status, 200);
    assert.equal(readFileSync(join(wsDir, "hello.txt"), "utf-8"), "forced overwrite\n");

    // 4. PUT /files preserves CRLF
    const winRead = await api("GET", `/workspaces/${ws.id}/files?path=win.txt`);
    const winPut = await api("PUT", `/workspaces/${ws.id}/files`, {
      path: "win.txt",
      content: "line1\nline2\nline3\n",
      expectedSha256: winRead.json.sha256,
    });
    assert.equal(winPut.status, 200);
    assert.equal(readFileSync(join(wsDir, "win.txt"), "utf-8"), "line1\r\nline2\r\nline3\r\n");

    // 5. POST /files creates a new file and returns 201
    const createRes = await api("POST", `/workspaces/${ws.id}/files`, {
      path: "src/utils/calc.ts",
      content: "export const add = (a: number, b: number) => a + b;",
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.json.path, "src/utils/calc.ts");
    assert.equal(readFileSync(join(wsDir, "src", "utils", "calc.ts"), "utf-8"), "export const add = (a: number, b: number) => a + b;");

    // 6. POST /files returns 409 if file already exists
    const dupRes = await api("POST", `/workspaces/${ws.id}/files`, {
      path: "src/utils/calc.ts",
      content: "new",
    });
    assert.equal(dupRes.status, 409);

    // 7. POST /files returns 403 on traversal or secret file
    const travRes = await api("POST", `/workspaces/${ws.id}/files`, {
      path: "../outside.txt",
      content: "evil",
    });
    assert.equal(travRes.status, 403);

    const secRes = await api("POST", `/workspaces/${ws.id}/files`, {
      path: ".env",
      content: "SECRET=1",
    });
    assert.equal(secRes.status, 403);
  } finally {
    await srv.close();
  }
});

test("ide endpoints: GET /changes và GET /diff (shadow diff, jail, secret check)", async () => {
  const { srv, api, ws } = await setup(async () => "ok");
  const wsDir = ws.path;

  try {
    const runId = "11111111-2222-3333-4444-555555555555";
    const shadowDir = join(wsDir, ".company", "shadow", runId);
    mkdirSync(shadowDir, { recursive: true });

    // Original file before run
    writeFileSync(join(wsDir, "app.ts"), "const a = 1;\nconst b = 2;\n", "utf-8");
    // Shadow copy saved at original state
    writeFileSync(join(shadowDir, "app.ts"), "const a = 1;\nconst b = 2;\n", "utf-8");
    // New file created in run (status A)
    writeFileSync(join(wsDir, "new.ts"), "export const x = 42;\n", "utf-8");

    // Manifest
    const manifest = {
      runId,
      files: {
        "app.ts": { status: "M", capturedAt: new Date().toISOString() },
        "new.ts": { status: "A", capturedAt: new Date().toISOString() },
      },
    };
    writeFileSync(join(shadowDir, ".manifest.json"), JSON.stringify(manifest), "utf-8");

    // Modify app.ts on disk during run
    writeFileSync(join(wsDir, "app.ts"), "const a = 1;\nconst b = 99;\nconst c = 3;\n", "utf-8");

    // 1. GET /changes returns A/M file list
    const changesRes = await api("GET", `/workspaces/${ws.id}/changes?runId=${runId}`);
    assert.equal(changesRes.status, 200);
    assert.deepEqual(changesRes.json, [
      { path: "app.ts", status: "M" },
      { path: "new.ts", status: "A" },
    ]);

    // Missing runId returns 400
    const noRunRes = await api("GET", `/workspaces/${ws.id}/changes`);
    assert.equal(noRunRes.status, 400);

    // 2. GET /diff compares shadow with current disk
    const diffApp = await api("GET", `/workspaces/${ws.id}/diff?path=app.ts&runId=${runId}`);
    assert.equal(diffApp.status, 200);
    assert.equal(diffApp.json.path, "app.ts");
    assert.equal(diffApp.json.additions, 2); // b = 99, c = 3
    assert.equal(diffApp.json.deletions, 1); // b = 2

    // 3. GET /diff for added file "new.ts" treats shadow as empty (all add)
    const diffNew = await api("GET", `/workspaces/${ws.id}/diff?path=new.ts&runId=${runId}`);
    assert.equal(diffNew.status, 200);
    assert.equal(diffNew.json.additions, 2);
    assert.equal(diffNew.json.deletions, 0);

    // 4. GET /diff returns 403 on traversal or secret file
    const travDiff = await api("GET", `/workspaces/${ws.id}/diff?path=../secret.txt&runId=${runId}`);
    assert.equal(travDiff.status, 403);

    const secDiff = await api("GET", `/workspaces/${ws.id}/diff?path=.env&runId=${runId}`);
    assert.equal(secDiff.status, 403);
  } finally {
    await srv.close();
  }
});
