import { existsSync, readFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, VERSION } from "./config.ts";
import { listModels, testProvider } from "./providers.ts";
import { installRole, storeState, StoreError, uninstallRole } from "./store.ts";
import { loadConfig, mergeConfig, publicConfig, saveConfig, validateConfig, writePiModels, type AppConfig, type Provider } from "./settings.ts";
import { appHome, ensureHome } from "./home.ts";
import { EventLog, readRun } from "./event-log.ts";
import { loadRole, roleIds } from "./library.ts";
import { createPiRunnerFactory } from "./pi-runner.ts";
import { Router, type RunnerFactory } from "./router.ts";
import { runsDir, WorkspaceStore, type Workspace } from "./workspace.ts";
import { browseDirectory, pickNativeFolder, type PickFolderResult } from "./fs-browse.ts";
import { OFFICE_TEMPLATES } from "./offices.ts";
import { listWorkspaceTree, readWorkspaceFile, saveWorkspaceFile, createWorkspaceFile, assertSafeWorkspacePath, HttpError as IdeFsError } from "./ide-fs.ts";
import { getRunChanges, getShadowFileContent } from "./shadow.ts";
import { myersDiff } from "./diff.ts";
import { promises as fsPromises } from "node:fs";
import { resolve as pathResolve } from "node:path";

export interface ServerOptions {
  port?: number;
  dataDir?: string;
  /** Override for tests: build the runner factory for a workspace. */
  createRunner?: (ws: Workspace, router: () => Router) => RunnerFactory;
  pickFolder?: () => Promise<PickFolderResult>;
  apiToken?: string | boolean;
  requireToken?: boolean;
}

/** `sig`: signature of installed roles, workspace roles and rooms; rebuilt when changed and idle. */
interface Ctx { ws: Workspace; log: EventLog; router: Router; sig: string }

