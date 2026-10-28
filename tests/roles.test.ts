import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_DIR, PACKAGE_LIBRARY } from "../src/config.ts";
import { assemblePrompt, libraryRoots, loadRole, roleIds, roleProblems } from "../src/library.ts";

const BASE = ["critic", "developer", "explainer", "manager", "researcher"];

/** Run with a temporary app home so the user's real store installs don't leak into tests. */
function withHome<T>(fn: (home: string) => T): T {
  const saved = process.env.AGENT_COMPANY_HOME;
  const home = mkdtempSync(join(tmpdir(), "roles-home-"));
  mkdirSync(join(home, "library", "roles"), { recursive: true });
  mkdirSync(join(home, "library", "skills"), { recursive: true });
  process.env.AGENT_COMPANY_HOME = home;
  try { return fn(home); } finally {
    if (saved === undefined) delete process.env.AGENT_COMPANY_HOME; else process.env.AGENT_COMPANY_HOME = saved;
  }
}

test("package library has exactly the 5 base roles, with no problems", () => withHome(() => {
  assert.deepEqual(roleIds().sort(), BASE);
  for (const id of BASE) assert.deepEqual(roleProblems(loadRole(id)), [], id);
}));

test("every role file (library + catalog) has owns", () => {
  for (const dir of [join(PACKAGE_LIBRARY, "roles"), join(CATALOG_DIR, "roles")]) {
    for (const f of readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith("_"))) {
      assert.match(readFileSync(join(dir, f), "utf8"), /^owns: .{8,}$/m, f);
    }
  }
});

test("base files come from the package, overrides from home", () => withHome(home => {
  writeFileSync(join(home, "library", "roles", "critic.md"),
    "---\nname: Critic (custom)\ndescription: custom critic\nowns: Custom challenges\ntools: read\nskills:\n---\nCUSTOM CRITIC BODY\n");
  writeFileSync(join(home, "library", "roles", "_team.md"), "HOME TEAM RULES SHOULD BE IGNORED");
  assert.equal(libraryRoots()[0], join(home, "library"));
  assert.equal(loadRole("critic").meta.name, "Critic (custom)");
  const p = assemblePrompt("critic", "orchestrator");
  assert.ok(p.includes("CUSTOM CRITIC BODY"));
  assert.ok(!p.includes("HOME TEAM RULES"), "prompt files come from the package");
  assert.ok(p.includes("Team rules"));
}));

test("manager table lists only installed roles", () => withHome(home => {
  const base = assemblePrompt("manager", "orchestrator");
  assert.ok(!base.includes("{{OWNERSHIP_TABLE}}"));
  assert.match(base, /\| researcher \|/);
  assert.match(base, /\| developer \|/);
  assert.doesNotMatch(base, /\| planner \|/);
  cpSync(join(CATALOG_DIR, "roles", "planner.md"), join(home, "library", "roles", "planner.md"));
  assert.match(assemblePrompt("manager", "orchestrator"), /\| planner \|/);
}));

test("missing-role rule present", () => withHome(() => {
  assert.match(assemblePrompt("manager", "orchestrator"), /role store/i);
}));

test("orchestrator prompt mentions handoff tool, cli prompt keeps HANDOFF block", () => withHome(() => {
  const p = assemblePrompt("developer", "orchestrator");
  assert.ok(p.includes("`handoff`") && !p.includes("HANDOFF →"));
  assert.ok(!p.includes("Manager in orchestrated mode"), "manager-only rules leak to other roles");
  assert.ok(assemblePrompt("developer", "cli").includes("HANDOFF →"));
  assert.ok(assemblePrompt("manager", "orchestrator").includes("reply_checkpoint"));
}));

test("manager playbook hands build work to the explainer for a stakeholder overview", () => withHome(() => {
  const p = assemblePrompt("manager", "orchestrator");
  assert.match(p, /\| explainer \|/);
  assert.match(p, /docs\/OVERVIEW\.md/);
  assert.match(assemblePrompt("explainer", "orchestrator"), /```mermaid/);
}));
