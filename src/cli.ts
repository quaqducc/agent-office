// Terminal client: chat with the Manager and watch the team. Usage: agent-company chat <workspace-folder> [name]
import { createInterface } from "node:readline";
import { PORT } from "./config.ts";
import type { TeamEvent } from "./types.ts";

let BASE = process.env.COMPANY_URL ?? `http://127.0.0.1:${PORT}`;

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json() as any;
  if (!r.ok) throw new Error(data.error ?? r.statusText);
  return data;
}

const short = (v: unknown, n = 120) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + "…" : s; };
let currentRun: string | undefined;

function show(e: TeamEvent) {
  const d = e.data as Record<string, any>;
  const who = e.role ? `[${e.role}]` : "";
  switch (e.type) {
    case "run_started": currentRun = e.runId; return console.log(`\n=== run ${e.runId.slice(0, 8)} started ===`);
    case "run_finished": currentRun = undefined; return console.log(`=== run ${e.runId.slice(0, 8)} ${d.status} · ${d.usage?.tokens ?? 0} tokens ===\n`);
    case "manager_reply": return console.log(`\n[Manager] ${d.text}\n`);
    case "message": return e.role === "manager" ? undefined : console.log(`\n${who} ${d.text}\n`);
    case "task_created": return d.from === "user" ? undefined : console.log(`→ ${d.from} → ${d.to}: ${short(d.goal)} (task ${d.taskId})`);
    case "task_status": return d.status === "running" ? undefined : console.log(`· task ${e.taskId} (${e.role}) ${d.status}${d.reason ? `: ${short(d.reason)}` : ""}`);
    case "tool_call": return console.log(`  ${who} ⚙ ${d.tool} ${short(d.args, 100)}`);
    case "checkpoint": return console.log(`◆ CHECKPOINT ${who}${d.automatic ? " (auto)" : ""} ${d.title} — ${short(d.summary, 200)}`);
    case "approval_request": return console.log(`\n‼ APPROVAL NEEDED ${d.checkpointId} ${who}\n   action: ${d.action}\n   ${short(d.summary, 300)}\n   → /approve ${d.checkpointId} [note] | /reject ${d.checkpointId} [note] | /edit ${d.checkpointId} <note>\n`);
    case "checkpoint_reply": return console.log(`◇ ${d.checkpointId} answered by ${d.by}: ${d.decision ?? ""} ${short(d.answer ?? "")}`);
    case "limit_hit": return console.log(`⚠ limit ${d.limit}: ${d.message}`);
    case "error": return console.log(`✖ ${who} ${short(d.message, 300)}`);
  }
}

async function follow(workspaceId: string) {
  const res = await fetch(`${BASE}/events?workspace=${workspaceId}`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { console.log("(event stream closed)"); return; }
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find(l => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (line) show(JSON.parse(line.slice(6)));
    }
  }
}

/** Terminal client: chat with a workspace's Manager and follow the team's events. */
export async function runChat(folder: string, name?: string, baseUrl?: string): Promise<void> {
  if (baseUrl) BASE = baseUrl;
  const ws = await api("POST", "/workspaces", { path: folder, name });
  console.log(`Workspace ${ws.name} (${ws.id}) — ${ws.path}`);
  console.log("Type a message for the Manager. Commands: /approvals /approve /reject /edit /stop /quit");
  void follow(ws.id).catch(e => console.error("event stream error:", e.message));

  const rl = createInterface({ input: process.stdin });
  rl.on("line", async raw => {
    const line = raw.trim();
    if (!line) return;
    try {
      const [cmd, id, ...rest] = line.split(/\s+/);
      if (cmd === "/quit") process.exit(0);
      else if (cmd === "/stop") console.log(currentRun ? await api("POST", `/runs/${currentRun}/stop`) : "no active run");
      else if (cmd === "/approvals") console.log(await api("GET", `/workspaces/${ws.id}/approvals`));
      else if (cmd === "/approve" || cmd === "/reject" || cmd === "/edit") {
        await api("POST", `/checkpoints/${id}/reply`, { decision: cmd.slice(1), note: rest.join(" ") });
      } else if (cmd.startsWith("/")) console.log("unknown command");
      else await api("POST", `/workspaces/${ws.id}/messages`, { text: line });
    } catch (e) {
      console.log(`✖ ${(e as Error).message}`);
    }
  });
}
