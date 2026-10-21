import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { checkToolCall } from "../src/guard.ts";

const WS = "C:\\Users\\Hi\\AppData\\Local\\Temp\\proj-a";
// Windows-style cases run with path.win32 on every OS (CI is cross-platform).
const blocked = (tool: string, args: object) => checkToolCall(tool, args, WS, win32).block;

test("read-only tools may read anywhere (knowledge lookup)", () => {
  assert.equal(blocked("read", { path: "src/app.py" }), false);
  assert.equal(blocked("read", { path: "D:/DBRX/OKF/knowledge-catalog/okf/SPEC.md" }), false);
  assert.equal(blocked("grep", { pattern: "x", path: "D:/agent-company" }), false);
  assert.equal(blocked("find", { pattern: "*.md", path: "D:\\DBRX" }), false);
  assert.equal(blocked("ls", { path: "../proj-b" }), false);
  assert.equal(blocked("read", { path: "D:/proj/.env.example" }), false, "templates are fine");
});

test("secrets stay unreadable everywhere", () => {
  for (const p of [
    "C:/Users/Hi/AppData/Local/Temp/ac-smoke-ws/.env", ".env", "config/.env.production",
    "C:\\Users\\Hi\\.ssh\\id_rsa", "D:/keys/server.pem", "D:/keys/client.key",
    "D:/tools/pi-runtime/agent/models.json", "D:\\tools\\pi-runtime\\agent\\auth.json",
    "C:/Users/Hi/.claude/settings.json", "C:/Users/Hi/.claude.json", "C:/Users/Hi/.aws/credentials",
  ]) assert.equal(blocked("read", { path: p }), true, p);
  assert.equal(blocked("grep", { pattern: "x", path: "C:/Users/Hi/.ssh" }), true);
});

test("writes stay inside the workspace", () => {
  assert.equal(blocked("write", { path: "out/report.md" }), false);
  assert.equal(blocked("edit", { path: `${WS}\\setup.bat` }), false);
  assert.equal(blocked("write", { path: "C:\\Windows\\x.txt" }), true);
  assert.equal(blocked("edit", { path: "../proj-b/app.py" }), true);
  assert.equal(blocked("write", { path: "D:/DBRX/OKF/SPEC.md" }), true, "knowledge is read-only");
});

test("orchestration data is off limits", () => {
  assert.equal(blocked("read", { path: ".company/runs/index.json" }), true);
  assert.equal(blocked("ls", { path: ".company" }), true);
  assert.equal(blocked("grep", { pattern: "x", path: "D:/other-ws/.company/sessions" }), true);
});

test("bash may not reach outside the workspace", () => {
  assert.equal(blocked("bash", { command: "python -m venv .venv && .venv\\Scripts\\pip install requests" }), false);
  assert.equal(blocked("bash", { command: "cmd.exe /c \"if 1==1 echo hi\"" }), false);
  assert.equal(blocked("bash", { command: "cmd.exe /c \"dir /s /b setup.bat\"" }), false);
  assert.equal(blocked("bash", { command: "pip install https://example.com/pkg/x.whl" }), false);
  assert.equal(blocked("bash", { command: `type "${WS}\\setup.bat"` }), false);
  assert.equal(blocked("bash", { command: "cat \"C:/Users/Hi/AppData/Local/Temp/ac-smoke-ws/.env\"" }), true);
  assert.equal(blocked("bash", { command: "powershell -Command \"Get-ChildItem -Path 'D:\\' -Recurse\"" }), true);
  assert.equal(blocked("bash", { command: "ls -la /d/agent-company" }), true);
  assert.equal(blocked("bash", { command: "cat ../proj-b/.env" }), true);
  assert.equal(blocked("bash", { command: "cat ~/.ssh/id_rsa" }), true);
  assert.equal(blocked("bash", { command: "cat .company/runs/index.json" }), true);
  assert.equal(blocked("bash", { command: "env | grep -i key" }), true);
  // home directory and secret folders through variables or a bare ~
  assert.equal(blocked("bash", { command: "cd ~ && cat .agent-company/config.json" }), true);
  assert.equal(blocked("bash", { command: "cat \"$HOME/.agent-company/config.json\"" }), true);
  assert.equal(blocked("bash", { command: "cat ${HOME}/notes.txt" }), true);
  assert.equal(blocked("bash", { command: "type %USERPROFILE%\.agent-company\config.json" }), true);
  assert.equal(blocked("powershell", { command: "Get-Content $env:USERPROFILE\.ssh\id_rsa" }), true);
  assert.equal(blocked("bash", { command: "cd && ls" }), true);
  assert.equal(blocked("bash", { command: "cat .agent-company/config.json" }), true);
  assert.equal(blocked("bash", { command: "echo ~ok" }), false, "a tilde inside a word is fine");
  assert.equal(blocked("powershell", { command: "Get-Content C:\\Users\\Hi\\.ssh\\id_rsa" }), true);
  // a bare drive root must not resolve to the process cwd (which may be inside the workspace)
  assert.equal(checkToolCall("bash", { command: "dir C:\\ /s" }, "C:\\Users\\Hi\\proj", win32).block, true, "bare drive root");
});

