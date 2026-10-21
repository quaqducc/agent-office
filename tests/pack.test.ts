import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../src/config.ts";
import { forbidden } from "../scripts/pack-check.mjs";

test("forbidden() flags secrets, local data and author paths", () => {
  assert.deepEqual(forbidden("dist/main.js", "export {}"), []);
  assert.ok(forbidden(".env", "").length);
  assert.ok(forbidden("pi/models.json", "").length);
  assert.ok(forbidden("data/workspaces.json", "").length);
  assert.ok(forbidden("x/.company/runs/a.jsonl", "").length);
  assert.ok(forbidden("catalog/roles/planner.md", "").length, "catalog files are downloaded, not packed");
  assert.deepEqual(forbidden("catalog/index.json", "{}"), [], "the index ships as the trusted checksum list");
  assert.ok(forbidden("tests/a.test.ts", "").length);
  assert.ok(forbidden("dist/config.js", 'const r = "D:/tools/pi-runtime"').length);
  assert.ok(forbidden("README.md", "key sk-abcdef1234567890").length);
});

test("pack contents are clean", () => {
  // scripts/pack-check.mjs runs `npm pack --dry-run --json --ignore-scripts` and exits 1 on any problem
  execFileSync(process.execPath, [join(PACKAGE_ROOT, "scripts", "pack-check.mjs")], { cwd: PACKAGE_ROOT, stdio: "pipe" });
});
