import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/main.ts";
import {
  parseShortcutArgs,
  resolveShortcutPaths,
  generateShortcutScript,
  createShortcut,
  windowsShellFolders,
} from "../src/launcher.ts";

test("Launcher: parseArgs recognizes shortcut command and flags", () => {
  const a1 = parseArgs(["shortcut"]);
  assert.equal(a1.cmd, "shortcut");
  const s1 = parseShortcutArgs(a1.rest);
  assert.equal(s1.desktop, true);
  assert.equal(s1.startMenu, false);

  const a2 = parseArgs(["shortcut", "--desktop"]);
  assert.equal(a2.cmd, "shortcut");
  const s2 = parseShortcutArgs(a2.rest);
  assert.equal(s2.desktop, true);
  assert.equal(s2.startMenu, false);

  const a3 = parseArgs(["shortcut", "--start-menu"]);
  assert.equal(a3.cmd, "shortcut");
  const s3 = parseShortcutArgs(a3.rest);
  assert.equal(s3.desktop, false);
  assert.equal(s3.startMenu, true);

  const a4 = parseArgs(["shortcut", "--desktop", "--start-menu"]);
  assert.equal(a4.cmd, "shortcut");
  const s4 = parseShortcutArgs(a4.rest);
  assert.equal(s4.desktop, true);
  assert.equal(s4.startMenu, true);
});

test("Launcher: resolveShortcutPaths returns platform-specific directories", () => {
  // Windows
  const winPaths = resolveShortcutPaths("win32", {
    USERPROFILE: "C:\\Users\\TestUser",
    APPDATA: "C:\\Users\\TestUser\\AppData\\Roaming",
  });
  assert.equal(winPaths.desktop, "C:\\Users\\TestUser\\Desktop");
  assert.equal(
    winPaths.startMenu,
    "C:\\Users\\TestUser\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs"
  );

  // macOS
  const macPaths = resolveShortcutPaths("darwin", {
    HOME: "/Users/testuser",
  });
  assert.equal(macPaths.desktop, "/Users/testuser/Desktop");
  assert.equal(macPaths.startMenu, "/Users/testuser/Applications");

  // Linux (with default fallback)
  const linuxPaths = resolveShortcutPaths("linux", {
    HOME: "/home/testuser",
  });
  assert.equal(linuxPaths.desktop, "/home/testuser/Desktop");
  assert.equal(linuxPaths.startMenu, "/home/testuser/.local/share/applications");

  // Linux (with XDG env overrides)
  const xdgPaths = resolveShortcutPaths("linux", {
    HOME: "/home/testuser",
    XDG_DESKTOP_DIR: "/home/testuser/Mesa",
    XDG_DATA_HOME: "/home/testuser/.local/custom-share",
  });
  assert.equal(xdgPaths.desktop, "/home/testuser/Mesa");
  assert.equal(xdgPaths.startMenu, "/home/testuser/.local/custom-share/applications");
});

test("Launcher: windowsShellFolders returns the real (possibly OneDrive / non-ASCII) folders", { skip: process.platform !== "win32" }, () => {
  const folders = windowsShellFolders();
  assert.ok(folders, "PowerShell lookup must succeed");
  assert.ok(existsSync(folders.desktop), `Desktop must exist: ${folders.desktop}`);
  assert.ok(existsSync(folders.startMenu), `Start Menu must exist: ${folders.startMenu}`);
});

test("Launcher: generateShortcutScript locks process.execPath and cliPath", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const cliPath = "C:\\agent-company\\bin\\agent-company.js";

  // Windows
  const winScript = generateShortcutScript("win32", {
    execPath,
    cliPath,
    targetLnkPath: "C:\\Temp\\Agent Company.lnk",
    workingDir: "C:\\Users\\TestUser",
  });
  assert.ok(winScript.includes("WindowStyle Hidden"));
  assert.ok(winScript.includes(execPath));
  assert.ok(winScript.includes(cliPath));
  assert.ok(winScript.includes("WScript.Shell"));

  // Linux .desktop
  const linuxScript = generateShortcutScript("linux", {
    execPath: "/usr/bin/node",
    cliPath: "/usr/lib/node_modules/agent-company/bin/agent-company.js",
    targetLnkPath: "/home/testuser/Desktop/agent-company.desktop",
    workingDir: "/home/testuser",
  });
  assert.ok(linuxScript.includes("[Desktop Entry]"));
  assert.ok(linuxScript.includes("Type=Application"));
  assert.ok(linuxScript.includes("Terminal=false"));
  assert.ok(linuxScript.includes("/usr/bin/node"));
  assert.ok(linuxScript.includes("agent-company.js"));
});

test("Launcher: createShortcut creates valid shortcut in target directory", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ac-launcher-test-"));
  try {
    const res = await createShortcut({
      desktop: true,
      startMenu: false,
      customDesktopDir: tmp,
      execPath: process.execPath,
    });

    assert.equal(res.errors.length, 0);
    assert.equal(res.created.length, 1);
    const createdPath = res.created[0];
    assert.ok(existsSync(createdPath), `Shortcut file must exist: ${createdPath}`);

    if (process.platform === "win32") {
      assert.ok(createdPath.endsWith(".lnk"));
    } else {
      assert.ok(createdPath.endsWith(".desktop") || createdPath.endsWith(".command"));
      const content = readFileSync(createdPath, "utf-8");
      assert.ok(content.includes("agent-company"));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
