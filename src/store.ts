// Role store: install/uninstall roles (and the skills they need) from the catalog in this repo.
// File hashes come from the catalog/index.json shipped inside the npm package (so a changed download
// source cannot swap content); files are downloaded from GitHub at the app's version, sha256-verified,
// staged in a temp dir and moved into the app-home library only when every file checks out.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CATALOG_DIR, PACKAGE_LIBRARY, VERSION } from "./config.ts";
import { ensureHome, homePaths } from "./home.ts";
import { loadRole, roleIds, skillDir } from "./library.ts";

/** `index`: a trusted index.json on disk (the one shipped with the package) used instead of downloading it. */
export type CatalogBase = { kind: "local"; dir: string } | { kind: "remote"; baseUrl: string; index?: string };
type Fetch = typeof fetch;

interface CatalogFile { path: string; sha256: string; size: number }
interface CatalogRole { id: string; name: string; description: string; owns: string; skills: string[]; files: CatalogFile[] }
interface CatalogSkill { name: string; source: string; license: string; files: CatalogFile[] }
interface CatalogIndex { format: number; roles: CatalogRole[]; skills: CatalogSkill[] }

export class StoreError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const RAW = "https://raw.githubusercontent.com/quaqducc/agent-office";

/** Local catalog in a git checkout; otherwise GitHub at v<version> (main only when that tag does not exist). */
export async function resolveCatalogBase(o: { localDir?: string; version?: string; fetchImpl?: Fetch } = {}): Promise<CatalogBase> {
  const dir = o.localDir ?? CATALOG_DIR;
  if (existsSync(join(dir, "roles"))) return { kind: "local", dir };
  const index = existsSync(join(dir, "index.json")) ? join(dir, "index.json") : undefined;
  const tagged = `${RAW}/v${o.version ?? VERSION}/catalog/`;
  try {
    const res = await (o.fetchImpl ?? fetch)(`${tagged}index.json`, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return { kind: "remote", baseUrl: `${RAW}/main/catalog/`, index };
  } catch { /* offline: keep the tag, the download reports the error */ }
  return { kind: "remote", baseUrl: tagged, index };
}

const SAFE_PATH = /^(roles|personas|skills)\/[A-Za-z0-9_.\-/]+$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function checkName(kind: string, name: string) {
  if (!SAFE_NAME.test(name)) throw new StoreError(400, `invalid ${kind} name "${name}"`);
}

async function readFile(base: CatalogBase, path: string, fetchImpl: Fetch): Promise<Buffer> {
  if (!SAFE_PATH.test(path) || path.split("/").includes("..")) throw new StoreError(400, `refusing catalog path "${path}"`);
  if (base.kind === "local") return readFileSync(join(base.dir, path));
  const res = await fetchImpl(base.baseUrl + path, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new StoreError(502, `download failed (${res.status}) for ${path}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function loadCatalog(base: CatalogBase, fetchImpl: Fetch = fetch): Promise<CatalogIndex> {
  const raw = base.kind === "local" ? readFileSync(join(base.dir, "index.json"), "utf8")
    : base.index ? readFileSync(base.index, "utf8")
    : await (async () => {
      const res = await fetchImpl(`${base.baseUrl}index.json`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new StoreError(502, `cannot load the role catalog (${res.status})`);
      return res.text();
    })();
  return JSON.parse(raw);
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
/** Per store role: hash of its role file, where it came from, and the files/skills the store put in place. */
type Installed = Record<string, { sha256: string; ref: string; digest?: string; files?: string[]; skills?: string[] }>;
/** One hash over every catalog file a role brings (role file, personas, skills): changes when any of them does. */
const roleDigest = (index: CatalogIndex, role: CatalogRole) => sha([
  ...role.files.map(f => f.sha256),
  ...role.skills.flatMap(n => index.skills.find(s => s.name === n)?.files.map(f => f.sha256) ?? []),
].join(","));
const readInstalled = (): Installed =>
  existsSync(homePaths().installed) ? JSON.parse(readFileSync(homePaths().installed, "utf8")) : {};
const writeInstalled = (v: object) => writeFileSync(homePaths().installed, JSON.stringify(v, null, 2));
const isBase = (id: string) => existsSync(join(PACKAGE_LIBRARY, "roles", `${id}.md`));

export async function storeState(base?: CatalogBase, fetchImpl: Fetch = fetch) {
  const b = base ?? await resolveCatalogBase({ fetchImpl });
  const index = await loadCatalog(b, fetchImpl);
  const installed = readInstalled();
  const homeRoles = new Set(existsSync(join(homePaths().library, "roles"))
    ? readdirSync(join(homePaths().library, "roles")).filter(f => f.endsWith(".md")).map(f => f.slice(0, -3)) : []);
  const base4 = roleIds().filter(isBase).map(id => {
    const r = loadRole(id);
    return { id, name: r.meta.name, description: r.meta.description, owns: r.meta.owns, skills: r.skills, installed: "base" as const, updateAvailable: false };
  });
  const store = index.roles.map(r => ({
    id: r.id, name: r.name, description: r.description, owns: r.owns, skills: r.skills,
    installed: homeRoles.has(r.id) ? "store" as const : false as const,
    updateAvailable: !!installed[r.id] && installed[r.id].digest !== roleDigest(index, r),
  }));
  return { source: b.kind === "local" ? "local" : b.baseUrl, roles: [...base4, ...store] };
}

export async function installRole(id: string, base?: CatalogBase, fetchImpl: Fetch = fetch): Promise<void> {
  checkName("role", id);
  ensureHome();
  const b = base ?? await resolveCatalogBase({ fetchImpl });
  const index = await loadCatalog(b, fetchImpl);
  const role = index.roles.find(r => r.id === id);
  if (!role) throw new StoreError(404, `role "${id}" is not in the catalog`);
  // A role brings its own role file and personas only; it can never overwrite another role's file.
  for (const f of role.files) {
    if (f.path !== `roles/${id}.md` && !/^personas\/[A-Za-z0-9_.-]+\.md$/.test(f.path)) throw new StoreError(400, `refusing catalog path "${f.path}" for role "${id}"`);
  }
  role.skills.forEach(s => checkName("skill", s));
  // Missing skills, plus the ones the store installed for this role before (an update refreshes them);
  // a skill from the package or one the user put in the home library is reused as is.
  const owned = new Set(readInstalled()[id]?.skills ?? []);
  const skills = role.skills.filter(s => !skillDir(s) || owned.has(s)).map(s => {
    const entry = index.skills.find(x => x.name === s);
    if (!entry) throw new StoreError(502, `catalog is missing skill "${s}" for role "${id}"`);
    return entry;
  });
  for (const s of skills) {
    for (const f of s.files) if (!f.path.startsWith(`skills/${s.name}/`)) throw new StoreError(400, `refusing catalog path "${f.path}" for skill "${s.name}"`);
  }
  const files = [...role.files, ...skills.flatMap(s => s.files)];
  const lib = homePaths().library;
  const staging = join(lib, `.staging-${randomUUID()}`);
  try {
    for (const f of files) {
      const buf = await readFile(b, f.path, fetchImpl);
      if (sha(buf) !== f.sha256) throw new StoreError(502, `checksum mismatch for ${f.path} — download refused`);
      mkdirSync(dirname(join(staging, f.path)), { recursive: true });
      writeFileSync(join(staging, f.path), buf);
    }
    // Every file verified: move items into place (skills as whole folders).
    const moves = [
      ...role.files.map(f => f.path),
      ...skills.map(s => `skills/${s.name}`),
    ];
    for (const item of moves) {
      const to = join(lib, item);
      mkdirSync(dirname(to), { recursive: true });
      rmSync(to, { recursive: true, force: true });
      renameSync(join(staging, item), to);
    }
    const prev = readInstalled()[id];
    writeInstalled({ ...readInstalled(), [id]: {
      sha256: role.files[0].sha256, ref: b.kind === "local" ? "local" : b.baseUrl, digest: roleDigest(index, role),
      files: role.files.map(f => f.path),
      // an update keeps ownership of skills the first install brought in
      skills: [...new Set([...(prev?.skills ?? []), ...skills.map(s => s.name)])],
    } });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Remove a store role and whatever the store installed for it that no remaining role uses. */
export async function uninstallRole(id: string): Promise<void> {
  checkName("role", id);
  const lib = homePaths().library;
  const file = join(lib, "roles", `${id}.md`);
  if (!existsSync(file)) {
    if (isBase(id)) throw new StoreError(409, `"${id}" is a base role and cannot be removed`);
    throw new StoreError(404, `role "${id}" is not installed`);
  }
  const installed = readInstalled();
  const record = installed[id];
  rmSync(file);
  const remaining = roleIds().map(r => loadRole(r));
  for (const path of record?.files ?? []) {
    if (/^personas\/[A-Za-z0-9_.-]+\.md$/.test(path) && !remaining.some(r => r.meta.persona === path)) rmSync(join(lib, path), { force: true });
  }
  const stillUsed = new Set(remaining.flatMap(r => r.skills));
  for (const s of record?.skills ?? []) {
    if (SAFE_NAME.test(s) && !stillUsed.has(s)) rmSync(join(lib, "skills", s), { recursive: true, force: true });
  }
  delete installed[id];
  writeInstalled(installed);
}
