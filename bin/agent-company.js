#!/usr/bin/env node
// Entry point of the `agent-company` command. Runs the compiled app (dist/) when installed,
// or the TypeScript sources directly when run from a git checkout.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error(`Agent Company cần Node.js 22.19 trở lên (máy đang dùng ${process.versions.node}). Tải tại https://nodejs.org`);
  process.exit(1);
}

const dist = new URL("../dist/main.js", import.meta.url);
const entry = existsSync(fileURLToPath(dist)) ? dist : new URL("../src/main.ts", import.meta.url);
const { main } = await import(entry.href);
const code = await main(process.argv.slice(2));
process.exitCode = code;
