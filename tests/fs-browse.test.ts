import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNativeFolder } from "../src/fs-browse.ts";

test("pickNativeFolder (win32) returns selected path and name", async () => {
  const mockExec = async (cmd: string, args: string[]) => {
    assert.equal(cmd, "powershell");
    assert.ok(args.some(a => a.includes("FolderBrowserDialog")));
    return { stdout: "C:\\projects\\my-agent-app\r\n", stderr: "" };
  };

  const res = await pickNativeFolder(mockExec, "win32");
  assert.equal(res.canceled, false);
  assert.equal(res.name, "my-agent-app");
  assert.ok(res.path?.endsWith("my-agent-app"));
});

test("pickNativeFolder (win32) returns canceled when dialog dismissed", async () => {
  const mockExec = async () => ({ stdout: "   \r\n", stderr: "" });
  const res = await pickNativeFolder(mockExec, "win32");
  assert.deepEqual(res, { canceled: true });
});

test("pickNativeFolder (win32) rejects unsafe UNC path", async () => {
  const mockExec = async () => ({ stdout: "\\\\evil-server\\share\r\n", stderr: "" });
  await assert.rejects(
    () => pickNativeFolder(mockExec, "win32"),
    /UNC and device paths are not allowed/
  );
});

test("pickNativeFolder (darwin) calls osascript and parses path", async () => {
  const mockExec = async (cmd: string, args: string[]) => {
    assert.equal(cmd, "osascript");
    assert.ok(args.some(a => a.includes("choose folder")));
    return { stdout: "/Users/alice/projects/demo/\n", stderr: "" };
  };

  const res = await pickNativeFolder(mockExec, "darwin");
  assert.equal(res.canceled, false);
  assert.equal(res.name, "demo");
  assert.equal(res.path, "/Users/alice/projects/demo");
});

test("pickNativeFolder (darwin) handles cancellation error", async () => {
  const mockExec = async () => {
    const err: any = new Error("User canceled.");
    err.code = 1;
    throw err;
  };
  const res = await pickNativeFolder(mockExec, "darwin");
  assert.deepEqual(res, { canceled: true });
});

test("pickNativeFolder (linux) uses zenity and falls back to kdialog", async () => {
  const calls: string[] = [];
  const mockExec = async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "zenity") {
      const err: any = new Error("command not found");
      err.code = 127;
      throw err;
    }
    return { stdout: "/home/bob/work/repo\n", stderr: "" };
  };

  const res = await pickNativeFolder(mockExec, "linux");
  assert.deepEqual(calls, ["zenity", "kdialog"]);
  assert.equal(res.canceled, false);
  assert.equal(res.name, "repo");
  assert.equal(res.path, "/home/bob/work/repo");
});

test("pickNativeFolder (linux) handles cancellation", async () => {
  const mockExec = async () => {
    const err: any = new Error("cancel");
    err.code = 1;
    throw err;
  };
  const res = await pickNativeFolder(mockExec, "linux");
  assert.deepEqual(res, { canceled: true });
});
