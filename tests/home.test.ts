import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { appHome, ensureHome, homePaths } from "../src/home.ts";
import { loadConfig, saveConfig } from "../src/settings.ts";

test("defaults to ~/.agent-company and honours AGENT_COMPANY_HOME", () => {
  const saved = process.env.AGENT_COMPANY_HOME;
  try {
    delete process.env.AGENT_COMPANY_HOME;
    assert.equal(appHome(), join(homedir(), ".agent-company"));
    process.env.AGENT_COMPANY_HOME = join(tmpdir(), "ac-x");
    assert.equal(appHome(), join(tmpdir(), "ac-x"));
    const p = homePaths();
    assert.equal(p.config, join(tmpdir(), "ac-x", "config.json"));
    assert.equal(p.piModels, join(tmpdir(), "ac-x", "pi", "models.json"));
    assert.equal(p.library, join(tmpdir(), "ac-x", "library"));
  } finally {
    if (saved === undefined) delete process.env.AGENT_COMPANY_HOME; else process.env.AGENT_COMPANY_HOME = saved;
  }
});

test("home with spaces and unicode", () => {
  const home = join(mkdtempSync(join(tmpdir(), "ac-")), "Nguyễn Văn A", ".agent company");
  ensureHome(home);
  const p = homePaths(home);
  for (const d of [p.home, p.library, p.pi]) assert.ok(existsSync(d), d);
  saveConfig({ ...loadConfig(p.config), port: 5555 }, p.config);
  assert.equal(loadConfig(p.config).port, 5555);
});
