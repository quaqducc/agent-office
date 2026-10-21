// Role library loader. `roots` = library directories, highest priority first:
// [<app home>/library (store installs, user overrides), <package>/library (base roles, prompt files)].
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ponytail: minimal frontmatter parser (key: value only), switch to a YAML lib if roles need nesting
export function parse(file) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = Object.fromEntries(m[1].split("\n").filter(l => l.includes(":"))
    .map(l => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  return { meta, body: m[2] };
}

const list = s => (s || "").split(",").map(x => x.trim()).filter(Boolean);
const roleFile = (root, id) => join(root, "roles", `${id}.md`);

export function roleIds(roots) {
  const ids = new Set();
  for (const root of roots) {
    const dir = join(root, "roles");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".md") && !f.startsWith("_")) ids.add(f.slice(0, -3));
  }
  return [...ids].sort();
}

/** First root that has the role wins; its persona path is resolved against that same root. */
export function loadRole(roots, id) {
  const root = roots.find(r => existsSync(roleFile(r, id)));
  if (!root) throw new Error(`role "${id}" is not installed`);
  const { meta, body } = parse(roleFile(root, id));
  const personaFile = meta.persona ? join(root, meta.persona) : undefined;
  const persona = personaFile && existsSync(personaFile) ? parse(personaFile).body : "";
  return { id, root, meta, body, persona, personaFile, skills: list(meta.skills), tools: list(meta.tools) };
}

export function skillDir(roots, name) {
  return roots.map(r => join(r, "skills", name)).find(d => existsSync(join(d, "SKILL.md")));
}

export function roleProblems(roots, r) {
  const out = [];
  if (r.meta.persona && !(r.personaFile && existsSync(r.personaFile))) out.push(`persona missing: ${r.meta.persona}`);
  for (const s of r.skills) {
    const d = skillDir(roots, s);
    if (!d) out.push(`skill missing: ${s}`);
    else if (parse(join(d, "SKILL.md")).meta.name !== s) out.push(`skill name mismatch: ${s} (declares "${parse(join(d, "SKILL.md")).meta.name}")`);
  }
  if (!r.tools.length) out.push("no tools declared");
  if (!r.meta.owns) out.push("no owns line");
  return out;
}

/** Prompt files (_team.md, _orchestrator*.md, _cli.md) always come from the package (last root). */
const promptFile = (roots, name) => readFileSync(join(roots.at(-1), "roles", name), "utf8");

function ownershipTable(roots, self) {
  const rows = roleIds(roots).filter(i => i !== self).map(i => {
    const r = loadRole(roots, i);
    return `| ${r.meta.owns ?? r.meta.description} | ${i} |`;
  });
  return ["| Kind of work | Owner |", "|---|---|", ...rows].join("\n");
}

// mode "cli": standalone pi (text HANDOFF blocks); mode "orchestrator": handoff/checkpoint tools.
export function assemblePrompt(roots, id, mode) {
  const r = loadRole(roots, id);
  const isManager = r.meta.roster === "true";
  const body = r.body.replace("{{OWNERSHIP_TABLE}}", () => ownershipTable(roots, id));
  const roster = isManager
    ? "## Your team (role-id — what they do)\n" + roleIds(roots).filter(i => i !== id)
        .map(i => { const x = loadRole(roots, i); return `- ${i} — ${x.meta.name}: ${x.meta.description}`; }).join("\n")
    : "";
  const modeRules = mode === "cli"
    ? [promptFile(roots, "_cli.md")]
    : [promptFile(roots, "_orchestrator.md"), isManager ? promptFile(roots, "_orchestrator_manager.md") : ""];
  return [r.persona, body, roster, promptFile(roots, "_team.md"), ...modeRules].filter(Boolean).join("\n\n");
}
