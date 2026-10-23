import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

function freshDir(prefix: string): string {
  const p = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(p, { recursive: true });
  return p;
}

process.env.AGENT_COMPANY_HOME = freshDir("sec-reg-global-home-");

import { startServer } from "../src/server.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { fakeFactory } from "./helpers/fake-runner.ts";

test("Item A & B: CSP does not contain unsafe-inline, meta holds token, and SSE requires token", async () => {
  const dataDir = freshDir("sec-reg-data-");
  const tempHome = freshDir("sec-reg-home-");
  const wsDir = freshDir("sec-reg-ws-");
  const savedHome = process.env.AGENT_COMPANY_HOME;
  process.env.AGENT_COMPANY_HOME = tempHome;

  const store = new WorkspaceStore(dataDir);
  const ws = store.add(wsDir, "Test WS");

  const srv = await startServer({
    port: 0,
    dataDir,
    requireToken: true,
    createRunner: () => fakeFactory(async () => ""),
  });
  const token = srv.token!;
  assert.ok(token, "Server must have generated a token when requireToken is true");

  try {
    // 1. CSP on / has script-src 'self' and NO 'unsafe-inline'
    const indexRes = await fetch(`${srv.url}/`);
    assert.equal(indexRes.status, 200);
    const csp = indexRes.headers.get("content-security-policy") || "";
    assert.ok(csp.includes("script-src 'self'"), "CSP must include script-src 'self'");
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), "CSP script-src must NOT include 'unsafe-inline'");
    const html = await indexRes.text();
    assert.ok(html.includes(`<meta name="company-token" content="${token}">`), "HTML must contain meta tag with token");
    assert.ok(!html.includes("window.__COMPANY_TOKEN__"), "HTML must NOT contain inline script setting window.__COMPANY_TOKEN__");

    // 2. SSE /events without token returns 401
    const unauthEvents = await fetch(`${srv.url}/events?workspace=${ws.id}`);
    assert.equal(unauthEvents.status, 401);

    // 3. SSE /events with token in query param returns 200
    const controller = new AbortController();
    const authEvents = await fetch(`${srv.url}/events?workspace=${ws.id}&token=${token}`, {
      signal: controller.signal,
    });
    assert.equal(authEvents.status, 200);
    assert.equal(authEvents.headers.get("content-type"), "text/event-stream");
    controller.abort();
  } finally {
    await srv.close();
    if (savedHome !== undefined) process.env.AGENT_COMPANY_HOME = savedHome; else delete process.env.AGENT_COMPANY_HOME;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("Item D: 8.3 short name and colon checks only apply below workspace and on win32", async () => {
  const base = freshDir("sec-reg-83-");
  // Simulate workspace path that has QUANGD~1 in its directory structure
  const wsWithShortName = join(base, "QUANGD~1", "my-project");
  mkdirSync(wsWithShortName, { recursive: true });
  writeFileSync(join(wsWithShortName, "app.ts"), "export const a = 1;");
  writeFileSync(join(wsWithShortName, "my-backup~1.txt"), "hello backup");

  try {
    const { assertSafeWorkspacePath, isSecretPath } = await import("../src/ide-fs.ts");
    const { checkToolCall } = await import("../src/guard.ts");
    const path = await import("node:path");

    // 1. Workspace path containing QUANGD~1 allows normal file access
    assert.doesNotThrow(() => {
      assertSafeWorkspacePath(wsWithShortName, "app.ts");
    });
    const r1 = checkToolCall("read", { path: "app.ts" }, wsWithShortName);
    assert.equal(r1.block, false);

    // 2. Filename with prefix > 6 chars (my-backup~1.txt) is not an 8.3 short name
    assert.doesNotThrow(() => {
      assertSafeWorkspacePath(wsWithShortName, "my-backup~1.txt");
    });
    const r2 = checkToolCall("read", { path: "my-backup~1.txt" }, wsWithShortName);
    assert.equal(r2.block, false);

    // 3. Lowercase 8.3 short names (compan~1/queue.json, git~1/config) MUST be blocked on win32
    if (process.platform === "win32") {
      assert.equal(isSecretPath("compan~1/queue.json"), true);
      assert.equal(isSecretPath("git~1/config"), true);

      assert.throws(() => {
        assertSafeWorkspacePath(wsWithShortName, "compan~1/queue.json");
      }, /8\.3 short names/i);
      assert.throws(() => {
        assertSafeWorkspacePath(wsWithShortName, "git~1/config");
      }, /8\.3 short names/i);
    }

    const rCompan = checkToolCall("read", { path: "compan~1/queue.json" }, wsWithShortName, path.win32);
    assert.equal(rCompan.block, true);
    const rGit = checkToolCall("read", { path: "git~1/config" }, wsWithShortName, path.win32);
    assert.equal(rGit.block, true);

    // 4. Uppercase 8.3 format (PROGRA~1, SECRE~1.TXT, ABCDEF~1) is blocked on win32
    if (process.platform === "win32") {
      assert.throws(() => {
        assertSafeWorkspacePath(wsWithShortName, "PROGRA~1");
      }, /8\.3 short names/i);
      assert.throws(() => {
        assertSafeWorkspacePath(wsWithShortName, "SECRE~1.TXT");
      }, /8\.3 short names/i);
      const r3 = checkToolCall("read", { path: "PROGRA~1" }, wsWithShortName);
      assert.equal(r3.block, true);
    }

    // 5. Colon check only on win32: POSIX allows colons in filename
    const posixWs = "/home/user/project";
    const rPosix = checkToolCall("read", { path: "file:name.txt" }, posixWs, path.posix);
    assert.equal(rPosix.block, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("Item E: getQueue drops non-objects, dequeue skips untrusted items, GET /tree returns { entries, truncated }", async () => {
  const dataDir = freshDir("sec-reg-itemE-data-");
  const wsDir = freshDir("sec-reg-itemE-ws-");

  const store = new WorkspaceStore(dataDir);
  const ws = store.add(wsDir, "Test WS Item E");

  try {
    // 1. getQueue drops non-objects (strings, null, numbers)
    const qFile = join(wsDir, ".company", "queue.json");
    mkdirSync(join(wsDir, ".company"), { recursive: true });
    writeFileSync(qFile, JSON.stringify([null, "hello", 123, { id: "bad", text: "no hmac", createdAt: new Date().toISOString() }]), "utf8");

    const items = store.getQueue(ws);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "bad");
    assert.equal(items[0].untrusted, true);

    // 2. dequeue skips untrusted item at the head and runs the next trusted item
    const enq = store.enqueue(ws, "trusted valid message");
    assert.equal(enq.position, 2); // 1 untrusted + 1 trusted

    const dequeued = store.dequeue(ws);
    assert.ok(dequeued);
    assert.equal(dequeued.id, enq.item.id);
    assert.equal(dequeued.text, "trusted valid message");

    // Queue still retains untrusted item (or dropped it without blocking)
    const remaining = store.getQueue(ws);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "bad");

    // 3. GET /tree returns { entries: TreeNode[], truncated: boolean }
    const { listWorkspaceTree } = await import("../src/ide-fs.ts");
    const resTree = await listWorkspaceTree(wsDir, ".");
    assert.ok(typeof resTree === "object");
    assert.ok(Array.isArray((resTree as any).entries));
    assert.equal(typeof (resTree as any).truncated, "boolean");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("Item F: role write/edit to nonexistent file through symlink/junction to .company or .git is blocked", async () => {
  const wsDir = freshDir("sec-reg-itemF-");
  const { checkToolCall } = await import("../src/guard.ts");
  const { symlinkSync } = await import("node:fs");

  try {
    mkdirSync(join(wsDir, ".company"), { recursive: true });
    mkdirSync(join(wsDir, ".git"), { recursive: true });
    writeFileSync(join(wsDir, ".git", "config"), "git config content");

    // Create symlink/junction: cl -> .company, gl -> .git
    try {
      symlinkSync(join(wsDir, ".company"), join(wsDir, "cl"), "junction");
      symlinkSync(join(wsDir, ".git"), join(wsDir, "gl"), "junction");
    } catch {
      // Fallback for non-windows or unprivileged
      symlinkSync(join(wsDir, ".company"), join(wsDir, "cl"), "dir");
      symlinkSync(join(wsDir, ".git"), join(wsDir, "gl"), "dir");
    }

    // 1. Role reading .git/config must be blocked
    const rReadGit = checkToolCall("read", { path: ".git/config" }, wsDir);
    assert.equal(rReadGit.block, true, "Reading .git/config must be blocked");

    // 2. Role writing to a NON-EXISTENT file via junction to .company must be blocked
    const rWriteCl = checkToolCall("write", { path: "cl/new2.txt", content: "evil" }, wsDir);
    assert.equal(rWriteCl.block, true, "Writing through cl junction into .company must be blocked");

    // 3. Role writing to a NON-EXISTENT file via junction to .git must be blocked
    const rWriteGl = checkToolCall("write", { path: "gl/hooks/evil.sh", content: "evil" }, wsDir);
    assert.equal(rWriteGl.block, true, "Writing through gl junction into .git must be blocked");

    // 4. Role editing a NON-EXISTENT file via junction to .company must be blocked
    const rEditCl = checkToolCall("edit", { path: "cl/new2.txt" }, wsDir);
    assert.equal(rEditCl.block, true, "Editing through cl junction into .company must be blocked");
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});



