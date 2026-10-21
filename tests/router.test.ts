import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRouter, idleWithin, sleep, never } from "./helpers/fake-runner.ts";
import type { Router } from "../src/router.ts";
import type { HandoffArgs } from "../src/types.ts";

const h = (to: string, goal = "do it"): HandoffArgs => ({ to, goal, inputs: "-", expected_output: "-" });
const types = (log: { eventsOf(r: string): { type: string }[] }, runId: string) => log.eventsOf(runId).map(e => e.type);

test("user message runs manager and finishes run", async () => {
  const { router, log } = makeRouter(async () => "xin chào");
  const { runId } = router.sendUserMessage("hi");
  await idleWithin(router);
  const t = types(log, runId);
  for (const x of ["run_started", "user_message", "task_created", "manager_reply", "run_finished"]) assert.ok(t.includes(x), x);
  const fin = log.eventsOf(runId).find(e => e.type === "run_finished")!;
  assert.equal(fin.data.status, "done");
  assert.equal(router.activeRunId(), undefined);
});

test("manager handoff is non-blocking and result returns to manager", async () => {
  let router!: Router;
  const managerInputs: string[] = [];
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") {
      managerInputs.push(text);
      if (text.startsWith("User:")) {
        const r = await router.handoff("manager", h("brainstormer"));
        assert.match(r, /^Task \S+ queued for brainstormer/);
        return "delegated";
      }
      return "final";
    }
    return "ideas";
  }));
  router.sendUserMessage("idea please");
  await idleWithin(router);
  assert.equal(managerInputs.length, 2);
  assert.match(managerInputs[1], /from brainstormer finished \(done\):\nideas/);
});

test("peer handoff blocks and returns child result", async () => {
  let router!: Router;
  let devFinal = "";
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") { devFinal = await router.handoff("developer", h("reviewer")); return "dev done"; }
    return "LGTM";
  }));
  router.sendUserMessage("build");
  await idleWithin(router);
  assert.match(devFinal, /^Result from reviewer \(task \S+\):\nLGTM/);
});

test("queues work for a busy role", async () => {
  let router!: Router;
  let criticActive = 0, criticPeak = 0;
  const results: string[] = [];
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") {
      if (!text.startsWith("User:")) return "ok";
      await router.handoff("manager", h("developer"));
      await router.handoff("manager", h("planner"));
      return "ok";
    }
    if (role === "developer" || role === "planner") { results.push(await router.handoff(role, h("critic"))); return "x"; }
    if (role === "critic") { criticPeak = Math.max(criticPeak, ++criticActive); await sleep(20); criticActive--; return "critique"; }
    return "";
  }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.equal(criticPeak, 1);
  assert.equal(results.length, 2);
  assert.ok(results.every(r => r.includes("critique")));
});

test("respects maxConcurrent", async () => {
  let router!: Router;
  let active = 0, peak = 0;
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") {
      if (!text.startsWith("User:")) return "ok";
      for (const r of ["developer", "planner", "architect"]) await router.handoff("manager", h(r));
      return "ok";
    }
    peak = Math.max(peak, ++active); await sleep(30); active--; return "done";
  }, { maxConcurrent: 2 }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.equal(peak, 2);
});

test("blocked caller releases its slot", async () => {
  let router!: Router;
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") return router.handoff("developer", h("reviewer"));
    return "LGTM";
  }, { maxConcurrent: 1 }));
  router.sendUserMessage("go");
  await idleWithin(router);
});

test("rejects unknown role, handoff to manager, and self handoff", async () => {
  let router!: Router;
  const got: string[] = [];
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    for (const to of ["nobody", "manager", "developer"]) got.push(await router.handoff("developer", h(to)));
    return "done";
  }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.equal(got.length, 3);
  assert.match(got[0], /^ERROR: unknown role "nobody"/);
  assert.match(got[1], /^ERROR: .*checkpoint/);
  assert.match(got[2], /^ERROR: .*yourself/);
});

