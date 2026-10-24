// `agent-company` command: start the app, diagnose the setup, chat in the terminal, import an old setup.
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Args {
  cmd: "start" | "doctor" | "chat" | "import" | "shortcut" | "help" | "version";
  port?: number;
  home?: string;
  open: boolean;
  rest: string[];
  error?: string;
}

const COMMANDS = new Set(["start", "doctor", "chat", "import", "shortcut", "help", "version"]);

export function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: "start", open: true, rest: [] };
  const fail = (error: string): Args => ({ cmd: "help", open: true, rest: [], error });
  let i = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    if (!COMMANDS.has(argv[0])) return fail(`unknown command ${argv[0]}`);
    a.cmd = argv[0] as Args["cmd"];
    i = 1;
  }
  if (a.cmd === "chat" || a.cmd === "import" || a.cmd === "shortcut") { a.rest = argv.slice(i); return a; }
  for (; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--port") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0 || n > 65535) return fail("--port needs a number");
      a.port = n;
    } else if (v === "--home") a.home = argv[++i];
    else if (v === "--no-open") a.open = false;
    else if (v === "--version" || v === "-v") a.cmd = "version";
    else if (v === "--help" || v === "-h") a.cmd = "help";
    else return fail(`unknown option ${v}`);
  }
  return a;
}

const HELP = `Agent Company — an AI team in a pixel office.

Usage:
  agent-company [start] [--port <n>] [--no-open] [--home <dir>]   start the app and open the browser
  agent-company shortcut [--desktop] [--start-menu]             create desktop/start menu shortcut
  agent-company doctor                                          check Node, settings and providers
  agent-company chat <workspace-folder> [name]                  chat with the Manager in the terminal
  agent-company import --from-pi-runtime <dir> [--workspaces <file>]
                                                                move an older local setup into the app
  agent-company --version | --help

Settings, API keys and installed roles live in ~/.agent-company (or --home / AGENT_COMPANY_HOME).`;

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args as string[], { detached: true, stdio: "ignore" }).on("error", () => {}).unref(); } catch { /* no browser: the URL is printed */ }
}

async function doctor(): Promise<number> {
  const { VERSION } = await import("./config.ts");
  const { ensureHome, homePaths } = await import("./home.ts");
  const { loadConfig, modelFor } = await import("./settings.ts");
  const { testProvider } = await import("./providers.ts");
  const { searchBackend } = await import("./web.ts");
  const line = (ok: boolean | "warn", text: string) => console.log(`${ok === true ? "✔" : ok === "warn" ? "!" : "✖"} ${text}`);
  let failed = 0;
  line(true, `Agent Company ${VERSION}, Node ${process.versions.node}`);
  const p = homePaths();
  try { ensureHome(); accessSync(p.home, constants.W_OK); line(true, `app home: ${p.home}`); }
  catch (e) { line(false, `app home not writable: ${p.home} (${(e as Error).message})`); failed++; }
  const cfg = loadConfig();
  const ref = modelFor(cfg, "manager");
  if (!ref) {
    line("warn", "chưa cấu hình model — chạy `agent-company`, rồi nhập endpoint URL và API key ở màn hình Thiết lập");
  } else {
    const provider = cfg.providers.find(x => x.id === ref.provider)!;
    const r = await testProvider(provider, ref.model);
    if (r.ok) line(true, `${provider.name} / ${ref.model}: trả lời sau ${r.ms} ms`);
    else line("warn", `${provider.name} / ${ref.model}: ${r.error}`);
  }
  const backend = searchBackend(cfg);
  line(backend === "none" ? "warn" : true, `tìm kiếm web: ${backend === "none" ? "chưa cấu hình (Cài đặt → Tìm kiếm)" : backend}`);
  return failed ? 1 : 0;
}

