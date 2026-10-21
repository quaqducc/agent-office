import { join } from "node:path";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { ensureHome, homePaths } from "./home.ts";
import { loadConfig, modelFor, piModelsJson, writePiModels } from "./settings.ts";
import { assemblePrompt, loadRole, skillDir } from "./library.ts";
import { makeTools, type ResearchState } from "./tools.ts";
import { checkToolCall } from "./guard.ts";
import type { Router, RunnerFactory } from "./router.ts";
import type { TeamEventType } from "./types.ts";

const ORCHESTRATION_TOOLS = new Set(["handoff", "checkpoint", "reply_checkpoint"]);

type Mapped = { type: TeamEventType; data: Record<string, unknown> };

/** Translate one pi session event into zero or more team events. */
export function mapPiEvent(e: any): Mapped[] {
  switch (e?.type) {
    case "message_update":
      return e.assistantMessageEvent?.type === "text_delta" ? [{ type: "message_delta", data: { delta: e.assistantMessageEvent.delta } }] : [];
    case "message_end": {
      const m = e.message;
      if (m?.role !== "assistant") return [];
      const text = (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      const out: Mapped[] = [];
      if (text) out.push({ type: "message", data: { text } });
      if (m.usage) out.push({ type: "usage", data: { tokens: m.usage.totalTokens ?? 0, input: m.usage.input ?? 0, output: m.usage.output ?? 0 } });
      return out;
    }
    case "tool_execution_start":
      return ORCHESTRATION_TOOLS.has(e.toolName) ? [] : [{ type: "tool_call", data: { tool: e.toolName, toolCallId: e.toolCallId, args: e.args } }];
    case "tool_execution_end": {
      if (ORCHESTRATION_TOOLS.has(e.toolName)) return [];
      const preview = (e.result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").slice(0, 300);
      return [{ type: "tool_result", data: { tool: e.toolName, toolCallId: e.toolCallId, ok: !e.isError, preview } }];
    }
    default:
      return [];
  }
}

/** Text of the reply to the latest prompt; throws when pi ended it as aborted/error (pi does not throw itself). */
export function finalAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") break;
    if (m?.role !== "assistant") continue;
    if (m.stopReason === "aborted" || m.stopReason === "error") throw new Error(m.errorMessage ?? m.stopReason);
    return (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  }
  throw new Error("no assistant reply to the last prompt");
}

/** Thrown when no model is configured for a role: the user must finish setup first. */
export class NoModelError extends Error {
  constructor() { super("Chưa cấu hình model — mở Cài đặt (biểu tượng bánh răng) để thêm endpoint, API key và chọn model."); }
}

const runtimes = new Map<string, Promise<ModelRuntime>>();

/** The role's model from settings; regenerates pi's models.json when the settings changed. */
export async function resolveModel(role: string): Promise<{ runtime: ModelRuntime; model: any; key: string }> {
  const cfg = loadConfig();
  const ref = modelFor(cfg, role);
  if (!ref) throw new NoModelError();
  ensureHome();
  const p = homePaths();
  const json = piModelsJson(cfg);
  if (!existsSync(p.piModels) || readFileSync(p.piModels, "utf8") !== json) writePiModels(cfg, p.piModels);
  const key = createHash("sha256").update(p.piModels + json).digest("hex");
  let rt = runtimes.get(key);
  if (!rt) {
    rt = ModelRuntime.create({ authPath: join(p.pi, "auth.json"), modelsPath: p.piModels });
    rt.catch(() => runtimes.delete(key)); // never cache a failed runtime
    runtimes.set(key, rt);
  }
  const runtime = await rt;
  const model = runtime.getModel(ref.provider, ref.model);
  if (!model) throw new Error(`model "${ref.provider}/${ref.model}" không có trong cấu hình — kiểm tra Cài đặt`);
  return { runtime, model, key: `${key}:${ref.provider}/${ref.model}` };
}

/** Create the pi session for one role in one workspace (persistent per-role history). */
export async function buildRoleSession(o: {
  role: string; workspacePath: string; router: () => Router; research?: ResearchState;
  resolved?: { runtime: ModelRuntime; model: any };
}): Promise<AgentSession> {
  const role = loadRole(o.role);
  const cwd = o.workspacePath;
  const { runtime: rt, model } = o.resolved ?? await resolveModel(o.role);
  const agentDir = homePaths().pi;
  const loader = new DefaultResourceLoader({
    cwd, agentDir,
    noSkills: true,
    additionalSkillPaths: role.skills.map(s => skillDir(s)).filter((d): d is string => !!d),
    noExtensions: true,
    // Workspace fence: block file/shell access outside the workspace and to .company/.
    extensionFactories: [pi => {
      pi.on("tool_call", (e: any) => {
        const r = checkToolCall(e.toolName, e.input, cwd);
        return r.block ? { block: true, reason: r.reason } : undefined;
      });
    }],
    noPromptTemplates: true,
    appendSystemPrompt: [assemblePrompt(o.role, "orchestrator")],
  });
  await loader.reload();
  const customTools = makeTools(o.role, o.router, o.research);
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime: rt, model,
    // Built-in and research tools come from the role file; orchestration tools are always on.
    // "web_search" was renamed (gateways such as OmniRoute/Antigravity and Anthropic reserve that name)
    tools: [...role.tools.map(t => (t === "web_search" ? "internet_search" : t)),
      ...customTools.map(t => t.name).filter(n => ["handoff", "checkpoint", "reply_checkpoint"].includes(n))],
    customTools,
    resourceLoader: loader,
    sessionManager: SessionManager.continueRecent(cwd, join(cwd, ".company", "sessions", o.role)),
  });
  return session;
}

export function createPiRunnerFactory(o: { workspacePath: string; router: () => Router }): RunnerFactory {
  return async (role, hooks) => {
    const research: ResearchState = { searched: false, prompt: "" };
    // The session is built lazily and rebuilt when the role's model or the provider settings change;
    // its conversation history lives on disk, so a rebuild keeps it.
    let session: AgentSession | undefined;
    let sessionKey = "";
    return {
      async run(text) {
        const resolved = await resolveModel(role);
        if (!session || sessionKey !== resolved.key) {
          session?.dispose();
          session = await buildRoleSession({ role, workspacePath: o.workspacePath, router: o.router, research, resolved });
          session.subscribe(e => { for (const m of mapPiEvent(e)) hooks.emit(m.type, m.data); });
          sessionKey = resolved.key;
        }
        research.searched = false;
        research.prompt = text;
        await session.prompt(text);
        return finalAssistantText(session.messages);
      },
      abort: async () => { await session?.abort(); },
      dispose: () => session?.dispose(),
    };
  };
}
