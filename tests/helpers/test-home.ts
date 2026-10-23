import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.AGENT_COMPANY_HOME) {
  const tempHome = mkdtempSync(join(tmpdir(), "agent-company-test-home-"));
  process.env.AGENT_COMPANY_HOME = tempHome;

  process.on("exit", () => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on process exit
    }
  });
}
