import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_DIR, PACKAGE_ROOT } from "../src/config.ts";

const index = () => JSON.parse(readFileSync(join(CATALOG_DIR, "index.json"), "utf8"));

test("catalog index matches the files on disk", () => {
  // --check exits non-zero when index.json is stale or a file hash differs
  execFileSync(process.execPath, [join(PACKAGE_ROOT, "scripts", "build-catalog.mjs"), "--check"], { stdio: "pipe" });
});

test("catalog lists the 10 store roles and none of the base roles", () => {
  const ids = index().roles.map((r: any) => r.id).sort();
  assert.equal(ids.length, 10);
  for (const base of ["manager", "researcher", "developer", "critic"]) assert.ok(!ids.includes(base), base);
  for (const r of index().roles) assert.ok(r.owns && r.files.length, r.id);
});

test("every catalog skill names its source and license", () => {
  for (const s of index().skills) {
    assert.ok(s.source, s.name);
    assert.match(s.license, /^(MIT|Apache-2\.0)$/, s.name);
    for (const f of s.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
});

test("every catalog and library file is committed (users download the catalog from GitHub)", t => {
  let tracked: Set<string>;
  try {
    tracked = new Set(execFileSync("git", ["ls-files", "catalog", "library"], { cwd: PACKAGE_ROOT, encoding: "utf8" }).split("\n").filter(Boolean));
  } catch { return t.skip("not a git checkout"); }
  const listed = [...index().roles.flatMap((r: any) => r.files), ...index().skills.flatMap((s: any) => s.files)].map((f: any) => `catalog/${f.path}`);
  const missing = [...new Set(listed)].filter(p => !tracked.has(p));
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} catalog files are not in git (check .gitignore)`);
  const ignored = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "library", "catalog"], { cwd: PACKAGE_ROOT, encoding: "utf8" }).trim();
  assert.equal(ignored, "", "files under library/ or catalog/ are git-ignored");
});
