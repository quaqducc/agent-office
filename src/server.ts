import { existsSync, readFileSync, statSync } from "node:fs";
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

export interface ServerOptions {
  port?: number;
  dataDir?: string;
  /** Override for tests: build the runner factory for a workspace. */
  createRunner?: (ws: Workspace, router: () => Router) => RunnerFactory;
}

/** `roles`: the installed roles when the context was built; a context is rebuilt once they change and it is idle. */
interface Ctx { ws: Workspace; log: EventLog; router: Router; roles: string }

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
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

export async function startServer(o: ServerOptions = {}): Promise<{ url: string; close(): Promise<void> }> {
  if (!o.dataDir) ensureHome();
  const store = new WorkspaceStore(o.dataDir ?? appHome());
  // Runs left "active" by a crash or kill can never finish: mark them interrupted.
  for (const ws of store.list()) for (const r of store.runs(ws)) if (r.status === "active") store.appendRun(ws, { ...r, status: "interrupted" });
  let port = 0;
  const ctxs = new Map<string, Ctx>();
  const sse = new Set<{ res: ServerResponse; workspaceId?: string }>();

  function ctxFor(id: string): Ctx {
    const existing = ctxs.get(id);
    // roles installed or removed in the store: rebuild the team once the workspace is idle
    if (existing && (existing.roles === roleIds().join(",") || existing.router.activeRunId())) return existing;
    const ws = store.get(id);
    if (!ws) throw new HttpError(404, `unknown workspace ${id}`);
    const cfg = store.config(ws);
    const log = new EventLog(runsDir(ws), ws.id);
    let router!: Router;
    const getRouter = () => router;
    const createRunner = o.createRunner?.(ws, getRouter) ?? createPiRunnerFactory({ workspacePath: ws.path, router: getRouter });
    const started = new Map<string, { startedAt: string; firstMessage: string }>();
    router = new Router({
      workspaceId: ws.id, roles: cfg.roles, limits: cfg.limits, log, createRunner,
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
    const ctx = { ws, log, router, roles: roleIds().join(",") };
    ctxs.set(id, ctx);
    return ctx;
  }

  const allWorkspaceIds = () => store.list().map(w => w.id);

  /** The role set changed (store install/uninstall): idle workspaces rebuild their team on next use. */
  function refreshIdleContexts() {
    for (const [id, c] of ctxs) if (!c.router.activeRunId()) ctxs.delete(id);
  }

  async function body(req: IncomingMessage): Promise<any> {
    let s = "";
    for await (const chunk of req) s += chunk;
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
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET,POST,PUT,DELETE", "access-control-allow-headers": "content-type" });
      return res.end();
    }
    if ((m === "POST" || m === "PUT" || m === "DELETE") && !(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "content-type must be application/json");
    if (m === "GET" && (url.pathname === "/" || url.pathname.startsWith("/ui/") || url.pathname === "/vendor/marked.js")) {
      const file = url.pathname === "/" ? join(UI_DIR, "index.html")
        : url.pathname === "/vendor/marked.js" ? MARKED
        : uiFile(url.pathname.slice("/ui/".length));
      if (!file || !existsSync(file)) throw new HttpError(404, "not found");
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
      const ctx = ctxFor(parts[1]);
      if (m === "GET" && parts[2] === "runs") return json(200, store.runs(ctx.ws));
      if (m === "GET" && parts[2] === "config") return json(200, store.config(ctx.ws));
      if (m === "GET" && parts[2] === "approvals") return json(200, ctx.router.pendingApprovals());
      if (m === "POST" && parts[2] === "messages") {
        const b = await body(req);
        if (typeof b.text !== "string" || !b.text.trim()) throw new HttpError(400, "text is required");
        return json(200, ctx.router.sendUserMessage(b.text));
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
      const status = e instanceof HttpError || e instanceof StoreError ? e.status : 500;
      if (!res.headersSent) res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); // EADDRINUSE etc. reach the caller instead of crashing the process
    server.listen(o.port ?? PORT, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
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
