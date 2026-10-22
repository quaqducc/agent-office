import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { assertSafeWorkspacePath, listWorkspaceTree, readWorkspaceFile, saveWorkspaceFile, createWorkspaceFile, HttpError } from "../src/ide-fs.ts";

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

test("saveWorkspaceFile ghi file atomic thành công và trả về sha256 mới", async () => {
  const wsDir = createTempDir("ws-save-");
  try {
    const file = path.join(wsDir, "test.txt");
    fs.writeFileSync(file, "hello initial\n", "utf-8");

    const initial = await readWorkspaceFile(wsDir, "test.txt");
    const res = await saveWorkspaceFile(wsDir, "test.txt", "hello updated\n", {
      expectedSha256: initial.sha256,
    });

    assert.equal(res.path, "test.txt");
    assert.notEqual(res.sha256, initial.sha256);
    assert.equal(fs.readFileSync(file, "utf-8"), "hello updated\n");
    // Ensure no leftover temp files
    const allFiles = fs.readdirSync(wsDir);
    assert.equal(allFiles.length, 1);
    assert.equal(allFiles[0], "test.txt");
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("saveWorkspaceFile ném lỗi 409 Conflict khi expectedSha256 không khớp với đĩa", async () => {
  const wsDir = createTempDir("ws-conflict-");
  try {
    const file = path.join(wsDir, "file.txt");
    fs.writeFileSync(file, "content on disk", "utf-8");

    await assert.rejects(async () => {
      await saveWorkspaceFile(wsDir, "file.txt", "my new content", {
        expectedSha256: "wrong-sha256-hash",
      });
    }, (err: any) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 409);
      assert.equal(err.extra?.diskContent, "content on disk");
      assert.ok(err.extra?.diskSha256);
      assert.ok(err.extra?.diskMtime);
      return true;
    });

    // Content on disk remains untouched
    assert.equal(fs.readFileSync(file, "utf-8"), "content on disk");
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("saveWorkspaceFile cho phép ghi đè khi có cờ force: true kể cả khi hash lệch", async () => {
  const wsDir = createTempDir("ws-force-");
  try {
    const file = path.join(wsDir, "file.txt");
    fs.writeFileSync(file, "content on disk", "utf-8");

    const res = await saveWorkspaceFile(wsDir, "file.txt", "forced content", {
      expectedSha256: "wrong-sha256-hash",
      force: true,
    });

    assert.equal(fs.readFileSync(file, "utf-8"), "forced content");
    assert.equal(res.path, "file.txt");
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("saveWorkspaceFile giữ nguyên định dạng xuống dòng CRLF (\\r\\n) của file gốc", async () => {
  const wsDir = createTempDir("ws-crlf-");
  try {
    const file = path.join(wsDir, "windows.txt");
    fs.writeFileSync(file, "line1\r\nline2\r\n", "utf-8");

    const initial = await readWorkspaceFile(wsDir, "windows.txt");
    // Client sends LF
    await saveWorkspaceFile(wsDir, "windows.txt", "line1\nline2\nline3\n", {
      expectedSha256: initial.sha256,
    });

    const savedBuffer = fs.readFileSync(file);
    const savedText = savedBuffer.toString("utf-8");
    assert.equal(savedText, "line1\r\nline2\r\nline3\r\n");
    assert.ok(!savedText.includes("\r\r\n"));
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("createWorkspaceFile tạo file mới trong thư mục con tự động tạo parent folder", async () => {
  const wsDir = createTempDir("ws-create-");
  try {
    const res = await createWorkspaceFile(wsDir, "src/components/Button.tsx", "export const Button = () => null;");
    assert.equal(res.path, "src/components/Button.tsx");
    assert.equal(fs.readFileSync(path.join(wsDir, "src/components/Button.tsx"), "utf-8"), "export const Button = () => null;");

    // Thử tạo lại file đã tồn tại -> 409
    await assert.rejects(async () => {
      await createWorkspaceFile(wsDir, "src/components/Button.tsx", "new");
    }, (err: any) => err instanceof HttpError && err.status === 409);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test("createWorkspaceFile ném lỗi 403 khi path traversal (../) hoặc file bí mật (.env)", async () => {
  const wsDir = createTempDir("ws-create-sec-");
  try {
    await assert.rejects(async () => {
      await createWorkspaceFile(wsDir, "../outside.txt", "evil");
    }, (err: any) => err instanceof HttpError && err.status === 403);

    await assert.rejects(async () => {
      await createWorkspaceFile(wsDir, ".env", "EVIL=1");
    }, (err: any) => err instanceof HttpError && err.status === 403);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
