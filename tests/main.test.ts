import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/main.ts";

test("parseArgs: default is start with browser", () => {
  assert.deepEqual(parseArgs([]), { cmd: "start", open: true, rest: [] });
});

test("parseArgs: start options", () => {
  assert.deepEqual(parseArgs(["--port", "5000", "--no-open"]), { cmd: "start", port: 5000, open: false, rest: [] });
  assert.deepEqual(parseArgs(["start", "--home", "D:/x y"]), { cmd: "start", home: "D:/x y", open: true, rest: [] });
});

test("parseArgs: subcommands", () => {
  assert.equal(parseArgs(["doctor"]).cmd, "doctor");
  assert.deepEqual(parseArgs(["chat", "d:/proj", "My shop"]), { cmd: "chat", open: true, rest: ["d:/proj", "My shop"] });
  assert.deepEqual(parseArgs(["import", "--from-pi-runtime", "D:/tools/pi-runtime", "--workspaces", "data/workspaces.json"]),
    { cmd: "import", open: true, rest: ["--from-pi-runtime", "D:/tools/pi-runtime", "--workspaces", "data/workspaces.json"] });
  assert.equal(parseArgs(["--version"]).cmd, "version");
  assert.equal(parseArgs(["-v"]).cmd, "version");
  assert.equal(parseArgs(["--help"]).cmd, "help");
});

test("parseArgs: bad input shows help with an error", () => {
  assert.deepEqual(parseArgs(["--bogus"]), { cmd: "help", open: true, rest: [], error: "unknown option --bogus" });
  assert.deepEqual(parseArgs(["--port", "abc"]), { cmd: "help", open: true, rest: [], error: "--port needs a number" });
  assert.deepEqual(parseArgs(["frobnicate"]), { cmd: "help", open: true, rest: [], error: "unknown command frobnicate" });
});
