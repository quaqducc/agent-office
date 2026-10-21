import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../src/workspace.ts";
import { DEFAULT_LIMITS } from "../src/config.ts";
import { roleIds } from "../src/library.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

test("add is idempotent and creates .company folders", () => {
  const store = new WorkspaceStore(tmp("data-"));
  const folder = tmp("proj-");
  const a = store.add(folder, "MMO Shop");
  const b = store.add(folder + "/", "other name");
  assert.equal(a.id, b.id);
  assert.match(a.id, /^mmo-shop-[0-9a-f]{6}$/);
  assert.equal(store.list().length, 1);
  assert.ok(existsSync(join(folder, ".company", "runs")) && existsSync(join(folder, ".company", "sessions")));
  assert.deepEqual(new WorkspaceStore(store.dataDir).get(a.id), a, "registry persists");
});

test("config merges defaults", () => {
  const store = new WorkspaceStore(tmp("data-"));
  const ws = store.add(tmp("proj-"));
  assert.deepEqual(store.config(ws).roles, roleIds(), "defaults to every installed role");
  assert.ok(store.config(ws).roles.includes("manager"));
  assert.deepEqual(store.config(ws).limits, DEFAULT_LIMITS);
  writeFileSync(join(ws.path, ".company", "config.json"), JSON.stringify({ roles: ["manager", "critic"], limits: { maxConcurrent: 1 } }));
  assert.deepEqual(store.config(ws).roles, ["manager", "critic"]);
  assert.equal(store.config(ws).limits.maxConcurrent, 1);
  assert.equal(store.config(ws).limits.maxDepth, DEFAULT_LIMITS.maxDepth);
});

test("config always keeps the manager", () => {
  const store = new WorkspaceStore(tmp("data-"));
  const ws = store.add(tmp("proj-"));
  writeFileSync(join(ws.path, ".company", "config.json"), JSON.stringify({ roles: ["critic"] }));
  assert.deepEqual(store.config(ws).roles, ["manager", "critic"]);
});

test("run index round-trips and updates by runId", () => {
  const store = new WorkspaceStore(tmp("data-"));
  const ws = store.add(tmp("proj-"));
  store.appendRun(ws, { runId: "r1", startedAt: "t0", status: "active", firstMessage: "hi", tokens: 0 });
  store.appendRun(ws, { runId: "r1", startedAt: "t0", endedAt: "t1", status: "done", firstMessage: "hi", tokens: 42 });
  assert.deepEqual(store.runs(ws), [{ runId: "r1", startedAt: "t0", endedAt: "t1", status: "done", firstMessage: "hi", tokens: 42 }]);
});

test("rejects missing folder", () => {
  const store = new WorkspaceStore(tmp("data-"));
  assert.throws(() => store.add(join(tmpdir(), "definitely-missing-xyz-123")), /not a folder/);
});
