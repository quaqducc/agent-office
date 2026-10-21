export interface Limits {
  maxDepth: number;
  maxPairRounds: number;
  maxConcurrent: number;
  /** Active model time only (excludes queue time, children, human waits). */
  taskTimeoutMs: number;
  runTokenBudget: number;
  /** Tokens one task may use before it is stopped (runaway loops, wandering). */
  maxTaskTokens: number;
}

export type TeamEventType =
  | "run_started" | "run_finished"
  | "task_created" | "task_status"
  | "message" | "message_delta"
  | "tool_call" | "tool_result"
  | "checkpoint" | "checkpoint_reply" | "approval_request"
  | "user_message" | "manager_reply"
  | "usage" | "limit_hit" | "error";

export interface TeamEvent {
  ts: string;
  seq: number;
  workspaceId: string;
  runId: string;
  taskId?: string;
  role?: string;
  type: TeamEventType;
  data: Record<string, unknown>;
}

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Task {
  id: string;
  runId: string;
  parentTaskId?: string;
  from: string;
  to: string;
  goal: string;
  inputs: string;
  expectedOutput: string;
  checkpoints: string[];
  status: TaskStatus;
  depth: number;
  createdAt: string;
  endedAt?: string;
  result?: string;
  activeMs: number;
  tokens: number;
}

export interface HandoffArgs {
  to: string;
  goal: string;
  inputs: string;
  expected_output: string;
  checkpoints?: string[];
}

export interface CheckpointArgs {
  title: string;
  summary: string;
  decisions?: string;
  open_issues?: string;
  needs_decision?: boolean;
  approval_required?: boolean;
  action?: string;
}

export interface Trail {
  handoffs: { from: string; to: string; goal: string; status: string }[];
  files: string[];
  commands: string[];
  errors: string[];
  tokens: number;
}
