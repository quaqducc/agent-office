import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  captureShadow,
  getRunChanges,
  getShadowFileContent,
  enforceShadowQuota,
  manifestFilePath,
  shadowRunDir,
} from "../src/shadow.ts";

async function makeTempWorkspace(): Promise<string> {
  const p = join(tmpdir(), `shadow-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(p, { recursive: true });
  return p;
}

test("captureShadow ghi nhận trạng thái 'A' khi file chưa tồn tại trên đĩa", async () => {
  const ws = await makeTempWorkspace();
  const runId = "run-1";

  await captureShadow(ws, runId, "src/new-file.ts");

  const changes = await getRunChanges(ws, runId);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "src/new-file.ts");
  assert.equal(changes[0].status, "A");

  const shadowContent = await getShadowFileContent(ws, runId, "src/new-file.ts");
  assert.equal(shadowContent, null);

  await fs.rm(ws, { recursive: true, force: true });
});

test("captureShadow sao chép file gốc và ghi nhận 'M' khi file đã tồn tại", async () => {
  const ws = await makeTempWorkspace();
  const runId = "run-2";

  await fs.mkdir(join(ws, "src"), { recursive: true });
  await fs.writeFile(join(ws, "src", "app.ts"), "const original = 1;", "utf-8");

  await captureShadow(ws, runId, "src/app.ts");

  const changes = await getRunChanges(ws, runId);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "src/app.ts");
  assert.equal(changes[0].status, "M");

  const shadowContent = await getShadowFileContent(ws, runId, "src/app.ts");
  assert.equal(shadowContent, "const original = 1;");

  await fs.rm(ws, { recursive: true, force: true });
});

test("captureShadow không ghi đè lại file đã được sao chép trong cùng một runId", async () => {
  const ws = await makeTempWorkspace();
  const runId = "run-3";

  await fs.writeFile(join(ws, "index.js"), "version 1", "utf-8");

  // First tool_call (e.g. write)
  await captureShadow(ws, runId, "index.js");

  // File is modified by tool
  await fs.writeFile(join(ws, "index.js"), "version 2 (modified)", "utf-8");

  // Second tool_call (e.g. edit) in the SAME run
  await captureShadow(ws, runId, "index.js");

  const shadowContent = await getShadowFileContent(ws, runId, "index.js");
  // Must preserve version 1!
  assert.equal(shadowContent, "version 1");

  await fs.rm(ws, { recursive: true, force: true });
});

test("captureShadow bỏ qua file vượt quá 256KB nhưng vẫn ghi nhận metadata", async () => {
  const ws = await makeTempWorkspace();
  const runId = "run-4";

  // Create 300KB file
  const bigContent = "A".repeat(300 * 1024);
  await fs.writeFile(join(ws, "huge.txt"), bigContent, "utf-8");

  await captureShadow(ws, runId, "huge.txt");

  const changes = await getRunChanges(ws, runId);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "huge.txt");
  assert.equal(changes[0].status, "M");

  // File was >256KB, so no shadow copy created on disk
  const shadowContent = await getShadowFileContent(ws, runId, "huge.txt");
  assert.equal(shadowContent, null);

  await fs.rm(ws, { recursive: true, force: true });
});

test("enforceShadowQuota xoá run cũ nhất khi tổng dung lượng thư mục shadow vượt hạn mức", async () => {
  const ws = await makeTempWorkspace();

  // Create two runs with files
  const run1 = "run-old";
  const run2 = "run-new";

  await fs.mkdir(shadowRunDir(ws, run1), { recursive: true });
  await fs.writeFile(join(shadowRunDir(ws, run1), "file1.txt"), "A".repeat(1000), "utf-8");

  // Wait a small bit so mtime differs
  await new Promise((r) => setTimeout(r, 50));

  await fs.mkdir(shadowRunDir(ws, run2), { recursive: true });
  await fs.writeFile(join(shadowRunDir(ws, run2), "file2.txt"), "B".repeat(1000), "utf-8");

  // Enforce quota of 1500 bytes (total is >2000 bytes)
  await enforceShadowQuota(ws, 1500);

  // run-old must be removed, run-new kept
  const r1Content = await getShadowFileContent(ws, run1, "file1.txt");
  const r2Content = await getShadowFileContent(ws, run2, "file2.txt");

  assert.equal(r1Content, null);
  assert.equal(r2Content, "B".repeat(1000));

  await fs.rm(ws, { recursive: true, force: true });
});

test("captureShadow không bao giờ ném lỗi ra ngoài khi gặp lỗi I/O bất thường", async () => {
  // Pass invalid/inaccessible directory
  await assert.doesNotReject(async () => {
    await captureShadow("/invalid/non/existent/path/here", "run-x", "foo.txt");
  });
});