test("refuses cyclic handoff across branches", async () => {
  let router!: Router;
  let architectGot = "";
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") return router.handoff("developer", h("reviewer"));
    if (role === "reviewer") return router.handoff("reviewer", h("architect"));
    if (role === "architect") { architectGot = await router.handoff("architect", h("developer")); return "arch"; }
    return "";
  }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.match(architectGot, /^ERROR: .*developer.*waiting/);
});

test("enforces maxDepth", async () => {
  let router!: Router;
  let deepest = "";
  const { log, router: r } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") return router.handoff("developer", h("reviewer"));
    if (role === "reviewer") { deepest = await router.handoff("reviewer", h("architect")); return "rev"; }
    return "arch";
  }, { maxDepth: 2 });
  router = r;
  const { runId } = router.sendUserMessage("go");
  await idleWithin(router);
  assert.match(deepest, /^ERROR: .*depth/);
  assert.ok(log.eventsOf(runId).some(e => e.type === "limit_hit" && e.data.limit === "maxDepth"));
});

test("enforces pair rounds", async () => {
  let router!: Router;
  const got: string[] = [];
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") { for (let i = 0; i < 3; i++) got.push(await router.handoff("developer", h("reviewer"))); return "d"; }
    return "r";
  }, { maxPairRounds: 2 }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.ok(!got[0].startsWith("ERROR") && !got[1].startsWith("ERROR"));
  assert.match(got[2], /^ERROR: .*rounds/);
});

test("stopRun cancels and unblocks", async () => {
  let router!: Router;
  const { log, router: r } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") return router.handoff("developer", h("reviewer"));
    return never();
  });
  router = r;
  const { runId } = router.sendUserMessage("go");
  await sleep(30);
  await router.stopRun(runId);
  await idleWithin(router);
  const fin = log.eventsOf(runId).find(e => e.type === "run_finished")!;
  assert.equal(fin.data.status, "stopped");
  assert.ok(router.tasks(runId).every(t => t.status !== "queued" && t.status !== "running"));
  assert.ok(router.tasks(runId).some(t => t.status === "cancelled"));
});

test("parallel handoffs in one turn don't leak slots (3 runs in a row)", async () => {
  let router!: Router;
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") {
      const [a, b] = await Promise.all([router.handoff("developer", h("reviewer")), router.handoff("developer", h("critic"))]);
      return a + b;
    }
    return "fine";
  }, { maxConcurrent: 1 }));
  for (let i = 0; i < 3; i++) { router.sendUserMessage(`go ${i}`); await idleWithin(router); }
});

test("stop does not start work that was waiting for a slot", async () => {
  let router!: Router;
  let plannerRan = false;
  const { router: r } = makeRouter(async (role, text) => {
    if (role === "manager") {
      if (text.startsWith("User:")) { await router.handoff("manager", h("developer")); await router.handoff("manager", h("planner")); }
      return "ok";
    }
    if (role === "planner") { plannerRan = true; return "p"; }
    return never();
  }, { maxConcurrent: 1 });
  router = r;
  const { runId } = router.sendUserMessage("go");
  await sleep(30);
  await router.stopRun(runId);
  await sleep(30);
  assert.equal(plannerRan, false);
  await idleWithin(router);
});

test("manager handoffs made while handling a notice hang under the run's root task", async () => {
  let router!: Router;
  const { router: r } = makeRouter(async (role, text) => {
    if (role !== "manager") return "done";
    if (text.startsWith("User:")) { await router.handoff("manager", h("brainstormer")); return "ok"; }
    if (text.includes("from brainstormer finished")) { await router.handoff("manager", h("critic")); return "ok"; }
    return "final";
  });
  router = r;
  const { runId } = router.sendUserMessage("go");
  await idleWithin(router);
  const tasks = router.tasks(runId);
  const root = tasks.find(t => t.from === "user")!;
  const critic = tasks.find(t => t.to === "critic")!;
  assert.equal(critic.parentTaskId, root.id);
  assert.equal(critic.depth, 1);
});