/** One-time move of the author's earlier setup (portable pi runtime + repo data/) into the app home. */
async function importOld(rest: string[]): Promise<number> {
  const opt = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const from = opt("--from-pi-runtime");
  if (!from) { console.error("usage: agent-company import --from-pi-runtime <dir> [--workspaces <file>]"); return 1; }
  const { ensureHome, homePaths } = await import("./home.ts");
  const { loadConfig, saveConfig, writePiModels } = await import("./settings.ts");
  const { installRole, resolveCatalogBase, storeState } = await import("./store.ts");
  ensureHome();
  const models = JSON.parse(readFileSync(join(from, "agent", "models.json"), "utf8"));
  const cfg = loadConfig();
  for (const [id, prov] of Object.entries<any>(models.providers ?? {})) {
    if (cfg.providers.some(p => p.id === id)) continue;
    cfg.providers.push({
      id, name: id === "omniroute" ? "OmniRoute" : id, api: prov.api ?? "openai-completions", baseUrl: prov.baseUrl, apiKey: prov.apiKey ?? "",
      search: id === "omniroute" ? "google_search" : "none",
    });
    if (!cfg.defaultModel && prov.models?.[0]?.id) cfg.defaultModel = { provider: id, model: prov.models[0].id };
  }
  saveConfig(cfg);
  writePiModels(cfg);
  console.log(`✔ providers: ${cfg.providers.map(p => p.id).join(", ")}; default model ${cfg.defaultModel?.provider}/${cfg.defaultModel?.model}`);
  const base = await resolveCatalogBase();
  for (const r of (await storeState(base)).roles) {
    if (r.installed === false) { await installRole(r.id, base); console.log(`✔ installed role ${r.id}`); }
  }
  const wsFile = opt("--workspaces");
  if (wsFile && existsSync(wsFile)) {
    const target = homePaths().workspaces;
    const current: any[] = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : [];
    const incoming: any[] = JSON.parse(readFileSync(resolve(wsFile), "utf8"));
    const merged = [...current, ...incoming.filter(w => !current.some(c => c.id === w.id))];
    writeFileSync(target, JSON.stringify(merged, null, 2));
    console.log(`✔ workspaces: ${merged.length}`);
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.home) process.env.AGENT_COMPANY_HOME = resolve(args.home);
  if (args.cmd === "help") {
    if (args.error) console.error(`error: ${args.error}\n`);
    console.log(HELP);
    return args.error ? 1 : 0;
  }
  if (args.cmd === "version") { console.log((await import("./config.ts")).VERSION); return 0; }
  if (args.cmd === "shortcut") {
    const { runShortcutCommand } = await import("./launcher.ts");
    return runShortcutCommand(args.rest);
  }
  if (args.cmd === "doctor") return doctor();
  if (args.cmd === "import") return importOld(args.rest);
  if (args.cmd === "chat") {
    const [folder, name] = args.rest;
    if (!folder) { console.error("usage: agent-company chat <workspace-folder> [name]"); return 1; }
    const { loadConfig } = await import("./settings.ts");
    const { PORT } = await import("./config.ts");
    await (await import("./cli.ts")).runChat(folder, name, process.env.COMPANY_URL ?? `http://127.0.0.1:${loadConfig().port ?? PORT}`);
    return 0;
  }
  const { PORT } = await import("./config.ts");
  const { ensureHome } = await import("./home.ts");
  const { loadConfig } = await import("./settings.ts");
  const { startServer } = await import("./server.ts");
  ensureHome();
  const port = args.port ?? loadConfig().port ?? PORT;
  let srv: Awaited<ReturnType<typeof startServer>>;
  try { srv = await startServer({ port }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    const url = `http://127.0.0.1:${port}`;
    const running = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()).then(h => !!h?.version).catch(() => false);
    if (!running) {
      console.error(`Cổng ${port} đang bị chương trình khác dùng. Chạy với cổng khác, ví dụ: agent-company --port ${port + 1}`);
      return 1;
    }
    console.log(`Agent Company đã chạy sẵn: ${url}`);
    if (args.open) openBrowser(url);
    return 0;
  }
  console.log(`Agent Company đang chạy: ${srv.url}  (Ctrl+C để dừng)`);
  if (args.open) openBrowser(srv.url);
  const stop = () => { srv.close().then(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return new Promise<number>(() => {}); // keep serving
}

// `node src/main.ts …` from a checkout (npm start); the installed command goes through bin/agent-company.js
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
