import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AGENT_COMPANY_HOME = mkdtempSync(join(tmpdir(), "sec-med-home-"));

import { WorkspaceStore } from "../src/workspace.ts";
import { checkToolCall } from "../src/guard.ts";
import { startServer } from "../src/server.ts";
import { saveWorkspaceFile, listWorkspaceTree } from "../src/ide-fs.ts";
import { myersDiff } from "../src/diff.ts";
import { fakeFactory } from "./helpers/fake-runner.ts";

function freshDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("2.1 queueFile as symlink is rejected and never overwritten", () => {
  const home = freshDir("sec-med-home-");
  const wsDir = freshDir("sec-med-ws-");
  const victimDir = freshDir("sec-med-victim-");
  try {
    const store = new WorkspaceStore(home);
    const ws = store.add(wsDir, "Test WS");
    const targetFile = join(victimDir, "target.txt");
    writeFileSync(targetFile, "ORIGINAL VICTIM CONTENT");

    const qPath = join(wsDir, ".company", "queue.json");
    let canSymlink = true;
    try {
      symlinkSync(victimDir, qPath, process.platform === "win32" ? "junction" : "dir");
    } catch {
      canSymlink = false;
    }

    assert.equal(canSymlink, true, "Junction/symlink should be created for testing");
    assert.throws(() => store.enqueue(ws, "malicious message"), /symlink/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
    rmSync(victimDir, { recursive: true, force: true });
  }
});

test("2.2 API token auth requires token and blocks local SSRF in shell", async () => {
  const home = freshDir("sec-med-server-");
  const wsDir = freshDir("sec-med-ws2-");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const store = new WorkspaceStore(home);
    const ws = store.add(wsDir, "WS 1");

    server = await startServer({
      port: 0,
      dataDir: home,
      apiToken: "test-secret-token",
      createRunner: () => fakeFactory(async () => "ok"),
    });

    // 1. Without token: returns 401
    const resNoToken = await fetch(`${server.url}/workspaces/${ws.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    assert.equal(resNoToken.status, 401);

    // 2. With invalid token: returns 401
    const resBadToken = await fetch(`${server.url}/workspaces/${ws.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-company-token": "wrong-token",
      },
      body: JSON.stringify({ text: "Hello" }),
    });
    assert.equal(resBadToken.status, 401);

    // 3. With valid token: returns 200
    const resValid = await fetch(`${server.url}/workspaces/${ws.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-company-token": "test-secret-token",
      },
      body: JSON.stringify({ text: "Hello" }),
    });
    assert.equal(resValid.status, 200);

    // 4. Shell SSRF guard blocks local loopback targeting app
    const r1 = checkToolCall("bash", { command: `curl http://127.0.0.1:4000/workspaces` }, wsDir);
    assert.equal(r1.block, true);

    const r2 = checkToolCall("bash", { command: `wget http://localhost:4000/workspaces` }, wsDir);
    assert.equal(r2.block, true);

    const r3 = checkToolCall("bash", { command: `curl -s http://[::1]:4000/` }, wsDir);
    assert.equal(r3.block, true);
  } finally {
    if (server) await server.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("2.3 DoS limits on /diff, listWorkspaceTree, and Myers diff", async () => {
  const wsDir = freshDir("sec-med-dos-");
  try {
    // 1. Myers diff stops when edit distance exceeds 2000
    const oldLines = Array.from({ length: 2500 }, (_, i) => `old line ${i}`).join("\n");
    const newLines = Array.from({ length: 2500 }, (_, i) => `new line ${i}`).join("\n");
    const diffRes = myersDiff("test.txt", oldLines, newLines);
    assert.equal(diffRes.truncated, true);

    // 2. listWorkspaceTree caps at 5000 items
    const manyDir = join(wsDir, "many");
    mkdirSync(manyDir, { recursive: true });
    for (let i = 0; i < 5005; i++) {
      writeFileSync(join(manyDir, `f_${i}.txt`), "x");
    }
    const tree = await listWorkspaceTree(wsDir, "many");
    assert.equal(tree.entries.length, 5000);
    assert.equal(tree.truncated, true);
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("2.4 PUT /files safety: requires expectedSha256 and preserves file mode", async () => {
  const wsDir = freshDir("sec-med-put-");
  try {
    const filePath = join(wsDir, "hello.txt");
    writeFileSync(filePath, "original content\n", "utf8");

    // 1. Without expectedSha256 and without force: throws 400
    await assert.rejects(
      async () => {
        await saveWorkspaceFile(wsDir, "hello.txt", "new content\n", {});
      },
      /expectedSha256/i
    );

    // 2. With expectedSha256: succeeds and preserves mode
    const { createHash } = await import("node:crypto");
    const originalSha = createHash("sha256").update("original content\n").digest("hex");

    const res = await saveWorkspaceFile(wsDir, "hello.txt", "new content\n", {
      expectedSha256: originalSha,
    });
    assert.ok(res.sha256);

    const afterStat = statSync(filePath);
    assert.ok(afterStat.mode);
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});