class HttpError extends Error {
  status: number;
  extra?: Record<string, any>;
  constructor(status: number, message: string, extra?: Record<string, any>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Browser origins allowed to call the API (none by default; the office UI's origin goes here). */
const ALLOWED_ORIGINS = (process.env.COMPANY_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = join(ROOT, "ui");
// wherever the package manager put it (nested, hoisted, pnpm/bun links)
const MARKED = join(dirname(fileURLToPath(import.meta.resolve("marked"))), "marked.esm.js");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon",
};

/** Resolve a URL path under ui/ safely; undefined when outside ui/ or missing. */
function uiFile(urlPath: string): string | undefined {
  let rel: string;
  try { rel = decodeURIComponent(urlPath); } catch { return undefined; }
  const file = normalize(join(UI_DIR, rel));
  if (!file.startsWith(UI_DIR + sep)) return undefined;
  return existsSync(file) && statSync(file).isFile() ? file : undefined;
}

export async function startServer(o: ServerOptions = {}): Promise<{ url: string; token?: string; close(): Promise<void> }> {
  if (process.env.NODE_TEST_CONTEXT && !o.dataDir) {
    const realHome = join(homedir(), ".agent-company");
    const currentHome = process.env.AGENT_COMPANY_HOME || realHome;
    if (currentHome === realHome) {
      throw new Error(
        `Safety error: startServer under node:test must not touch real app home (${realHome}). Provide dataDir or set AGENT_COMPANY_HOME.`
      );
    }
  }

  const apiToken = typeof o.apiToken === "string"
    ? o.apiToken
    : o.requireToken === true
    ? randomBytes(32).toString("hex")
    : o.requireToken === false
    ? undefined
    : o.apiToken === false
    ? undefined
    : (o.apiToken === true || (!process.env.NODE_TEST_CONTEXT && !o.dataDir)
        ? randomBytes(32).toString("hex")
        : undefined);
  if (!o.dataDir) ensureHome();
  const store = new WorkspaceStore(o.dataDir ?? appHome());
  // Runs left "active" by a crash or kill can never finish: mark them interrupted.
  for (const ws of store.list()) for (const r of store.runs(ws)) if (r.status === "active") store.appendRun(ws, { ...r, status: "interrupted" });
  for (const ws of store.list()) {
    if (store.getQueue(ws).length > 0) {
      queueMicrotask(() => {
        try { ctxFor(ws.id); } catch {}
      });
    }
  }
  let port = 0;
  let pickingFolder = false;
  const ctxs = new Map<string, Ctx>();
  const sse = new Set<{ res: ServerResponse; workspaceId?: string }>();

  function ctxFor(id: string): Ctx {
    const ws = store.get(id);
    if (!ws) throw new HttpError(404, `unknown workspace ${id}`);
    const cfg = store.config(ws);
    const sig = `${roleIds().join(",")}:${cfg.roles.join(",")}`;
    const existing = ctxs.get(id);
    // roles installed/removed or workspace team changed: rebuild once idle
    if (existing && (existing.sig === sig || existing.router.activeRunId())) return existing;
    if (existing) existing.router.dispose();
    const log = new EventLog(runsDir(ws), ws.id);
    let router!: Router;
    const getRouter = () => router;
    const createRunner = o.createRunner?.(ws, getRouter) ?? createPiRunnerFactory({ workspacePath: ws.path, router: getRouter });
    const started = new Map<string, { startedAt: string; firstMessage: string }>();
    const queueAdapter = {
      getQueue: () => store.getQueue(ws),
      enqueue: (text: string) => store.enqueue(ws, text),
      dequeue: () => store.dequeue(ws),
      remove: (qid: string) => store.removeQueueItem(ws, qid),
    };
    router = new Router({
      workspaceId: ws.id, roles: cfg.roles, limits: cfg.limits, log, createRunner, queueAdapter,
      onRunFinished: (runId, status, usage) => {
        const s = started.get(runId);
        store.appendRun(ws, { runId, startedAt: s?.startedAt ?? "", endedAt: new Date().toISOString(), status, firstMessage: s?.firstMessage ?? "", tokens: usage.tokens });
      },
    });
    log.subscribe(e => {
      if (e.type === "run_started") {
        const s = { startedAt: e.ts, firstMessage: String(e.data.firstMessage ?? "") };
        started.set(e.runId, s);
        store.appendRun(ws, { runId: e.runId, ...s, status: "active", tokens: 0 });
      }
      const frame = `data: ${JSON.stringify(e)}\n\n`;
      for (const c of sse) if (!c.workspaceId || c.workspaceId === e.workspaceId) c.res.write(frame);
    });
    const ctx = { ws, log, router, sig };
    ctxs.set(id, ctx);
    queueMicrotask(() => router.drainQueue());
    return ctx;
  }

  const allWorkspaceIds = () => store.list().map(w => w.id);

  /** The role set changed (store install/uninstall): idle workspaces rebuild their team on next use. */
  function refreshIdleContexts() {
    for (const [id, c] of ctxs) {
      if (!c.router.activeRunId()) {
        c.router.dispose();
        ctxs.delete(id);
      }
    }
  }

  async function body(req: IncomingMessage): Promise<any> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > 1024 * 1024) {
        req.pause();
        req.on("data", () => {});
        req.resume();
        throw new HttpError(413, "payload too large");
      }
      chunks.push(buf);
    }
    const s = Buffer.concat(chunks).toString("utf8");
    if (!s) return {};
    try { return JSON.parse(s); } catch { throw new HttpError(400, "invalid JSON body"); }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const m = req.method ?? "GET";
    // Localhost binding does not stop a web page in the user's browser: check Host (DNS rebinding),
    // Origin (cross-site requests) and content type (CORS "simple" POSTs).
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "forbidden host");
    const origin = req.headers.origin;
    const ownOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    if (origin && !ALLOWED_ORIGINS.includes(origin) && !ownOrigins.includes(origin)) throw new HttpError(403, "forbidden origin");
    const cors: Record<string, string> = origin ? { "access-control-allow-origin": origin, vary: "origin" } : {};
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...cors });
      res.end(JSON.stringify(data));
    };

    if (m === "OPTIONS") {
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE", "access-control-allow-headers": "content-type,x-company-token" });
      return res.end();
    }
    const isExempt = m === "OPTIONS"
      || (m === "GET" && (url.pathname === "/" || url.pathname.startsWith("/ui/") || url.pathname.startsWith("/vendor/") || url.pathname === "/vendor/marked.js" || url.pathname === "/health"));

    if (apiToken && !isExempt) {
      const token = req.headers["x-company-token"] || url.searchParams.get("token");
      if (token !== apiToken) {
        throw new HttpError(401, "unauthorized: missing or invalid token");
      }
    }
    if ((m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") && !(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "content-type must be application/json");
    if (m === "GET" && (url.pathname === "/" || url.pathname.startsWith("/ui/") || url.pathname === "/vendor/marked.js")) {
      const file = url.pathname === "/" ? join(UI_DIR, "index.html")
        : url.pathname === "/vendor/marked.js" ? MARKED
        : uiFile(url.pathname.slice("/ui/".length));
      if (!file || !existsSync(file)) throw new HttpError(404, "not found");
      if (url.pathname === "/") {
        let html = readFileSync(file, "utf8");
        if (apiToken) {
          html = html.replace("<head>", `<head><meta name="company-token" content="${apiToken}">`);
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8", "cache-control": "no-cache",
          "x-frame-options": "DENY", "x-content-type-options": "nosniff",
          "content-security-policy": "frame-ancestors 'none'; default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'",
        });
        return res.end(html);
      }
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache",
        // The UI shares an origin with the approval API: never allow framing (clickjacking on "approve").
        "x-frame-options": "DENY", "x-content-type-options": "nosniff",
        "content-security-policy": "frame-ancestors 'none'; default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'",
      });
      return res.end(readFileSync(file));
    }
    if (m === "GET" && url.pathname === "/health") {
      return json(200, { version: VERSION, configured: !!loadConfig().defaultModel });
    }
    if (url.pathname === "/settings") {
      if (m === "GET") return json(200, publicConfig(loadConfig()));
      if (m === "PUT") {
        const next = mergeConfig(loadConfig(), await body(req) as AppConfig);
        const errors = validateConfig(next);
        if (errors.length) throw new HttpError(400, errors.join("; "));
        saveConfig(next);
        writePiModels(next);
        return json(200, publicConfig(next));
      }
    }
    if (m === "POST" && (url.pathname === "/settings/providers/test" || url.pathname === "/settings/providers/models")) {
      const b = await body(req);
      if (!b.provider?.baseUrl) throw new HttpError(400, "provider.baseUrl is required");
      // a masked key from the UI means "use the stored key for this provider id"
      const provider = mergeConfig(loadConfig(), { providers: [b.provider as Provider], roleModels: {}, search: { mode: "auto" } }).providers[0];
      if (url.pathname.endsWith("/models")) {
        try { return json(200, { models: await listModels(provider) }); } catch (e) { return json(200, { models: [], error: (e as Error).message }); }
      }
      if (!b.model) throw new HttpError(400, "model is required");
      return json(200, await testProvider(provider, String(b.model)));
    }
    if (m === "GET" && url.pathname === "/store") return json(200, await storeState());
    if (parts[0] === "store" && parts[1] === "roles" && parts[2]) {
      const id = decodeURIComponent(parts[2]);
      if (m === "POST" && parts[3] === "install") { await installRole(id); refreshIdleContexts(); return json(200, { installed: id }); }
      if (m === "DELETE" && !parts[3]) {
        await uninstallRole(id);
        // a model choice for a removed role would otherwise block every later settings save
        const cfg = loadConfig();
        if (cfg.roleModels[id]) { delete cfg.roleModels[id]; saveConfig(cfg); writePiModels(cfg); }
        refreshIdleContexts();
        return json(200, { removed: id });
      }
    }
    if (m === "GET" && url.pathname === "/roles") {
      return json(200, roleIds().map(id => { const r = loadRole(id); return { id, name: r.meta.name, description: r.meta.description, owns: r.meta.owns }; }));
    }
    if (m === "GET" && url.pathname === "/offices") {
      return json(200, OFFICE_TEMPLATES);
    }
    if (m === "POST" && url.pathname === "/fs/pick-folder") {
      if (pickingFolder) throw new HttpError(409, "A folder picker dialog is already open");
      pickingFolder = true;
      try {
        const picker = o.pickFolder ?? pickNativeFolder;
        return json(200, await picker());
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      } finally {
        pickingFolder = false;
      }
    }
    if (m === "POST" && url.pathname === "/fs/browse") {
      const b = await body(req);
      try {
        return json(200, await browseDirectory(typeof b.path === "string" ? b.path : undefined));
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "folder not found or not a directory") throw new HttpError(404, msg);
        throw new HttpError(400, msg);
      }
    }
    if (m === "GET" && url.pathname === "/workspaces") return json(200, store.list());
    if (m === "POST" && url.pathname === "/workspaces") {
      const b = await body(req);
      if (typeof b.path !== "string") throw new HttpError(400, "path is required");
      try { return json(201, store.add(b.path, b.name)); } catch (e) { throw new HttpError(400, (e as Error).message); }
    }
    if (m === "GET" && url.pathname === "/events") {
      const workspaceId = url.searchParams.get("workspace") ?? undefined;
      if (workspaceId) ctxFor(workspaceId);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...cors });
      res.write(": connected\n\n");
      const client = { res, workspaceId };
      sse.add(client);
      const beat = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => { clearInterval(beat); sse.delete(client); });
      return;
    }
    if (parts[0] === "workspaces" && parts[1]) {
      if (m === "PATCH" && !parts[2]) {
        const b = await body(req);
        if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "name is required");
        try {
          const updated = store.rename(parts[1], b.name);
          return json(200, updated);
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.startsWith("unknown workspace")) throw new HttpError(404, msg);
          throw new HttpError(400, msg);
        }
      }
      if (m === "PUT" && parts[2] === "config") {
        const ws = store.get(parts[1]);
        if (!ws) throw new HttpError(404, `unknown workspace ${parts[1]}`);
        const existing = ctxs.get(parts[1]);
        if (existing && existing.router.activeRunId()) {
          throw new HttpError(409, "Đang có lần chạy — lưu lại sau khi đội rảnh");
        }
        const b = await body(req);
        if (!Array.isArray(b.roles)) throw new HttpError(400, "roles must be an array");
        const cleanRoles: string[] = [...new Set(b.roles as string[])];
        const installed = roleIds();
        const missing = cleanRoles.filter((r: string) => !installed.includes(r));
        if (missing.length > 0) {
          throw new HttpError(400, `Các vai trò sau chưa được cài đặt: ${missing.join(", ")}`, { missing });
        }
        try {
          const cfg = store.saveConfig(ws, { roles: cleanRoles, rooms: b.rooms, template: b.template });
          return json(200, cfg);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
      const ctx = ctxFor(parts[1]);
      if (m === "GET" && parts[2] === "runs") return json(200, store.runs(ctx.ws));
      if (m === "GET" && parts[2] === "config") return json(200, store.config(ctx.ws));
      if (m === "GET" && parts[2] === "approvals") return json(200, ctx.router.pendingApprovals());
      if (m === "GET" && parts[2] === "tree") {
        const subpath = url.searchParams.get("path") ?? ".";
        const depth = parseInt(url.searchParams.get("depth") ?? "1", 10) || 1;
        const nodes = await listWorkspaceTree(ctx.ws.path, subpath, depth);
        return json(200, nodes);
      }
      if (m === "GET" && parts[2] === "files") {
        const subpath = url.searchParams.get("path");
        if (!subpath) throw new HttpError(400, "path query parameter is required");
        const fileRes = await readWorkspaceFile(ctx.ws.path, subpath);
        return json(200, fileRes);
      }
      if (m === "PUT" && parts[2] === "files") {
        const b = await body(req);
        if (typeof b.path !== "string" || !b.path) throw new HttpError(400, "path is required");
        if (typeof b.content !== "string") throw new HttpError(400, "content must be a string");
        const res = await saveWorkspaceFile(ctx.ws.path, b.path, b.content, {
          expectedSha256: typeof b.expectedSha256 === "string" ? b.expectedSha256 : undefined,
          force: Boolean(b.force),
        });
        return json(200, res);
      }
      if (m === "POST" && parts[2] === "files") {
        const b = await body(req);
        if (typeof b.path !== "string" || !b.path.trim()) throw new HttpError(400, "path is required");
        const content = typeof b.content === "string" ? b.content : "";
        const res = await createWorkspaceFile(ctx.ws.path, b.path.trim(), content);
        return json(201, res);
      }
      if (m === "GET" && parts[2] === "changes") {
        const runId = url.searchParams.get("runId");
        if (!runId || !runId.trim()) throw new HttpError(400, "runId query parameter is required");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
          throw new HttpError(400, "invalid runId: must be a valid UUID");
        }
        const changes = await getRunChanges(ctx.ws.path, runId);
        return json(200, changes);
      }
      if (m === "GET" && parts[2] === "diff") {
        const runId = url.searchParams.get("runId");
        const subpath = url.searchParams.get("path");
        if (!runId || !runId.trim()) throw new HttpError(400, "runId query parameter is required");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
          throw new HttpError(400, "invalid runId: must be a valid UUID");
        }
        if (!subpath || !subpath.trim()) throw new HttpError(400, "path query parameter is required");

        // Jail check: blocks path traversal, symlink out of bounds, and secrets
        assertSafeWorkspacePath(ctx.ws.path, subpath);

        // Read shadow text
        const shadowRaw = await getShadowFileContent(ctx.ws.path, runId, subpath);
        const oldText = shadowRaw ?? "";

        // Read current disk text
        const fullDiskPath = pathResolve(ctx.ws.path, subpath);
        let newText = "";
        if (existsSync(fullDiskPath)) {
          const s = await fsPromises.stat(fullDiskPath);
          if (s.isDirectory()) throw new HttpError(400, "Cannot diff directory");
          if (s.size > 2 * 1024 * 1024) throw new HttpError(413, "File exceeds 2MB limit");
          const buf = await fsPromises.readFile(fullDiskPath);
          const sample = buf.subarray(0, Math.min(buf.length, 512));
          if (sample.includes(0x00)) throw new HttpError(400, "Cannot diff binary file");
          newText = buf.toString("utf-8");
        }

        const diffResult = myersDiff(subpath, oldText, newText);
        return json(200, diffResult);
      }
      if (m === "GET" && parts[2] === "queue") return json(200, store.getQueue(ctx.ws));
      if (m === "DELETE" && parts[2] === "queue" && parts[3]) {
        const qid = parts[3];
        const removed = store.removeQueueItem(ctx.ws, qid);
        if (!removed) throw new HttpError(404, `queued message ${qid} not found`);
        return json(200, { deleted: qid });
      }
      if (m === "POST" && parts[2] === "messages") {
        const b = await body(req);
        if (typeof b.text !== "string" || !b.text.trim()) throw new HttpError(400, "text is required");
        const res = ctx.router.sendUserMessage(b.text);
        if (res.queued) return json(200, { queued: true, position: res.position, id: res.id });
        return json(200, { runId: res.runId });
      }
    }
    if (parts[0] === "runs" && parts[1]) {
      const runId = parts[1];
      if (m === "GET" && parts[2] === "events") {
        for (const id of allWorkspaceIds()) {
          const events = readRun(runsDir(store.get(id)!), runId);
          if (events.length) return json(200, events);
        }
        throw new HttpError(404, `unknown run ${runId}`);
      }
      if (m === "POST" && parts[2] === "stop") {
        for (const c of ctxs.values()) if (c.router.activeRunId() === runId) { await c.router.stopRun(runId); return json(200, { stopped: runId }); }
        throw new HttpError(404, `no active run ${runId}`);
      }
    }
    if (m === "POST" && parts[0] === "checkpoints" && parts[1] && parts[2] === "reply") {
      const b = await body(req);
      if (!["approve", "reject", "edit"].includes(b.decision)) throw new HttpError(400, "decision must be approve, reject or edit");
      for (const c of ctxs.values()) if (c.router.replyApproval(parts[1], b.decision, b.note ?? "")) return json(200, { replied: parts[1] });
      throw new HttpError(404, `no pending approval ${parts[1]}`);
    }
    throw new HttpError(404, `no route ${m} ${url.pathname}`);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e => {
      const status = e instanceof HttpError || e instanceof IdeFsError || e instanceof StoreError ? e.status : 500;
      if (!res.headersSent) res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...(status === 413 ? { connection: "close" } : {}) });
      const payload: any = { error: (e as Error).message };
      if ((e instanceof HttpError || e instanceof IdeFsError) && e.extra) Object.assign(payload, e.extra);
      res.end(JSON.stringify(payload));
      if (status === 413) req.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); // EADDRINUSE etc. reach the caller instead of crashing the process
    server.listen(o.port ?? PORT, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    token: apiToken,
    close: () => new Promise<void>(r => {
      for (const c of sse) c.res.end();
      server.closeAllConnections();
      server.close(() => r());
    }),
  };
}

if (import.meta.main) {
  const { url } = await startServer();
  console.log(`agent-company server listening on ${url}`);
}
