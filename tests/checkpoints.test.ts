import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRouter, idleWithin, sleep, never } from "./helpers/fake-runner.ts";
import type { Router } from "../src/router.ts";
import type { HandoffArgs } from "../src/types.ts";

const h = (to: string): HandoffArgs => ({ to, goal: "work", inputs: "-", expected_output: "-" });
const cpId = (text: string) => /CHECKPOINT (\S+)/.exec(text)?.[1] ?? /APPROVAL PENDING (\S+)/.exec(text)?.[1] ?? "";

test("plain checkpoint reaches manager with trail", async () => {
  let router!: Router;
  let devGot = "";
  const managerInputs: string[] = [];
  ({ router } = makeRouter(async (role, text, hooks) => {
    if (role === "manager") { managerInputs.push(text); if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    hooks.emit("tool_call", { tool: "write", args: { path: "a.ts" } });
    devGot = await router.checkpoint("developer", { title: "Draft ready", summary: "wrote a.ts" });
    return "done";
  }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.match(devGot, /^Checkpoint \S+ delivered to manager/);
  const cp = managerInputs.find(t => t.startsWith("CHECKPOINT"))!;
  assert.ok(cp.includes("Draft ready") && cp.includes("wrote a.ts") && cp.includes("a.ts"));
});

test("decision checkpoint blocks until manager replies", async () => {
  let router!: Router;
  let devGot = "";
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") {
      if (text.startsWith("User:")) await router.handoff("manager", h("developer"));
      else if (text.startsWith("CHECKPOINT")) router.replyCheckpoint(cpId(text), "go with A");
      return "ok";
    }
    devGot = await router.checkpoint("developer", { title: "A or B?", summary: "two options", needs_decision: true });
    return "done";
  }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.equal(devGot, "Manager decision: go with A");
});

test("approval goes to user, not manager", async () => {
  let router!: Router;
  let devGot = "", managerTry = "", managerSaw = "";
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") {
      if (text.startsWith("User:")) await router.handoff("manager", h("developer"));
      else if (text.startsWith("APPROVAL PENDING")) { managerSaw = text; managerTry = router.replyCheckpoint(cpId(text), "approved!"); }
      return "ok";
    }
    devGot = await router.checkpoint("developer", { title: "Buy", summary: "need account", approval_required: true, action: "Pay 50,000đ to shop X" });
    return "done";
  }));
  router.sendUserMessage("go");
  while (!router.pendingApprovals().length) await sleep(5);
  await sleep(20);
  assert.match(managerSaw, /cannot approve/);
  assert.match(managerTry, /^ERROR/);
  const p = router.pendingApprovals()[0];
  assert.equal(p.action, "Pay 50,000đ to shop X");
  assert.equal(router.replyApproval(p.id, "approve", "ok"), true);
  await idleWithin(router);
  assert.equal(devGot, "User decision: approve. ok");
});

test("approval requires action", async () => {
  let router!: Router;
  let devGot = "";
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    devGot = await router.checkpoint("developer", { title: "Buy", summary: "x", approval_required: true });
    return "done";
  }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.match(devGot, /^ERROR: approval_required needs an exact action/);
});

test("stop rejects pending approval and cancels tasks", async () => {
  let router!: Router;
  let devGot = "";
  const { log, router: r } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    devGot = await router.checkpoint("developer", { title: "Buy", summary: "x", approval_required: true, action: "pay" });
    return never();
  });
  router = r;
  const { runId } = router.sendUserMessage("go");
  while (!router.pendingApprovals().length) await sleep(5);
  await router.stopRun(runId);
  await idleWithin(router);
  assert.match(devGot, /reject/);
  assert.equal(router.pendingApprovals().length, 0);
  assert.equal(log.eventsOf(runId).find(e => e.type === "run_finished")!.data.status, "stopped");
});

test("task timeout counts active time only", async () => {
  let router!: Router;
  const { router: r } = makeRouter(async (role, text) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    if (role === "developer") return router.handoff("developer", h("reviewer"));
    await router.checkpoint("reviewer", { title: "ship?", summary: "x", approval_required: true, action: "deploy" });
    return "reviewed";
  }, { taskTimeoutMs: 150 });
  router = r;
  const { runId } = router.sendUserMessage("go");
  while (!router.pendingApprovals().length) await sleep(5);
  await sleep(300); // human wait: must not count
  router.replyApproval(router.pendingApprovals()[0].id, "approve");
  await idleWithin(router);
  assert.ok(router.tasks(runId).every(t => t.status === "done"), JSON.stringify(router.tasks(runId).map(t => [t.to, t.status])));
});

test("timeout aborts and reports", async () => {
  let router!: Router;
  const managerInputs: string[] = [];
  const { log, router: r } = makeRouter(async (role, text) => {
    if (role === "manager") { managerInputs.push(text); if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    return never();
  }, { taskTimeoutMs: 100 });
  router = r;
  const { runId } = router.sendUserMessage("go");
  await idleWithin(router);
  const dev = router.tasks(runId).find(t => t.to === "developer")!;
  assert.equal(dev.status, "failed");
  assert.match(dev.result ?? "", /timeout/);
  assert.ok(managerInputs.some(t => /developer finished \(failed\)/.test(t)));
  assert.ok(log.eventsOf(runId).some(e => e.type === "limit_hit" && e.data.limit === "taskTimeoutMs"));
});

test("budget stops run", async () => {
  let router!: Router;
  const { log, router: r } = makeRouter(async (role, text, hooks) => {
    if (role === "manager") { if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    hooks.emit("usage", { tokens: 100 });
    return never();
  }, { runTokenBudget: 50 });
  router = r;
  const { runId } = router.sendUserMessage("go");
  await idleWithin(router);
  assert.equal(log.eventsOf(runId).find(e => e.type === "run_finished")!.data.status, "budget_exceeded");
});

test("unanswered decision checkpoint is reminded once, then released with an error", async () => {
  let router!: Router;
  let devGot = "";
  const managerInputs: string[] = [];
  ({ router } = makeRouter(async (role, text) => {
    if (role === "manager") { managerInputs.push(text); if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "I think A is fine."; }
    devGot = await router.checkpoint("developer", { title: "A or B?", summary: "s", needs_decision: true });
    return "done";
  }));
  router.sendUserMessage("go");
  await idleWithin(router);
  assert.ok(managerInputs.some(t => t.startsWith("REMINDER")), "manager was reminded");
  assert.match(devGot, /^ERROR: manager did not answer/);
});

test("a task over its token cap is stopped and reported", async () => {
  let router!: Router;
  const managerInputs: string[] = [];
  const { log, router: r } = makeRouter(async (role, text, hooks) => {
    if (role === "manager") { managerInputs.push(text); if (text.startsWith("User:")) await router.handoff("manager", h("developer")); return "ok"; }
    for (let i = 0; i < 10; i++) { hooks.emit("usage", { tokens: 40 }); await sleep(5); }
    return never();
  }, { maxTaskTokens: 100 });
  router = r;
  const { runId } = router.sendUserMessage("go");
  await idleWithin(router);
  const dev = router.tasks(runId).find(t => t.to === "developer")!;
  assert.equal(dev.status, "failed");
  assert.match(dev.result ?? "", /token/);
  assert.ok(log.eventsOf(runId).some(e => e.type === "limit_hit" && e.data.limit === "maxTaskTokens"));
  assert.ok(managerInputs.some(t => /developer finished \(failed\)/.test(t)));
  assert.equal(log.eventsOf(runId).find(e => e.type === "run_finished")!.data.status, "done", "run continues; only the task stops");
});
