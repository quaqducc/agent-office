#!/usr/bin/env node
// Packaging smoke test: pack the package, install the tarball into a temp prefix like a user would,
// then run `agent-company --version`, `doctor` and `start` against an empty app home.
// Usage: node scripts/pack-smoke.mjs   (needs network for the dependency install)
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const npm = (args, opts = {}) => execFileSync(win ? "npm.cmd" : "npm", args, { encoding: "utf8", shell: win, ...opts });
const tmp = mkdtempSync(join(tmpdir(), "agent-company-smoke-"));
const prefix = join(tmp, "prefix");
const env = { ...process.env, AGENT_COMPANY_HOME: join(tmp, "home ứ") };
delete env.COMPANY_PORT;
const fail = msg => { console.error(`pack-smoke: ${msg}`); process.exitCode = 1; };

try {
  const [{ filename }] = JSON.parse(npm(["pack", "--json", "--pack-destination", tmp], { cwd: root }));
  npm(["install", "-g", "--prefix", prefix, "--no-audit", "--no-fund", join(tmp, filename)], { stdio: ["ignore", "ignore", "inherit"] });
  const pkgDir = join(prefix, win ? "" : "lib", "node_modules", "@quaqduc", "agent-company");
  const shim = win ? join(prefix, "agent-company.cmd") : join(prefix, "bin", "agent-company");

  const version = execFileSync(shim, ["--version"], { encoding: "utf8", env, shell: win }).trim();
  const expected = JSON.parse(npm(["pkg", "get", "version"], { cwd: root }));
  if (version !== expected) fail(`--version printed "${version}", expected "${expected}"`);

  const doctor = execFileSync(process.execPath, [join(pkgDir, "bin", "agent-company.js"), "doctor"], { encoding: "utf8", env });
  if (!doctor.includes("chưa cấu hình model")) fail(`doctor without a provider should say "chưa cấu hình model":\n${doctor}`);

  const child = spawn(process.execPath, [join(pkgDir, "bin", "agent-company.js"), "start", "--no-open", "--port", "0"], { env });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20_000);
      child.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      child.stderr.on("data", d => { out += d; });
      child.on("exit", code => reject(new Error(`server exited (${code}):\n${out}`)));
    });
    const page = await fetch(`${url}/`);
    if (page.status !== 200 || !(await page.text()).includes("Agent Office")) fail(`GET / returned ${page.status}`);
    const marked = await fetch(`${url}/vendor/marked.js`);
    if (marked.status !== 200) fail(`GET /vendor/marked.js returned ${marked.status} (the UI would be blank)`);
    const health = await (await fetch(`${url}/health`)).json();
    if (health.configured !== false || health.version !== expected) fail(`unexpected /health ${JSON.stringify(health)}`);
  } finally { child.kill(); }
  if (!process.exitCode) console.log(`pack-smoke ok: ${filename} installs and runs (version ${version})`);
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
