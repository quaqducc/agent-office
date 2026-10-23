import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

process.env.AGENT_COMPANY_HOME = mkdtempSync(join(tmpdir(), "sec-high-home-"));

import { assertSafeWorkspacePath, isSecretPath } from "../src/ide-fs.ts";
import { checkToolCall } from "../src/guard.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { enforceShadowQuota } from "../src/shadow.ts";

function freshDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("1.1 NTFS alternate data streams and short names blocked", { skip: process.platform !== "win32" }, () => {
  const ws = freshDir("sec-high-ads-");
  try {
    // 1. ADS with ::$DATA or stream name
    assert.throws(() => assertSafeWorkspacePath(ws, ".env::$DATA"), /denied/i);
    assert.throws(() => assertSafeWorkspacePath(ws, "secret.key:stream"), /denied/i);
    assert.throws(() => assertSafeWorkspacePath(ws, "sub/file.txt:stream"), /denied/i);

    // 2. Trailing spaces and dots
    assert.throws(() => assertSafeWorkspacePath(ws, ".env. "), /denied/i);
    assert.throws(() => assertSafeWorkspacePath(ws, ".env..."), /denied/i);
    assert.throws(() => assertSafeWorkspacePath(ws, ".git "), /denied/i);

    // 3. DOS 8.3 short names
    assert.throws(() => assertSafeWorkspacePath(ws, "PROGRA~1"), /denied/i);
    assert.throws(() => assertSafeWorkspacePath(ws, "SECRE~1.TXT"), /denied/i);

    // 4. Guard checkToolCall blocks ADS and short names
    const r1 = checkToolCall("read", { path: ".env::$DATA" }, ws);
    assert.equal(r1.block, true);

    const r2 = checkToolCall("read", { path: "secret.key:stream" }, ws);
    assert.equal(r2.block, true);

    const r3 = checkToolCall("read", { path: ".env. " }, ws);
    assert.equal(r3.block, true);

    const r4 = checkToolCall("read", { path: "SECRE~1" }, ws);
    assert.equal(r4.block, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("1.1 Guard blocks ADS and short names on win32 path API (cross-platform)", () => {
  const fakeWs = "C:\\projects\\demo";

  const r1 = checkToolCall("read", { path: ".env::$DATA" }, fakeWs, win32);
  assert.equal(r1.block, true);

  const r2 = checkToolCall("read", { path: "secret.key:stream" }, fakeWs, win32);
  assert.equal(r2.block, true);

  const r3 = checkToolCall("read", { path: ".env. " }, fakeWs, win32);
  assert.equal(r3.block, true);

  const r4 = checkToolCall("read", { path: "SECRE~1" }, fakeWs, win32);
  assert.equal(r4.block, true);

  const r5 = checkToolCall("read", { path: "compan~1/queue.json" }, fakeWs, win32);
  assert.equal(r5.block, true);

  const r6 = checkToolCall("read", { path: "git~1/config" }, fakeWs, win32);
  assert.equal(r6.block, true);
});

test("1.2 Symlink to sensitive targets rejected in assertSafeWorkspacePath and guard", () => {
  const ws = freshDir("sec-high-symlink-");
  const outsideDir = freshDir("sec-high-outside-");
  try {
    mkdirSync(join(ws, ".company"), { recursive: true });
    writeFileSync(join(ws, ".company", "queue.json"), "[]");
    writeFileSync(join(outsideDir, "secret.txt"), "OUTSIDE");

    let hasJunction = false;
    try {
      symlinkSync(join(ws, ".company"), join(ws, "company-link"), process.platform === "win32" ? "junction" : "dir");
      symlinkSync(outsideDir, join(ws, "outside-link"), process.platform === "win32" ? "junction" : "dir");
      hasJunction = true;
    } catch {}

    assert.equal(hasJunction, true, "Junction/symlink should be created for testing");

    // Nominal path company-link/queue.json resolves to sensitive target inside .company
    assert.throws(() => assertSafeWorkspacePath(ws, "company-link/queue.json"), /denied/i);

    // Symlink resolving outside workspace throws
    assert.throws(() => assertSafeWorkspacePath(ws, "outside-link/secret.txt"), /denied/i);

    // Guard checkToolCall should block read and write tools through junction
    const rRead = checkToolCall("read", { path: "company-link/queue.json" }, ws);
    assert.equal(rRead.block, true);

    const rWrite = checkToolCall("write", { path: "company-link/queue.json" }, ws);
    assert.equal(rWrite.block, true);

    const rWriteOut = checkToolCall("write", { path: "outside-link/secret.txt" }, ws);
    assert.equal(rWriteOut.block, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("1.3a Untrusted queue items without local HMAC not auto-run, length capped", () => {
  const home = freshDir("sec-high-home-");
  const wsDir = freshDir("sec-high-ws-");
  try {
    const store = new WorkspaceStore(home);
    const ws = store.add(wsDir, "Test WS");

    // 1. Text > 20000 characters rejected
    assert.throws(() => store.enqueue(ws, "a".repeat(20001)), /length|too large|exceed/i);

    // 2. Normal enqueue has valid HMAC
    const { item } = store.enqueue(ws, "Hello Manager");
    assert.ok(item.id);
    const queue = store.getQueue(ws);
    assert.equal(queue.length, 1);
    assert.equal((queue[0] as any).untrusted, undefined);

    // 3. Tampered or foreign queue.json without matching HMAC gets untrusted: true
    const foreignQueue = [
      {
        id: "foreign-1",
        text: "rm -rf / --no-preserve-root",
        createdAt: new Date().toISOString(),
        // no hmac or invalid hmac
      },
    ];
    writeFileSync(join(wsDir, ".company", "queue.json"), JSON.stringify(foreignQueue, null, 2));

    const loaded = store.getQueue(ws);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].untrusted, true);

    // Dequeue for auto-run should NOT return untrusted items
    const next = store.dequeue(ws);
    assert.equal(next, undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("1.3b Shadow symlinks rejected, quota only deletes valid run directories", async () => {
  const wsDir = freshDir("sec-high-shadow-");
  const victimDir = freshDir("sec-high-victim-");
  try {
    const shadowDir = join(wsDir, ".company", "shadow");
    mkdirSync(shadowDir, { recursive: true });

    writeFileSync(join(victimDir, "important.txt"), "DO NOT DELETE");

    let canSymlink = true;
    try {
      symlinkSync(victimDir, join(shadowDir, "symlink-dir"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      canSymlink = false;
    }

    // enforceShadowQuota with maxBytes: 0 forces cleanup of old runs
    await enforceShadowQuota(wsDir, 0);

    const { existsSync } = await import("node:fs");
    // Victim dir must never be touched through symlink
    assert.equal(existsSync(join(victimDir, "important.txt")), true);
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
    rmSync(victimDir, { recursive: true, force: true });
  }
});
