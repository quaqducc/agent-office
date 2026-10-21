import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/event-log.ts";
import { Router, type RunnerFactory, type RunnerHooks } from "../../src/router.ts";
import { DEFAULT_LIMITS } from "../../src/config.ts";
import type { Limits } from "../../src/types.ts";

export type Script = (role: string, text: string, hooks: RunnerHooks) => Promise<string>;

/** Runner whose behavior is a test script; abort() rejects the in-flight run. */
export function fakeFactory(script: Script): RunnerFactory {
  return async (role, hooks) => {
    let rejectCurrent: ((e: Error) => void) | undefined;
    return {
      run: (text: string) => new Promise<string>((resolve, reject) => {
        rejectCurrent = reject;
        script(role, text, hooks).then(resolve, reject);
      }),
      abort: async () => rejectCurrent?.(new Error("aborted")),
      dispose() {},
    };
  };
}

export const ROLES = ["manager", "brainstormer", "critic", "developer", "reviewer", "architect", "planner", "product-manager"];

export function makeRouter(script: Script, limits: Partial<Limits> = {}, extra: { now?: () => number } = {}) {
  const log = new EventLog(mkdtempSync(join(tmpdir(), "router-")), "ws");
  const router = new Router({
    workspaceId: "ws", roles: ROLES, limits: { ...DEFAULT_LIMITS, ...limits }, log,
    createRunner: fakeFactory(script), ...extra,
  });
  return { router, log };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const never = () => new Promise<string>(() => {});

export async function idleWithin(router: Router, ms = 2000) {
  const t = sleep(ms).then(() => { throw new Error(`router not idle after ${ms}ms`); });
  await Promise.race([router.whenIdle(), t]);
}