test("block reasons tell the model what to do instead", () => {
  const r = checkToolCall("write", { path: "D:/elsewhere/a.txt" }, WS, win32);
  assert.match(r.reason ?? "", /outside the workspace/);
  assert.match(r.reason ?? "", /ask the requester|checkpoint/i);
  assert.match(checkToolCall("read", { path: "D:/x/.env" }, WS, win32).reason ?? "", /secret/i);
});

test("posix paths: secrets blocked, documents readable", async () => {
  const { posix } = await import("node:path");
  const ws = "/home/u/proj";
  const b = (tool: string, args: object) => checkToolCall(tool, args, ws, posix).block;
  assert.equal(b("read", { path: "/srv/docs/a.md" }), false);
  assert.equal(b("read", { path: "/home/u/.ssh/id_rsa" }), true);
  assert.equal(b("read", { path: "/home/u/other/.env" }), true);
  assert.equal(b("write", { path: "/etc/hosts" }), true);
  assert.equal(b("write", { path: "notes.md" }), false);
  assert.equal(b("bash", { command: "cat /home/u/other/secret.txt" }), true);
  assert.equal(b("bash", { command: "python3 -m venv .venv" }), false);
  // device files are not "outside the workspace"
  assert.equal(b("bash", { command: "npm test 2>/dev/null" }), false);
  assert.equal(b("bash", { command: "make > /dev/null 2>&1" }), false);
  assert.equal(b("bash", { command: "cat /dev/../etc/passwd" }), true);
});

test("the app home is secret", async () => {
  const { homePaths } = await import("../src/home.ts");
  assert.equal(checkToolCall("read", { path: homePaths().config }, process.cwd()).block, true);
  assert.equal(checkToolCall("read", { path: homePaths().piModels }, process.cwd()).block, true);
});

test("read tools see through symlinks, globs and home-wide searches", () => {
  const base = mkdtempSync(join(tmpdir(), "guard-link-"));
  const ws = join(base, "ws");
  mkdirSync(join(base, "fakehome", ".ssh"), { recursive: true });
  writeFileSync(join(base, "fakehome", ".ssh", "id_rsa"), "key");
  mkdirSync(ws);
  symlinkSync(join(base, "fakehome", ".ssh"), join(ws, "notes"), "junction");
  const b = (tool: string, input: object) => checkToolCall(tool, input, ws).block;
  assert.equal(b("read", { path: "notes/id_rsa" }), true, "a link into .ssh");
  assert.equal(b("find", { pattern: "../fakehome/.ssh/*" }), true, "a glob into .ssh");
  assert.equal(b("grep", { pattern: "sk-", path: homedir() }), true, "grep over the whole home folder");
  assert.equal(b("grep", { pattern: "TODO", path: "." }), false);
  assert.equal(b("read", { path: "README.md" }), false);
});
