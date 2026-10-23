// Fence for role tools: read-only tools may read anywhere (knowledge lookup) except secrets and
// orchestration data; writes and shell commands stay inside the workspace.
// Defense in depth, not a sandbox — a determined shell command can still escape.
// ponytail: regex-based shell check; replace with a container/sandbox per role when one exists.
import { realpathSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { appHome } from "./home.ts";

type PathApi = typeof path.posix;

export interface GuardResult { block: boolean; reason?: string }

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

const advice = "Work only inside the workspace. If you need a file or information you do not have, " +
  "say so in your result and ask the requester (or call checkpoint with needs_decision) instead of searching elsewhere.";

/** Normalise a path for comparison: resolved, forward slashes, lower-case on Windows. */
function norm(api: PathApi, base: string, p: string): string {
  const isWin = api.sep === "\\";
  let q = p.replace(/^~(?=[\\/]|$)/, homedir());
  if (isWin) q = q.replace(/^\/([a-zA-Z])(?=\/|$)/, (_m, d: string) => `${d.toUpperCase()}:`); // MSYS /c/x → C:/x
  const full = api.resolve(base, q).replace(/\\/g, "/");
  return isWin ? full.toLowerCase() : full;
}

const inside = (full: string, root: string) => full === root || full.startsWith(root.endsWith("/") ? root : `${root}/`);

function within(api: PathApi, ws: string, p: string): { ok: boolean; why?: string } {
  if (/^~([\\/]|$)/.test(p)) return { ok: false, why: "the home directory" };
  const root = norm(api, ws, ".");
  const full = norm(api, ws, p);
  if (!inside(full, root)) return { ok: false, why: "outside the workspace" };
  if (inside(full, `${root}/.company`)) return { ok: false, why: "orchestration data (.company/)" };

  // Check real target if it exists
  const realP = real(api, ws, p);
  if (realP) {
    const realRoot = real(api, ws, ".") ?? root;
    const realRootNorm = norm(api, realRoot, ".");
    const realFull = norm(api, realP, ".");
    if (!inside(realFull, realRootNorm)) return { ok: false, why: "resolving outside the workspace" };
    if (inside(realFull, `${realRootNorm}/.company`)) return { ok: false, why: "orchestration data (.company/)" };
    const whyReal = secret(api, ws, realP);
    if (whyReal) return { ok: false, why: whyReal };
  }

  return { ok: true };
}

/** Credentials and keys: never readable, wherever they are. */
function secret(api: PathApi, ws: string, p: string): string | undefined {
  const isWin = api === path.win32 || (api === path && process.platform === "win32");

  // Check ADS streams and DOS 8.3 short names only on win32 for segments below workspace
  if (isWin) {
    let q = p.replace(/^~(?=[\\/]|$)/, homedir());
    const fullRaw = api.resolve(ws, q).replace(/\\/g, "/");
    const rootRaw = api.resolve(ws, ".").replace(/\\/g, "/");
    const rel = api.relative(rootRaw, fullRaw).replace(/\\/g, "/");
    if (!rel.startsWith("..") && !api.isAbsolute(rel)) {
      const segsBelowWs = rel.split("/").filter(Boolean);
      for (const seg of segsBelowWs) {
        if (seg.includes(":")) return "an alternate data stream";
        if (/^[A-Z0-9]{1,6}~[0-9]+(\.[A-Z0-9]{1,3})?$/i.test(seg)) return "a DOS 8.3 short name";
      }
    }
  }

  const full = norm(api, ws, p);
  const segs = full.split("/");

  const rawName = segs.at(-1) ?? "";
  const name = rawName.replace(/[.\s]+$/, "");
  if (segs.map(s => s.replace(/[.\s]+$/, "")).includes(".company")) return "orchestration data (.company/)";
  if (segs.map(s => s.replace(/[.\s]+$/, "")).includes(".git")) return "a secret (.git repository)";
  if (inside(full, norm(api, ws, appHome()))) return "a secret (Agent Company settings and API keys)";
  if (/^\.env(\.(?!example$|sample$|template$)[\w.-]+)?$/.test(name)) return "a secret (.env)";
  if (/\.(pem|key|pfx|p12)$/.test(name) || /^id_(rsa|ed25519|ecdsa|dsa)/.test(name)) return "a secret (key file)";
  if (segs.map(s => s.replace(/[.\s]+$/, "")).some(s => [".ssh", ".aws", ".claude", ".gnupg", ".docker", ".agent-company", ".kube"].includes(s)) || [".claude.json", ".npmrc", ".netrc", ".git-credentials", ".pypirc", "credentials.json"].includes(name)) {
    return "a secret (credentials directory)";
  }
  if (/\/pi-runtime\/agent(\/|$)/.test(full) || /\/\.config\/gcloud(\/|$)/.test(full)) return "a secret (model/API credentials)";
  return undefined;
}

/** Where a path really points (symlinks resolved) via nearest existing ancestor when on this machine. */
function real(api: PathApi, ws: string, p: string): string | undefined {
  if (api !== path) return undefined; // tests of the other platform's rules
  const resolved = api.resolve(ws, p.replace(/^~(?=[\\/]|$)/, homedir()));
  let checkPath = resolved;
  const tail: string[] = [];

  while (!existsSync(checkPath)) {
    const parent = api.dirname(checkPath);
    if (parent === checkPath) break;
    tail.unshift(api.basename(checkPath));
    checkPath = parent;
  }

  if (!existsSync(checkPath)) return undefined;
  try {
    const realAncestor = realpathSync(checkPath);
    return tail.length > 0 ? api.join(realAncestor, ...tail) : realAncestor;
  } catch {
    return undefined;
  }
}

const block = (what: string, why: string): GuardResult =>
  ({ block: true, reason: `Blocked: ${what} is ${why}. ${advice}` });

/** Decide whether a role's tool call may run. `workspace` is the role session's cwd. */
export function checkToolCall(tool: string, input: unknown, workspace: string, api: PathApi = path): GuardResult {
  const args = (input ?? {}) as Record<string, unknown>;
  const p = typeof args.path === "string" ? args.path : undefined;
  if (READ_TOOLS.has(tool)) {
    const target = p ?? ".";
    const glob = [args.glob, args.pattern].find(g => typeof g === "string" && /[\\/]/.test(g)) as string | undefined;
    for (const q of [target, real(api, workspace, target), ...(glob ? [`${target}/${glob}`] : [])]) {
      const why = q ? secret(api, workspace, q) : undefined;
      if (why) return block(`"${p ?? glob}"`, why);
    }
    // a recursive search over the home folder (or above it) would read the secrets inside it
    if (tool === "grep" && [homedir(), appHome()].some(h => inside(norm(api, workspace, h), norm(api, workspace, target)))) {
      return block(`"${target}"`, "a folder that contains your home directory and its secrets");
    }
    return { block: false };
  }
  if (WRITE_TOOLS.has(tool)) {
    if (p) {
      const r = within(api, workspace, p);
      if (!r.ok) return block(`"${p}"`, r.why!);
      const why = secret(api, workspace, p);
      if (why) return block(`"${p}"`, why);
    }
    return { block: false };
  }
  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(args.command ?? "");
    if (/\.company\b/i.test(cmd)) return block("this command", "touching orchestration data (.company/)");
    if (/(https?:\/\/|\b)(localhost|127\.0\.0\.1|::1|\[::1\]|0\.0\.0\.0)(:\d+)?\b/i.test(cmd)) {
      return block("this command", "accessing local loopback network or internal server");
    }
    if (/(^|[;&|(]\s*)(env|printenv|set)\s*($|[|;&>])|\benv:|\$env:|Get-ChildItem\s+env:/i.test(cmd)) {
      return block("this command", "reading environment variables (they hold secrets)");
    }
    if (/(^|[\s"'=(])~(?=[\\/\s"';&|)]|$)/.test(cmd)
      || /\$\{?(HOME|USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA)\b|\$env:(HOME|USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA)\b|%(HOME|USERPROFILE|HOMEPATH|HOMEDRIVE|APPDATA|LOCALAPPDATA)%/i.test(cmd)
      || /(^|[;&|(]\s*)(cd|chdir|Set-Location)\s*($|[;&|)])/i.test(cmd)) {
      return block("this command", "reaching into the home directory");
    }
    if (/(^|[\\/\s"'=(])\.(agent-company|ssh|aws|gnupg|claude|kube)\b|\.(claude\.json|npmrc|netrc|git-credentials|pypirc)\b|credentials\.json\b/i.test(cmd)) return block("this command", "touching a secrets folder");
    if (/(^|[\s"'=(\\/])\.\.[\\/]/.test(cmd)) return block("this command", "reaching outside the workspace via ..");
    const found = [
      ...cmd.matchAll(/(?<!\w)[A-Za-z]:[\\/](?![\\/])[^\s"'|&;<>]*/g),       // C:\x, D:/x (not the "s:" in https://)
      ...cmd.matchAll(/(?<![\w.:\-/\\])\/[A-Za-z0-9_.-]+\/[^\s"'|&;<>]*/g), // /c/x, /etc/x (two+ segments; not /c switches)
    ].map(m => {
      const q = m[0].replace(/[\\/]+$/, "") || m[0];
      return /^[A-Za-z]:$/.test(q) ? `${q}\\` : q; // "C:" alone would mean "cwd on C:", not the drive root
    });
    for (const q of found.filter(q => !/^\/dev\/(null|stdin|stdout|stderr|tty)$/.test(q))) {
      const r = within(api, workspace, q);
      if (!r.ok) return block(`"${q}"`, r.why!);
    }
    return { block: false };
  }
  return { block: false };
}
