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

export interface SaveFileOptions {
  expectedSha256?: string;
  force?: boolean;
}

export interface FileWriteResult {
  path: string;
  sha256: string;
  mtime: string;
  size: number;
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
  ".kube",
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
  const isWin = process.platform === "win32";
  const rawSegs = relPath.replace(/\\/g, "/").split("/").filter(Boolean);

  if (isWin) {
    if (rawSegs.some(s => s.includes(":"))) return true;
    for (const rawSeg of rawSegs) {
      if (/^[A-Z0-9]{1,6}~[0-9]+(\.[A-Z0-9]{1,3})?$/.test(rawSeg)) return true;
    }
  }

  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  const segs = norm.split("/").filter(Boolean);
  for (const rawSeg of segs) {
    const s = rawSeg.replace(/[.\s]+$/, "");
    if (SENSITIVE_DIRS.has(s)) return true;
  }

  const rawName = segs.at(-1) ?? "";
  const name = rawName.replace(/[.\s]+$/, "");
  if ([".claude.json", ".npmrc", ".netrc", ".git-credentials", ".pypirc", "credentials.json"].includes(name)) return true;
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

  // Check segments strictly BELOW workspace root
  const relFromRoot = path.relative(root, resolved);
  const rawSub = subpath.replace(/\\/g, "/");
  const subSegments = (path.isAbsolute(subpath) ? relFromRoot : rawSub)
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);

  const isWin = process.platform === "win32";
  for (let i = 0; i < subSegments.length; i++) {
    const seg = subSegments[i];
    if (isWin && seg.includes(":")) {
      throw new HttpError(403, "Access denied: Alternate Data Streams are not allowed");
    }
    if (seg !== "." && seg !== ".." && (seg.endsWith(" ") || seg.endsWith("."))) {
      throw new HttpError(403, "Access denied: Trailing dots and spaces are not allowed");
    }
    if (isWin && /^[A-Z0-9]{1,6}~[0-9]+(\.[A-Z0-9]{1,3})?$/.test(seg)) {
      throw new HttpError(403, "Access denied: 8.3 short names are not permitted");
    }
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
    // Check if the real path points to a secret target
    const realRel = path.relative(realRoot, realAncestor);
    if (isSecretPath(realRel)) {
      throw new HttpError(403, "Access denied: Symlink resolves to sensitive target");
    }
  }

  // 3. Secret credentials check
  const rel = path.relative(root, resolved);
  if (isSecretPath(rel)) {
    throw new HttpError(403, "Access denied: File or directory is protected by security guard");
  }

  return resolved;
}

export interface WorkspaceTreeResult {
  entries: TreeNode[];
  truncated: boolean;
}

/** Lists direct children (depth 1) of a workspace folder, filtering system/build dirs. */
export async function listWorkspaceTree(
  wsPath: string,
  subpath: string = ".",
  _depth: number = 1,
): Promise<WorkspaceTreeResult> {
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
  let truncated = false;

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

    if (nodes.length >= 5000) {
      truncated = true;
      break;
    }

    nodes.push(node);
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { entries: nodes, truncated };
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

/** Saves content to an existing text file atomically, preserving line-endings and checking 409 conflict. */
export async function saveWorkspaceFile(
  wsPath: string,
  subpath: string,
  content: string,
  options: SaveFileOptions = {},
): Promise<FileWriteResult> {
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

  const existingBuf = await fs.readFile(fullPath);
  const sampleLength = Math.min(existingBuf.length, 512);
  for (let i = 0; i < sampleLength; i++) {
    if (existingBuf[i] === 0x00) {
      throw new HttpError(400, "Cannot edit binary file");
    }
  }

  const currentSha256 = crypto.createHash("sha256").update(existingBuf).digest("hex");
  if (!options.expectedSha256 && !options.force) {
    throw new HttpError(400, "expectedSha256 is required unless force is true");
  }
  if (options.expectedSha256 && currentSha256 !== options.expectedSha256 && !options.force) {
    throw new HttpError(409, "File has been modified on disk", {
      diskContent: existingBuf.toString("utf-8"),
      diskSha256: currentSha256,
      diskMtime: stat.mtime.toISOString(),
    });
  }

  // Preserve CRLF vs LF
  const hasCrlf = existingBuf.includes(Buffer.from("\r\n"));
  const finalContent = hasCrlf ? content.replace(/\r?\n/g, "\r\n") : content.replace(/\r\n/g, "\n");

  const dir = path.dirname(fullPath);
  const tmpName = `.${path.basename(fullPath)}.tmp.${Date.now()}.${crypto.randomUUID().slice(0, 6)}`;
  const tmpPath = path.join(dir, tmpName);

  try {
    await fs.writeFile(tmpPath, finalContent, "utf-8");
    if (stat.mode) {
      try { await fs.chmod(tmpPath, stat.mode); } catch {}
    }
    if (!options.force) {
      const latestBuf = await fs.readFile(fullPath);
      const latestSha = crypto.createHash("sha256").update(latestBuf).digest("hex");
      if (latestSha !== currentSha256) {
        throw new HttpError(409, "File was concurrently modified on disk");
      }
    }
    await fs.rename(tmpPath, fullPath);
  } catch (err) {
    try { await fs.rm(tmpPath, { force: true }); } catch {}
    throw err;
  }

  const newStat = await fs.stat(fullPath);
  const newBuf = Buffer.from(finalContent, "utf-8");
  const newSha256 = crypto.createHash("sha256").update(newBuf).digest("hex");
  const root = path.resolve(wsPath);
  const relPath = path.relative(root, fullPath).replace(/\\/g, "/");

  return {
    path: relPath,
    sha256: newSha256,
    mtime: newStat.mtime.toISOString(),
    size: newStat.size,
  };
}

/** Creates a new file atomically inside the workspace, creating parent directories if needed. */
export async function createWorkspaceFile(
  wsPath: string,
  subpath: string,
  content: string = "",
): Promise<FileWriteResult> {
  const fullPath = assertSafeWorkspacePath(wsPath, subpath);
  if (existsSync(fullPath)) {
    throw new HttpError(409, "File already exists");
  }

  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });

  const tmpName = `.${path.basename(fullPath)}.tmp.${Date.now()}.${crypto.randomUUID().slice(0, 6)}`;
  const tmpPath = path.join(dir, tmpName);

  try {
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, fullPath);
  } catch (err) {
    try { await fs.rm(tmpPath, { force: true }); } catch {}
    throw err;
  }

  const stat = await fs.stat(fullPath);
  const buf = Buffer.from(content, "utf-8");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const root = path.resolve(wsPath);
  const relPath = path.relative(root, fullPath).replace(/\\/g, "/");

  return {
    path: relPath,
    sha256,
    mtime: stat.mtime.toISOString(),
    size: stat.size,
  };
}
