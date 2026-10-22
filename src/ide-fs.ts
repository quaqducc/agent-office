import { existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export interface TreeNode {
  name: string;
  path: string; // relative path forward-slash
  type: "file" | "directory";
  size?: number;
  mtime?: string;
  isSecret?: boolean;
}

export interface FileReadResult {
  path: string;
  content: string;
  sha256: string;
  mtime: string;
  size: number;
  isBinary: boolean;
}

const SENSITIVE_DIRS = new Set([
  ".company",
  ".git",
  ".svn",
  ".hg",
  ".ssh",
  ".aws",
  ".claude",
  ".gnupg",
  ".docker",
  ".agent-company",
]);

const IGNORED_TREE_NAMES = new Set([
  ".git",
  "node_modules",
  ".company",
  ".svn",
  ".hg",
  ".DS_Store",
  "Thumbs.db",
]);

/** Check whether a path contains sensitive credentials or secret configs. */
export function isSecretPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  const segs = norm.split("/").filter(Boolean);
  if (segs.some(s => SENSITIVE_DIRS.has(s))) return true;

  const name = segs.at(-1) ?? "";
  if (name === ".claude.json") return true;
  if (/^\.env(\.(?!example$|sample$|template$)[\w.-]+)?$/i.test(name)) return true;
  if (/\.(pem|key|pfx|p12)$/i.test(name)) return true;
  if (/^id_(rsa|ed25519|ecdsa|dsa)/i.test(name)) return true;

  return false;
}

function normCase(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Validates that `subpath` stays inside `workspacePath`, prevents path traversal,
 * prevents symlink escapes (even for nonexistent files), and blocks secrets.
 */
export function assertSafeWorkspacePath(workspacePath: string, subpath: string): string {
  const root = path.resolve(workspacePath);
  const resolved = path.resolve(root, subpath);

  // 1. Path traversal check
  const nRoot = normCase(root);
  const nResolved = normCase(resolved);
  const sep = path.sep;
  if (nResolved !== nRoot && !nResolved.startsWith(nRoot.endsWith(sep) ? nRoot : nRoot + sep)) {
    throw new HttpError(403, "Access denied: Path escapes workspace root");
  }

  // 2. Symlink escape check via nearest existing ancestor
  let checkPath = resolved;
  while (!existsSync(checkPath) && checkPath !== root) {
    const parent = path.dirname(checkPath);
    if (parent === checkPath) break;
    checkPath = parent;
  }

  if (existsSync(checkPath)) {
    const realAncestor = realpathSync(checkPath);
    const realRoot = realpathSync(root);
    const nRealAncestor = normCase(realAncestor);
    const nRealRoot = normCase(realRoot);
    if (nRealAncestor !== nRealRoot && !nRealAncestor.startsWith(nRealRoot.endsWith(sep) ? nRealRoot : nRealRoot + sep)) {
      throw new HttpError(403, "Access denied: Symlink resolves outside workspace root");
    }
  }

  // 3. Secret credentials check
  const rel = path.relative(root, resolved);
  if (isSecretPath(rel)) {
    throw new HttpError(403, "Access denied: File or directory is protected by security guard");
  }

  return resolved;
}

/** Lists direct children (depth 1) of a workspace folder, filtering system/build dirs. */
export async function listWorkspaceTree(
  wsPath: string,
  subpath: string = ".",
  _depth: number = 1,
): Promise<TreeNode[]> {
  const fullPath = assertSafeWorkspacePath(wsPath, subpath);
  if (!existsSync(fullPath)) {
    throw new HttpError(404, "path not found");
  }
  const stat = await fs.stat(fullPath);
  if (!stat.isDirectory()) {
    throw new HttpError(400, "path is not a directory");
  }

  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const root = path.resolve(wsPath);
  const nodes: TreeNode[] = [];

  for (const e of entries) {
    if (IGNORED_TREE_NAMES.has(e.name)) continue;

    const itemFullPath = path.join(fullPath, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();

    if (e.isSymbolicLink()) {
      try {
        const s = await fs.stat(itemFullPath);
        isDir = s.isDirectory();
        isFile = s.isFile();
      } catch {
        // broken symlink, skip
        continue;
      }
    }

    const relFromRoot = path.relative(root, itemFullPath).replace(/\\/g, "/");
    const isSecret = isSecretPath(relFromRoot);
    const node: TreeNode = {
      name: e.name,
      path: relFromRoot,
      type: isDir ? "directory" : "file",
    };
    if (isSecret) node.isSecret = true;

    if (isFile) {
      try {
        const s = await fs.stat(itemFullPath);
        node.size = s.size;
        node.mtime = s.mtime.toISOString();
      } catch {}
    }

    nodes.push(node);
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

/** Reads a text file safely up to 2MB, checking for null-byte binary and secrets. */
export async function readWorkspaceFile(wsPath: string, subpath: string): Promise<FileReadResult> {
  const fullPath = assertSafeWorkspacePath(wsPath, subpath);
  if (!existsSync(fullPath)) {
    throw new HttpError(404, "file not found");
  }
  const stat = await fs.stat(fullPath);
  if (stat.isDirectory()) {
    throw new HttpError(400, "path is a directory");
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new HttpError(413, "File exceeds 2MB limit");
  }

  const buf = await fs.readFile(fullPath);
  const sampleLength = Math.min(buf.length, 512);
  let isBinary = false;
  for (let i = 0; i < sampleLength; i++) {
    if (buf[i] === 0x00) {
      isBinary = true;
      break;
    }
  }

  const content = isBinary ? "" : buf.toString("utf-8");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const root = path.resolve(wsPath);
  const relPath = path.relative(root, fullPath).replace(/\\/g, "/");

  return {
    path: relPath,
    content,
    sha256,
    mtime: stat.mtime.toISOString(),
    size: stat.size,
    isBinary,
  };
}
