import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Limits } from "./types.ts";
import { homePaths } from "./home.ts";

/** Package root: works from src/ (dev) and dist/ (installed). */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_LIBRARY = join(PACKAGE_ROOT, "library");
export const CATALOG_DIR = join(PACKAGE_ROOT, "catalog");
export const VERSION: string = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;

// Every process that loads pi must stay isolated and silent (also tests and the smoke run).
process.env.PI_CODING_AGENT_DIR ??= homePaths().pi;
process.env.PI_TELEMETRY ??= "0";

export const PORT = Number(process.env.COMPANY_PORT ?? 4317);

export const DEFAULT_LIMITS: Limits = {
  maxDepth: 4,
  maxPairRounds: 3,
  maxConcurrent: 3,
  taskTimeoutMs: 1_200_000,
  // No token caps by default (user decision); set numbers in <workspace>/.company/config.json to enable.
  runTokenBudget: Number.POSITIVE_INFINITY,
  maxTaskTokens: Number.POSITIVE_INFINITY,
};
