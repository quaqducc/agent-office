export interface CommandEntry {
  id: string;
  runId?: string;
  role: string;
  command: string;
  tool: "bash" | "powershell";
  timestamp: string;
  durationMs?: number;
  ok?: boolean;
  exitCode?: number;
  preview: string;
  output: string;
}

const MAX_OUTPUT_BYTES = 50000;

export function extractCommands(events: any[]): CommandEntry[] {
  const commandsMap = new Map<string, CommandEntry>();
  const order: string[] = [];

  for (const e of events) {
    if (!e || typeof e !== "object") continue;

    if (e.type === "tool_call" && (e.data?.tool === "bash" || e.data?.tool === "powershell")) {
      const id = String(e.data.toolCallId || e.seq || Math.random());
      const cmdText = String(e.data.args?.command || "").trim();
      const entry: CommandEntry = {
        id,
        runId: e.runId,
        role: e.role || "unknown",
        command: cmdText,
        tool: e.data.tool,
        timestamp: e.ts || new Date().toISOString(),
        preview: "",
        output: "",
      };
      commandsMap.set(id, entry);
      order.push(id);
    } else if (e.type === "tool_result" && (e.data?.tool === "bash" || e.data?.tool === "powershell")) {
      const id = String(e.data.toolCallId || "");
      const entry = commandsMap.get(id);
      if (entry) {
        entry.ok = e.data.ok;
        if (e.data.exitCode != null) {
          entry.exitCode = Number(e.data.exitCode);
        } else if (e.data.ok !== undefined) {
          entry.exitCode = e.data.ok ? 0 : 1;
        }

        let rawOutput = String(e.data.output || e.data.preview || "");
        if (rawOutput.length > MAX_OUTPUT_BYTES) {
          rawOutput = rawOutput.slice(0, MAX_OUTPUT_BYTES) + "\n...[truncated at 50KB]";
        }
        entry.output = rawOutput;
        entry.preview = String(e.data.preview || rawOutput.slice(0, 300));

        if (e.ts && entry.timestamp) {
          const start = Date.parse(entry.timestamp);
          const end = Date.parse(e.ts);
          if (!isNaN(start) && !isNaN(end) && end >= start) {
            entry.durationMs = end - start;
          }
        }
      }
    }
  }

  return order.map((id) => commandsMap.get(id)!);
}
