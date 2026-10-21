#!/usr/bin/env node
// Verify the npm tarball contents: no secrets, local data, author paths, tests or catalog.
// Usage: node scripts/pack-check.mjs   (exits 1 and lists problems if anything is wrong)
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BAD_PATHS = [
  [/(^|\/)\.env(\.(?!example$|sample$)[\w.-]+)?$/, "environment file"],
  [/(^|\/)(models|auth)\.json$/, "model/credential file"],
  [/^data\//, "local data"],
  [/(^|\/)\.company\//, "workspace run data"],
  [/^catalog\/(?!index\.json$)/, "catalog files (downloaded from GitHub on install; only index.json is packed)"],
  [/^tests\//, "tests"],
  [/^\.superpowers\//, "planning scratch"],
  [/(^|\/)company(-cli)?\.cmd$/, "author-local launcher"],
];
const BAD_CONTENT = [
  [/D:[\\/]+tools/i, "author-local path D:/tools"],
  [/\bsk-[A-Za-z0-9_-]{12,}/, "something that looks like an API key"],
  [/AIza[0-9A-Za-z_-]{20,}/, "something that looks like a Google API key"],
  [/\b(ghp|gho|github_pat|npm)_[A-Za-z0-9_]{20,}/, "something that looks like a GitHub/npm token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "something that looks like an AWS key"],
  [/[A-Za-z]:[\\/]+Users[\\/]+Hi\b/i, "the author's home folder"],
];

/** Problems for one packed file (path relative to the package root). */
export function forbidden(path, content) {
  const out = [];
  for (const [re, why] of BAD_PATHS) if (re.test(path)) out.push(`${path}: ${why}`);
  for (const [re, why] of BAD_CONTENT) if (re.test(content)) out.push(`${path}: contains ${why}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/").replace(/^(?=[A-Za-z]:)/, "/")}` || process.argv[1]?.endsWith("pack-check.mjs")) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const json = execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
  const files = JSON.parse(json)[0].files.map(f => f.path.replace(/\\/g, "/"));
  const problems = files.flatMap(p => {
    const full = join(root, p);
    const text = statSync(full).size < 2_000_000 ? readFileSync(full, "utf8") : "";
    return forbidden(p, text);
  });
  if (problems.length) {
    console.error(`pack-check: ${problems.length} problem(s)\n` + problems.join("\n"));
    process.exit(1);
  }
  console.log(`pack-check ok: ${files.length} files`);
}
