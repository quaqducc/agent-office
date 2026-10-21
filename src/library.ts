// Typed access to the role library (library/lib/roles.mjs, shipped in the package).
// Roots: app-home library first (store installs, user overrides), package library last (base roles).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE_LIBRARY } from "./config.ts";
import { homePaths } from "./home.ts";

export interface Role {
  id: string;
  root: string;
  meta: Record<string, string>;
  body: string;
  persona: string;
  skills: string[];
  tools: string[];
}

const mod = await import(pathToFileURL(join(PACKAGE_LIBRARY, "lib", "roles.mjs")).href);

export const libraryRoots = (): string[] => [homePaths().library, PACKAGE_LIBRARY];

export const roleIds = (): string[] => mod.roleIds(libraryRoots());
export const loadRole = (id: string): Role => mod.loadRole(libraryRoots(), id);
export const skillDir = (name: string): string | undefined => mod.skillDir(libraryRoots(), name);
export const roleProblems = (role: Role): string[] => mod.roleProblems(libraryRoots(), role);
export const assemblePrompt = (id: string, mode: "cli" | "orchestrator"): string => mod.assemblePrompt(libraryRoots(), id, mode);
