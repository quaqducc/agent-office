import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { fakeFactory } from "./helpers/fake-runner.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const start = () => startServer({ port: 0, dataDir: tmp("data-"), createRunner: () => fakeFactory(async () => "ok") });

/** Raw GET so the path is sent exactly as written (fetch would normalize "..") */
const rawGet = (url: string, path: string) => new Promise<number>((res, rej) => {
  const u = new URL(url);
  request({ host: u.hostname, port: u.port, path }, r => { r.resume(); res(r.statusCode!); }).on("error", rej).end();
});

test("serves index.html at / and ui assets with content types", async () => {
  const srv = await start();
  try {
    const index = await fetch(srv.url + "/");
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type")!, /text\/html/);
    assert.match(await index.text(), /<title>/);
    const css = await fetch(srv.url + "/ui/styles.css");
    assert.match(css.headers.get("content-type")!, /text\/css/);
    const js = await fetch(srv.url + "/ui/js/state.js");
    assert.match(js.headers.get("content-type")!, /javascript/);
  } finally { await srv.close(); }
});

test("blocks path traversal", async () => {
  const srv = await start();
  try {
    for (const p of ["/ui/../package.json", "/ui/..%2f..%2fpackage.json", "/ui/%2e%2e/src/config.ts"]) {
      assert.equal(await rawGet(srv.url, p), 404, p);
    }
  } finally { await srv.close(); }
});

test("serves marked as an ES module", async () => {
  const srv = await start();
  try {
    const r = await fetch(srv.url + "/vendor/marked.js");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type")!, /javascript/);
    assert.match(await r.text(), /export/);
  } finally { await srv.close(); }
});

test("config endpoint returns active roles", async () => {
  const srv = await start();
  try {
    const folder = tmp("proj-");
    const ws = await (await fetch(srv.url + "/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: folder }) })).json() as any;
    writeFileSync(join(folder, ".company", "config.json"), JSON.stringify({ roles: ["critic"] }));
    const cfg = await (await fetch(`${srv.url}/workspaces/${ws.id}/config`)).json() as any;
    assert.deepEqual(cfg.roles, ["manager", "critic"]);
    assert.equal(cfg.limits.maxDepth, 4);
  } finally { await srv.close(); }
});

test("allows same-origin POST from its own origin, still rejects others", async () => {
  const srv = await start();
  try {
    const post = (origin: string) => fetch(srv.url + "/workspaces", {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ path: tmp("proj-") }),
    });
    const port = new URL(srv.url).port;
    assert.equal((await post(srv.url)).status, 201);
    assert.equal((await post(`http://localhost:${port}`)).status, 201);
    assert.equal((await post("http://evil.example")).status, 403);
  } finally { await srv.close(); }
});

test("UI responses cannot be framed and are not sniffed", async () => {
  const srv = await start();
  try {
    for (const p of ["/", "/ui/js/app.js"]) {
      const r = await fetch(srv.url + p);
      assert.equal(r.headers.get("x-frame-options"), "DENY", p);
      assert.match(r.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/, p);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
    }
  } finally { await srv.close(); }
});
