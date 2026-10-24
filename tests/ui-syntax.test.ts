import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

function getAllJsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...getAllJsFiles(fullPath));
    } else if (entry.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

test("ui js files have valid javascript syntax (node --check)", () => {
  const uiDir = resolve(process.cwd(), "ui");
  const jsFiles = getAllJsFiles(uiDir);
  assert.ok(jsFiles.length > 0, "found js files in ui/");

  const failures: { file: string; error: string }[] = [];
  for (const file of jsFiles) {
    const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (res.status !== 0) {
      failures.push({ file, error: res.stderr.trim() });
    }
  }

  if (failures.length > 0) {
    const msg = failures.map(f => `${f.file}:\n${f.error}`).join("\n\n");
    assert.fail(`Syntax errors detected in UI files:\n\n${msg}`);
  }
});

test("ui static imports resolve to existing files on disk", () => {
  const uiDir = resolve(process.cwd(), "ui");
  const jsFiles = getAllJsFiles(uiDir);
  const importRegex = /(?:import\s+(?:(?:(?:\{[\s\S]*?\}|[\w$]+)(?:\s*,\s*(?:\{[\s\S]*?\}|[\w$]+))?|\*\s+as\s+[\w$]+)\s+from\s+)?|import\s+)["']([^"']+)["']/g;

  const missing: { file: string; specifier: string; resolved: string }[] = [];

  for (const file of jsFiles) {
    const content = readFileSync(file, "utf8");
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        const resolved = resolve(dirname(file), specifier);
        if (!existsSync(resolved)) {
          missing.push({ file, specifier, resolved });
        }
      }
    }
  }

  assert.deepEqual(missing, [], "all relative imports must resolve to existing files");
});
