import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Router } from "./router.ts";
import type { CheckpointArgs, HandoffArgs } from "./types.ts";
import { loadConfig } from "./settings.ts";
import { searchBackend, searchPageQuery, webFetch, webSearch } from "./web.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

/** Per-prompt research state: web_fetch needs a prior internet_search unless the URL came with the task. */
export interface ResearchState { searched: boolean; prompt: string }

/** Orchestration tools for one role. `router` is a getter: runners are created before the router exists. */
export function makeTools(role: string, router: () => Router, research: ResearchState = { searched: false, prompt: "" }): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "handoff",
      label: "Hand off",
      description: "Delegate work to another team role and get its result. Not for the manager role (use checkpoint).",
      promptSnippet: "handoff: delegate a task to another role (to, goal, inputs, expected_output, checkpoints)",
      parameters: Type.Object({
        to: Type.String({ description: "Target role id, e.g. critic, developer" }),
        goal: Type.String({ description: "One-line goal" }),
        inputs: Type.String({ description: "Facts, files and context the role needs" }),
        expected_output: Type.String({ description: "What to return" }),
        checkpoints: Type.Optional(Type.Array(Type.String(), { description: "Milestones the receiver must report to the Manager" })),
      }),
      execute: async (_id, params) => text(await router().handoff(role, params as HandoffArgs)),
    },
    {
      name: "checkpoint",
      label: "Checkpoint",
      description: "Report a milestone to the Manager with what you did since the last checkpoint. " +
        "Set approval_required + action before any real-world action (only the user approves). " +
        "Set needs_decision when blocked or in disagreement.",
      promptSnippet: "checkpoint: report a milestone / ask for a decision / request user approval",
      parameters: Type.Object({
        title: Type.String(),
        summary: Type.String({ description: "What was done since the previous checkpoint, and why" }),
        decisions: Type.Optional(Type.String()),
        open_issues: Type.Optional(Type.String()),
        needs_decision: Type.Optional(Type.Boolean()),
        approval_required: Type.Optional(Type.Boolean()),
        action: Type.Optional(Type.String({ description: "Exact real-world action: amount, recipient, target, content" })),
      }),
      execute: async (_id, params) => text(await router().checkpoint(role, params as CheckpointArgs)),
    },
  ];
  // Research tools exist for every role; a role only gets them if its role file lists them in `tools`.
  tools.push(
    {
      name: "internet_search",
      label: "Web search",
      description: "Search the web (Google) for current facts. Returns a short answer and the source URLs. " +
        "Verify important claims by opening a source with web_fetch.",
      promptSnippet: "internet_search: search the web (Google) for current facts with sources",
      parameters: Type.Object({ query: Type.String({ description: "What to look up; include names, versions, dates" }) }),
      execute: async (_id, params) => {
        research.searched = true;
        return text(await webSearch((params as { query: string }).query));
      },
    },
    {
      name: "web_fetch",
      label: "Fetch web page",
      description: "Read a public web page (http/https) as text, to verify a source or read documentation.",
      promptSnippet: "web_fetch: read a public web page as text",
      parameters: Type.Object({
        url: Type.String(),
        max_chars: Type.Optional(Type.Number({ description: "Default 20000" })),
      }),
      execute: async (_id, params) => {
        const p = params as { url: string; max_chars?: number };
        // Models often "search" by opening a search engine's result page: run the configured web search
        // instead (scraped result pages are blocked or empty); with no search configured, read the page.
        const query = searchPageQuery(p.url);
        if (query !== undefined) {
          research.searched = true;
          if (searchBackend(loadConfig()) !== "none") return text(await webSearch(query));
        }
        // Guessed URLs only confirm what the model already believes: search first, then open what it found.
        if (!research.searched && !research.prompt.includes(p.url.replace(/\/$/, ""))) {
          return text("ERROR: search first. Call internet_search with the exact term from the task (in quotes), " +
            "then open the sources it returns. Do not open URLs you guessed.");
        }
        return text(await webFetch(p.url, { maxChars: p.max_chars }));
      },
    },
  );
  if (role === "manager") {
    tools.push({
      name: "reply_checkpoint",
      label: "Reply to checkpoint",
      description: "Answer a decision checkpoint from a role. Cannot approve real-world actions.",
      promptSnippet: "reply_checkpoint: answer a role's decision checkpoint",
      parameters: Type.Object({ checkpoint_id: Type.String(), answer: Type.String() }),
      execute: async (_id, params) => {
        const p = params as { checkpoint_id: string; answer: string };
        return text(router().replyCheckpoint(p.checkpoint_id, p.answer));
      },
    });
  }
  return tools;
}
