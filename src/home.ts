// App home: config, keys, workspace registry, store-installed roles and pi's agent dir.
// Separate from ~/.claude and ~/.pi on purpose.
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function appHome(): string {
  return process.env.AGENT_COMPANY_HOME || join(homedir(), ".agent-company");
}

export function homePaths(home = appHome()) {
  return {
    home,
    config: join(home, "config.json"),
    workspaces: join(home, "workspaces.json"),
    library: join(home, "library"),
    installed: join(home, "library", "installed.json"),
    pi: join(home, "pi"),
    piModels: join(home, "pi", "models.json"),
    piSettings: join(home, "pi", "settings.json"),
  };
}

export function ensureHome(home = appHome()): void {
  const p = homePaths(home);
  for (const d of [p.home, p.library, join(p.library, "roles"), join(p.library, "skills"), p.pi]) mkdirSync(d, { recursive: true });
  if (process.platform !== "win32") chmodSync(p.home, 0o700);
}
