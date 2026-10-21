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
  const b = store.add(folder + "/");
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

test("rejects UNC and device paths on Windows", () => {
  const store = new WorkspaceStore(tmp("data-"));
  if (process.platform === "win32") {
    assert.throws(() => store.add("\\\\server\\share"), /UNC and device paths are not allowed|invalid Windows drive path/);
    assert.throws(() => store.add("//server/share"), /UNC and device paths are not allowed|invalid Windows drive path/);
    assert.throws(() => store.add("\\\\?\\C:\\test"), /UNC and device paths are not allowed|invalid Windows drive path/);
    assert.throws(() => store.add("\\\\.\\pipe\\test"), /UNC and device paths are not allowed|invalid Windows drive path/);
  }
});

test("rename and add reject name exceeding 80 characters or containing control characters", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "ws-data-")));
  const folder = mkdtempSync(join(tmpdir(), "ws-sec-"));
  const ws = store.add(folder, "Valid Name");

  // Name > 80 chars
  const tooLong = "a".repeat(81);
  assert.throws(() => store.rename(ws.id, tooLong), /80 characters or less/);
  assert.throws(() => store.add(folder, tooLong), /80 characters or less/);

  // Control characters
  assert.throws(() => store.rename(ws.id, "Invalid\x00Name"), /invalid.*characters/);
  assert.throws(() => store.rename(ws.id, "Invalid\x1fName"), /invalid.*characters/);
  assert.throws(() => store.rename(ws.id, "Invalid\x7fName"), /invalid.*characters/);
});

test("rejects missing folder", () => {
  const store = new WorkspaceStore(tmp("data-"));
  assert.throws(() => store.add(join(tmpdir(), "definitely-missing-xyz-123")), /not a folder/);
});

test("add accepts pasted paths with quotes or spaces", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "ws-data-")));
  const folder = mkdtempSync(join(tmpdir(), "ws-quoted-"));
  const ws = store.add(`  "${folder}"  `, "Quoted");
  assert.equal(ws.path, folder);
  assert.equal(store.add(`'${folder}'`).id, ws.id, "same folder, same workspace");
});

test("adding an already registered folder with a new name renames it", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "ws-data-")));
  const folder = mkdtempSync(join(tmpdir(), "ws-rename-"));
  const first = store.add(folder, "Old name");
  const again = store.add(folder, "agent-company");
  assert.equal(again.id, first.id);
  assert.equal(again.name, "agent-company");
  assert.equal(store.get(first.id)!.name, "agent-company");
  assert.equal(store.add(folder).name, "agent-company", "no name given keeps the current one");
});

test("rename updates workspace name and persists", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "ws-data-")));
  const folder = mkdtempSync(join(tmpdir(), "ws-rename-"));
  const ws = store.add(folder, "Old name");
  const renamed = store.rename(ws.id, "  New name  ");
  assert.equal(renamed.name, "New name");
  assert.equal(renamed.id, ws.id);
  assert.equal(renamed.path, folder);
  assert.equal(store.get(ws.id)!.name, "New name");
  assert.equal(new WorkspaceStore(store.dataDir).get(ws.id)!.name, "New name", "persists to disk");
  assert.throws(() => store.rename(ws.id, "   "), /name is required/);
  assert.throws(() => store.rename("unknown-id-123", "Valid"), /unknown workspace/);
});

test("config and saveConfig persist template, rooms and enforce invariants", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "ws-data-")));
  const folder = mkdtempSync(join(tmpdir(), "ws-cfg-"));
  const ws = store.add(folder, "Cfg WS");

  // Initial config has no template or rooms
  const initial = store.config(ws);
  assert.equal(initial.template, undefined);
  assert.equal(initial.rooms, undefined);
  assert.ok(initial.roles.includes("manager"));

  // Save config with template and rooms, with duplicates and unassigned roles
  store.saveConfig(ws, {
    template: "startup-mvp",
    roles: ["researcher", "critic"], // manager omitted intentionally
    rooms: [
      { id: "r1", name: "Room 1", roles: ["researcher", "critic"] },
      { id: "r2", name: "Room 2", roles: ["critic"] }, // duplicate critic
    ],
  });

  const updated = store.config(ws);
  assert.equal(updated.template, "startup-mvp");
  // Invariant 1: manager is always present
  assert.ok(updated.roles.includes("manager"));
  assert.ok(updated.rooms);
  assert.equal(updated.rooms!.length, 2);

  // Invariant 2: critic is only in r1, not duplicated in r2
  assert.deepEqual(updated.rooms![0].roles, ["researcher", "critic", "manager"]); // manager was unassigned, pushed to first room
  assert.deepEqual(updated.rooms![1].roles, []);

  // Limits preserved
  assert.ok(updated.limits.maxDepth > 0);
});

