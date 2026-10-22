import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { assertSafeWorkspacePath, listWorkspaceTree, readWorkspaceFile, HttpError } from "../src/ide-fs.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("assertSafeWorkspacePath cho phép path hợp lệ trong workspace", () => {
  const wsDir = createTempDir("ws-safe-");
  try {
    fs.writeFileSync(path.join(wsDir, "app.js"), "console.log(1);");
    fs.mkdirSync(path.join(wsDir, "src"));
    fs.writeFileSync(path.join(wsDir, "src", "index.ts"), "export {}");

    const p1 = assertSafeWorkspacePath(wsDir, "app.js");
    assert.equal(p1, path.resolve(wsDir, "app.js"));

    const p2 = assertSafeWorkspacePath(wsDir, "src/index.ts");
    assert.equal(p2, path.resolve(wsDir, "src/index.ts"));

    const p3 = assertSafeWorkspacePath(wsDir, ".");
    assert.equal(p3, path.resolve(wsDir));
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("assertSafeWorkspacePath ném lỗi 403 khi path traversal vượt ra ngoài (../)", () => {
  const wsDir = createTempDir("ws-trav-");
  try {
    assert.throws(() => {
      assertSafeWorkspacePath(wsDir, "../secret.txt");
    }, (err: any) => err instanceof HttpError && err.status === 403);

    assert.throws(() => {
      assertSafeWorkspacePath(wsDir, "src/../../outside.txt");
    }, (err: any) => err instanceof HttpError && err.status === 403);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("assertSafeWorkspacePath ném lỗi 403 khi symlink trỏ ra ngoài workspace root (ngay cả khi target file chưa tồn tại)", () => {
  const wsDir = createTempDir("ws-sym-");
  const outsideDir = createTempDir("ws-outside-");
  try {
    const linkPath = path.join(wsDir, "ext-link");
    try {
      fs.symlinkSync(outsideDir, linkPath, "junction");
    } catch {
      // If symlink creation fails on some windows env without elevation, skip
      return;
    }

    assert.throws(() => {
      assertSafeWorkspacePath(wsDir, "ext-link/nonexistent.txt");
    }, (err: any) => err instanceof HttpError && err.status === 403);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("assertSafeWorkspacePath ném lỗi 403 khi truy cập file bí mật (.env, .company, id_rsa, .git, .ssh)", () => {
  const wsDir = createTempDir("ws-sec-");
  try {
    fs.writeFileSync(path.join(wsDir, ".env"), "SECRET=1");
    fs.writeFileSync(path.join(wsDir, "id_rsa"), "KEY");
    fs.mkdirSync(path.join(wsDir, ".ssh"));
    fs.mkdirSync(path.join(wsDir, ".company"));
    fs.mkdirSync(path.join(wsDir, ".git"));

    assert.throws(() => assertSafeWorkspacePath(wsDir, ".env"), (e: any) => e.status === 403);
    assert.throws(() => assertSafeWorkspacePath(wsDir, "id_rsa"), (e: any) => e.status === 403);
    assert.throws(() => assertSafeWorkspacePath(wsDir, ".ssh/id_ed25519"), (e: any) => e.status === 403);
    assert.throws(() => assertSafeWorkspacePath(wsDir, ".company/config.json"), (e: any) => e.status === 403);
    assert.throws(() => assertSafeWorkspacePath(wsDir, ".git/HEAD"), (e: any) => e.status === 403);

    // .env.example should NOT be blocked
    fs.writeFileSync(path.join(wsDir, ".env.example"), "FOO=");
    assert.doesNotThrow(() => assertSafeWorkspacePath(wsDir, ".env.example"));
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("listWorkspaceTree trả về đúng danh sách depth=1 và lọc bỏ .git, node_modules, .company", async () => {
  const wsDir = createTempDir("ws-tree-");
  try {
    fs.mkdirSync(path.join(wsDir, "src"));
    fs.mkdirSync(path.join(wsDir, ".git"));
    fs.mkdirSync(path.join(wsDir, "node_modules"));
    fs.mkdirSync(path.join(wsDir, ".company"));
    fs.writeFileSync(path.join(wsDir, "README.md"), "# Hello");
    fs.writeFileSync(path.join(wsDir, ".env"), "KEY=VAL");

    const nodes = await listWorkspaceTree(wsDir, ".", 1);
    const names = nodes.map(n => n.name);

    assert.ok(names.includes("src"));
    assert.ok(names.includes("README.md"));
    assert.ok(names.includes(".env"));
    assert.ok(!names.includes(".git"));
    assert.ok(!names.includes("node_modules"));
    assert.ok(!names.includes(".company"));

    const envNode = nodes.find(n => n.name === ".env");
    assert.equal(envNode?.isSecret, true);

    const srcNode = nodes.find(n => n.name === "src");
    assert.equal(srcNode?.type, "directory");
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("readWorkspaceFile đọc file text thành công kèm hash sha256 và mtime", async () => {
  const wsDir = createTempDir("ws-read-");
  try {
    fs.writeFileSync(path.join(wsDir, "hello.txt"), "hello world");
    const res = await readWorkspaceFile(wsDir, "hello.txt");

    assert.equal(res.path, "hello.txt");
    assert.equal(res.content, "hello world");
    assert.equal(res.isBinary, false);
    assert.equal(res.size, 11);
    assert.ok(res.sha256);
    assert.ok(res.mtime);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("readWorkspaceFile phát hiện file nhị phân qua null-byte", async () => {
  const wsDir = createTempDir("ws-bin-");
  try {
    const binData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    fs.writeFileSync(path.join(wsDir, "image.png"), binData);

    const res = await readWorkspaceFile(wsDir, "image.png");
    assert.equal(res.isBinary, true);
    assert.equal(res.content, "");
    assert.equal(res.size, 7);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("readWorkspaceFile ném lỗi 413 khi kích thước file > 2MB", async () => {
  const wsDir = createTempDir("ws-large-");
  try {
    const bigFile = path.join(wsDir, "big.txt");
    const fd = fs.openSync(bigFile, "w");
    fs.writeSync(fd, "a");
    // truncate to 2MB + 10 bytes
    fs.ftruncateSync(fd, 2 * 1024 * 1024 + 10);
    fs.closeSync(fd);

    await assert.rejects(async () => {
      await readWorkspaceFile(wsDir, "big.txt");
    }, (err: any) => err instanceof HttpError && err.status === 413);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
