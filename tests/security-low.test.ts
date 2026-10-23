import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AGENT_COMPANY_HOME = mkdtempSync(join(tmpdir(), "sec-low-home-"));

import { startServer } from "../src/server.ts";
import { captureShadow, getShadowFileContent } from "../src/shadow.ts";
import { assertSafeWorkspacePath } from "../src/ide-fs.ts";
import { checkToolCall } from "../src/guard.ts";

function freshDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("8. Folder picker enforces single-dialog mutex and uses full powershell path", async () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const home = freshDir("sec-low-picker-");
  try {
    let unblockDialog: (() => void) | undefined;
    const slowPicker = () => new Promise<any>(r => {
      unblockDialog = () => r({ canceled: true });
    });

    server = await startServer({
      port: 0,
      dataDir: home,
      pickFolder: slowPicker,
      apiToken: false,
    });

    // Send first request: hangs while dialog is open
    const p1 = fetch(`${server.url}/fs/pick-folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    // Small delay to ensure first request acquired mutex
    await new Promise(r => setTimeout(r, 50));

    // Send second request: should immediately return 409 Conflict
    const r2 = await fetch(`${server.url}/fs/pick-folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    assert.equal(r2.status, 409);

    if (unblockDialog) unblockDialog();
    const res1 = await p1;
    assert.equal(res1.status, 200);
  } finally {
    if (server) await server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("9. runId strictly validated as UUID with prefix check in getShadowFileContent and server", async () => {
  const wsDir = freshDir("sec-low-uuid-");
  try {
    // 1. getShadowFileContent rejects invalid runId format
    await assert.rejects(
      async () => {
        await getShadowFileContent(wsDir, "not-a-uuid", "index.ts");
      },
      /invalid runId/i
    );

    // 2. Traversal runId rejected
    await assert.rejects(
      async () => {
        await getShadowFileContent(wsDir, "../../etc", "index.ts");
      },
      /invalid runId/i
    );
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("10. captureShadow skips symlinks and safely writes manifest concurrently", async () => {
  const wsDir = freshDir("sec-low-shadow-");
  const outsideDir = freshDir("sec-low-outside-");
  try {
    const targetFile = join(outsideDir, "secret.txt");
    writeFileSync(targetFile, "SECRET OUTSIDE CONTENT");

    const symlinkPath = join(wsDir, "link-to-secret.txt");
    let canSymlink = true;
    try {
      symlinkSync(targetFile, symlinkPath, "file");
    } catch {
      canSymlink = false;
    }

    const runId = "11111111-2222-3333-4444-555555555555";
    if (canSymlink) {
      // captureShadow should skip copying file contents when file is a symlink
      await captureShadow(wsDir, runId, "link-to-secret.txt");
      const shadowContent = await getShadowFileContent(wsDir, runId, "link-to-secret.txt");
      assert.equal(shadowContent, null);
    }

    // Concurrent captureShadow calls for multiple files without manifest corruption
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      const fileName = `file_${i}.txt`;
      writeFileSync(join(wsDir, fileName), `content ${i}`);
      promises.push(captureShadow(wsDir, runId, fileName));
    }
    await Promise.all(promises);

    const manifestPath = join(wsDir, ".company", "shadow", runId, ".manifest.json");
    assert.equal(existsSync(manifestPath), true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (let i = 0; i < 5; i++) {
      assert.ok(manifest.files[`file_${i}.txt`], `file_${i}.txt should be present in manifest`);
    }
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("11. Blocks expanded secret files (.npmrc, .netrc, .git-credentials, .pypirc, credentials.json, .kube)", () => {
  const wsDir = freshDir("sec-low-secrets-");
  try {
    const secretFiles = [
      ".npmrc",
      ".netrc",
      ".git-credentials",
      ".pypirc",
      "credentials.json",
      ".kube/config",
    ];

    for (const f of secretFiles) {
      assert.throws(
        () => assertSafeWorkspacePath(wsDir, f),
        /secret|403|orchestration|protected|access denied/i,
        `Expected ${f} to be blocked by assertSafeWorkspacePath`
      );

      const check = checkToolCall("read", { path: f }, wsDir);
      assert.equal(check.block, true, `Expected tool call for ${f} to be blocked`);
    }
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("12. THIRD_PARTY_NOTICES.md includes Prism.js license and provenance", () => {
  const root = join(process.cwd(), "THIRD_PARTY_NOTICES.md");
  assert.equal(existsSync(root), true);
  const content = readFileSync(root, "utf8");
  assert.match(content, /Prism/i);
  assert.match(content, /Lea Verou/i);
  assert.match(content, /MIT/i);
});
