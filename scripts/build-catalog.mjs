#!/usr/bin/env node
// Build catalog/index.json (role store index): every role, persona and skill file with sha256.
// Usage: node scripts/build-catalog.mjs [--check]   (--check: fail if index.json is stale)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../library/lib/roles.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "catalog");
const LICENSES = {
  superpowers: "MIT", ecc: "MIT", "agent-skills": "MIT", "pm-skills": "MIT", marketingskills: "MIT",
  "anthropic-skills": "Apache-2.0", "ui-ux-pro-max": "MIT", "wshobson-agents": "MIT", "agency-agents": "MIT",
};

const rel = p => relative(CATALOG, p).split("\\").join("/");
const fileEntry = p => {
  const buf = readFileSync(p);
  return { path: rel(p), sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
};
function walk(dir) {
  return readdirSync(dir).sort().flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const problems = [];
const skills = readdirSync(join(CATALOG, "skills")).sort().map(name => {
  const dir = join(CATALOG, "skills", name);
  const source = existsSync(join(dir, ".source")) ? readFileSync(join(dir, ".source"), "utf8").trim() : "";
  if (!LICENSES[source]) problems.push(`skill ${name}: unknown source "${source}" (add a .source file)`);
  return { name, source, license: LICENSES[source] ?? "UNKNOWN", files: walk(dir).map(fileEntry) };
});

const roles = readdirSync(join(CATALOG, "roles")).filter(f => f.endsWith(".md") && !f.startsWith("_")).sort().map(f => {
  const file = join(CATALOG, "roles", f);
  const { meta } = parse(file);
  const files = [fileEntry(file)];
  if (meta.persona) {
    const persona = join(CATALOG, meta.persona);
    if (!existsSync(persona)) problems.push(`role ${f}: persona missing ${meta.persona}`);
    else files.push(fileEntry(persona));
  }
  if (!meta.owns) problems.push(`role ${f}: no owns line`);
  const skillsOf = (meta.skills ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return { id: f.slice(0, -3), name: meta.name, description: meta.description, owns: meta.owns, skills: skillsOf, files };
});

const index = JSON.stringify({ format: 1, roles, skills }, null, 2) + "\n";
const target = join(CATALOG, "index.json");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== index) {
    console.error("catalog/index.json is stale — run: node scripts/build-catalog.mjs");
    process.exit(1);
  }
  console.log(`catalog ok: ${roles.length} roles, ${skills.length} skills`);
} else {
  writeFileSync(target, index);
  console.log(`wrote catalog/index.json: ${roles.length} roles, ${skills.length} skills`);
}
