/**
 * Verify the skills/ directory against the production-grade quality checklist.
 *
 * Checks:
 *  - canonical five-file layout per skills/setup-*\/
 *  - SKILL.md frontmatter (six keys, no extras, valid types)
 *  - agents/openai.yaml schema and references
 *  - references/recipe.md has the eight required headings in order
 *  - references/prerequisites.yaml validates against _shared/prerequisites-schema.md
 *  - references/troubleshooting.md is a three-column table
 *  - skills/manifest.json is consistent with the directory
 *  - no em-dashes anywhere under skills/
 *  - no evertrust.getoutline.com URLs anywhere under skills/
 *  - every tool name backticked in SKILL.md or recipe.md is in the allowlist
 *    derived from registerTool(server, '<NAME>', ...) sites under src/tools/**.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const TOOLS_DIR = join(ROOT, 'src', 'tools');

const REQUIRED_FRONTMATTER_KEYS = [
  'name',
  'description',
  'when_to_use',
  'version',
  'requires_mcp',
  'tags',
] as const;

const REQUIRED_RECIPE_HEADINGS = [
  /^#\s.+/, // top heading
  /^##\s+Architecture summary\s*$/,
  /^##\s+External system prerequisites\s*$/,
  /^##\s+Horizon prerequisites\s*$/,
  /^##\s+External system setup steps\s*$/,
  /^##\s+Horizon setup steps\s*$/,
  /^##\s+Verification\s*$/,
  /^##\s+Common failure points\s*$/,
] as const;

const PREREQUISITE_REQUIRED_KEYS = [
  'key',
  'description',
  'required',
  'sensitive',
] as const;

const ALLOWLIST_DENYLIST = new Set([
  // Connector and module enum values - not tool names
  'evtadcs',
  'msadcs',
  'azureTenant',
  'tenant',
  'intune',
  'intunepkcs',
  'jamf',
  'webra',
  'monitored',
  'acme',
  'scep',
  'est',
  'wcce',
  'crmp',
  'digicert',
  'f5client',
  'f5as3',
  // HCQL field names that look like identifiers
  'contactemail',
  'keytype',
  'discoverydata',
  // Horizon field names (snake_case) used in skill bodies
  'display_name',
  'name_contains',
  'trigger_type',
  'credential_type',
  'max_items',
  'pki_connector',
  'pkiconnector',
  'thirdpartyconnector',
  'triggerhooks',
  'client_id',
  'client_secret',
  'azure_tenant',
  'legacy_revocation_mode',
  'pub_key',
  'key_name',
  'product_id',
  'organization_id',
  'base_url',
  'api_credentials',
  'self_link',
  'user_references',
  'resource_group_references',
  'partition_access',
  'digicert_id',
  'digicert_order_id',
  'lifecycle_enroll',
  'lifecycle-enroll',
  // YAML / placeholder tokens
  'true',
  'false',
  'null',
]);

type Issue = { file: string; line?: number; message: string };

function listSkillFolders(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((name) => name.startsWith('setup-'))
    .map((name) => join(SKILLS_DIR, name))
    .filter((p) => statSync(p).isDirectory());
}

function walkAll(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (exts.some((ext) => full.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

function splitFrontmatter(md: string): {
  frontmatter: string | null;
  body: string;
} {
  if (!md.startsWith('---\n')) return { frontmatter: null, body: md };
  const end = md.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: null, body: md };
  return { frontmatter: md.slice(4, end), body: md.slice(end + 5) };
}

function checkFrontmatter(skillFolder: string, issues: Issue[]): void {
  const file = join(skillFolder, 'SKILL.md');
  let md: string;
  try {
    md = readText(file);
  } catch {
    issues.push({ file, message: 'SKILL.md is missing.' });
    return;
  }
  const { frontmatter } = splitFrontmatter(md);
  if (frontmatter === null) {
    issues.push({
      file,
      message: 'Missing YAML frontmatter (must start with ---).',
    });
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(frontmatter) as Record<string, unknown>;
  } catch (err) {
    issues.push({
      file,
      message: `Frontmatter is not valid YAML: ${(err as Error).message}`,
    });
    return;
  }
  const keys = Object.keys(parsed);
  for (const required of REQUIRED_FRONTMATTER_KEYS) {
    if (!(required in parsed)) {
      issues.push({
        file,
        message: `Frontmatter missing required key: ${required}.`,
      });
    }
  }
  for (const key of keys) {
    if (
      !REQUIRED_FRONTMATTER_KEYS.includes(
        key as (typeof REQUIRED_FRONTMATTER_KEYS)[number],
      )
    ) {
      issues.push({ file, message: `Frontmatter has unexpected key: ${key}.` });
    }
  }
  const description = parsed.description;
  if (typeof description === 'string') {
    const id = skillFolder.split('/').pop() ?? '';
    const colonForm = `setup:${id.replace(/^setup-/, '')}`;
    if (!description.includes(colonForm)) {
      issues.push({
        file,
        message: `Frontmatter description must mention the colon-form trigger phrase: ${colonForm}.`,
      });
    }
  }
  const tags = parsed.tags;
  if (!Array.isArray(tags) || tags.length < 2) {
    issues.push({
      file,
      message: 'Frontmatter tags must be an array with at least two entries.',
    });
  }
  if (parsed.version !== '0.1.0') {
    issues.push({
      file,
      message: 'Frontmatter version must be "0.1.0" for v1 skills.',
    });
  }
  if (
    !Array.isArray(parsed.requires_mcp) ||
    parsed.requires_mcp.length === 0 ||
    !parsed.requires_mcp.includes('horizon')
  ) {
    issues.push({
      file,
      message: 'Frontmatter requires_mcp must include "horizon".',
    });
  }
}

function checkAgentsYaml(skillFolder: string, issues: Issue[]): void {
  const file = join(skillFolder, 'agents', 'openai.yaml');
  let raw: string;
  try {
    raw = readText(file);
  } catch {
    issues.push({ file, message: 'agents/openai.yaml is missing.' });
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch (err) {
    issues.push({
      file,
      message: `agents/openai.yaml is not valid YAML: ${(err as Error).message}`,
    });
    return;
  }
  if (parsed.schema !== 'openai-skill-agent/v1') {
    issues.push({
      file,
      message: 'agents/openai.yaml schema must be "openai-skill-agent/v1".',
    });
  }
  if (typeof parsed.model !== 'string' || parsed.model.length === 0) {
    issues.push({
      file,
      message:
        'agents/openai.yaml model must be a non-empty string (no deferral).',
    });
  }
  const tools = parsed.tools;
  if (!Array.isArray(tools) || !tools.includes('horizon')) {
    issues.push({
      file,
      message: 'agents/openai.yaml tools must include "horizon".',
    });
  }
  const prompts = parsed.prompts as
    | { system?: string; references?: string[] }
    | undefined;
  if (!prompts || prompts.system !== './SKILL.md') {
    issues.push({
      file,
      message: 'agents/openai.yaml prompts.system must be "./SKILL.md".',
    });
  }
  const expectedRefs = [
    './references/recipe.md',
    './references/prerequisites.yaml',
    './references/troubleshooting.md',
  ];
  for (const ref of expectedRefs) {
    if (!prompts?.references?.includes(ref)) {
      issues.push({
        file,
        message: `agents/openai.yaml prompts.references must include ${ref}.`,
      });
    }
  }
}

function checkRecipeHeadings(skillFolder: string, issues: Issue[]): void {
  const file = join(skillFolder, 'references', 'recipe.md');
  let body: string;
  try {
    body = readText(file);
  } catch {
    issues.push({ file, message: 'references/recipe.md is missing.' });
    return;
  }
  const lines = body.split('\n');
  let cursor = 0;
  for (const [index, pattern] of REQUIRED_RECIPE_HEADINGS.entries()) {
    const matchIndex = lines.findIndex(
      (line, i) => i >= cursor && pattern.test(line),
    );
    if (matchIndex === -1) {
      issues.push({
        file,
        message: `Required heading #${index + 1} not found (pattern: ${pattern}).`,
      });
      return;
    }
    cursor = matchIndex + 1;
  }
}

function checkPrerequisitesYaml(skillFolder: string, issues: Issue[]): void {
  const file = join(skillFolder, 'references', 'prerequisites.yaml');
  let raw: string;
  try {
    raw = readText(file);
  } catch {
    issues.push({ file, message: 'references/prerequisites.yaml is missing.' });
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch (err) {
    issues.push({
      file,
      message: `references/prerequisites.yaml is not valid YAML: ${(err as Error).message}`,
    });
    return;
  }
  if (parsed.schema_version !== '1') {
    issues.push({ file, message: 'schema_version must be "1".' });
  }
  const list = parsed.prerequisites;
  if (!Array.isArray(list) || list.length === 0) {
    issues.push({ file, message: 'prerequisites must be a non-empty array.' });
    return;
  }
  for (const [i, entry] of list.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      issues.push({ file, message: `prerequisites[${i}] must be an object.` });
      continue;
    }
    const obj = entry as Record<string, unknown>;
    for (const key of PREREQUISITE_REQUIRED_KEYS) {
      if (!(key in obj)) {
        issues.push({
          file,
          message: `prerequisites[${i}] missing required field: ${key}.`,
        });
      }
    }
    if ('validator' in obj && 'enum' in obj) {
      issues.push({
        file,
        message: `prerequisites[${i}] has both validator and enum, which are mutually exclusive.`,
      });
    }
    if (obj.required === false && !('default' in obj)) {
      issues.push({
        file,
        message: `prerequisites[${i}] is optional but has no default value.`,
      });
    }
  }
}

function checkTroubleshooting(skillFolder: string, issues: Issue[]): void {
  const file = join(skillFolder, 'references', 'troubleshooting.md');
  let body: string;
  try {
    body = readText(file);
  } catch {
    issues.push({ file, message: 'references/troubleshooting.md is missing.' });
    return;
  }
  if (!/\|\s*Problem\s*\|\s*Possible Cause\s*\|\s*Solution\s*\|/i.test(body)) {
    issues.push({
      file,
      message:
        'troubleshooting.md must contain a Problem | Possible Cause | Solution table header.',
    });
  }
}

function checkManifest(issues: Issue[]): void {
  const file = join(SKILLS_DIR, 'manifest.json');
  const manifest = JSON.parse(readText(file)) as {
    schema_version: string;
    skills: {
      id: string;
      description: string;
      tags: string[];
      version: string;
    }[];
  };
  if (manifest.schema_version !== '1') {
    issues.push({ file, message: 'manifest schema_version must be "1".' });
  }
  const folders = listSkillFolders().map((p) => p.split('/').pop() ?? '');
  const ids = manifest.skills.map((s) => s.id);
  for (const folder of folders) {
    if (!ids.includes(folder)) {
      issues.push({
        file,
        message: `manifest is missing entry for ${folder}.`,
      });
    }
  }
  for (const id of ids) {
    if (!folders.includes(id)) {
      issues.push({
        file,
        message: `manifest entry ${id} has no matching folder.`,
      });
    }
    const skill = manifest.skills.find((s) => s.id === id);
    if (skill && skill.version !== '0.1.0') {
      issues.push({
        file,
        message: `manifest entry ${id} version must be "0.1.0".`,
      });
    }
    const colonForm = `setup:${id.replace(/^setup-/, '')}`;
    if (skill && !skill.tags.includes(colonForm)) {
      issues.push({
        file,
        message: `manifest entry ${id} tags must include the colon-form trigger ${colonForm}.`,
      });
    }
  }
}

function checkNoEmDashesOrPrivateUrls(issues: Issue[]): void {
  const files = walkAll(SKILLS_DIR, ['.md', '.yaml', '.json']);
  for (const file of files) {
    const body = readText(file);
    const lines = body.split('\n');
    for (const [i, line] of lines.entries()) {
      if (line.includes('—')) {
        issues.push({
          file,
          line: i + 1,
          message: 'Em-dash detected. Use a regular dash.',
        });
      }
      if (/https?:\/\/[^\s)`'"]*evertrust\.getoutline\.com/i.test(line)) {
        issues.push({
          file,
          line: i + 1,
          message: 'Private Outline URL detected.',
        });
      }
    }
  }
}

function buildToolAllowlist(): Set<string> {
  const tools = new Set<string>();
  const files = walkAll(TOOLS_DIR, ['.ts']).filter(
    (f) => !f.endsWith('register.ts') && !f.endsWith('guidance.ts'),
  );
  const pattern = /registerTool\s*\(\s*server\s*,\s*['"]([a-z][a-z0-9_]+)['"]/g;
  for (const file of files) {
    const body = readText(file);
    for (const match of body.matchAll(pattern)) {
      tools.add(match[1]);
    }
  }
  return tools;
}

function loadFutureToolNames(): Set<string> {
  const file = join(SKILLS_DIR, '_shared', 'tool-gap-signaling.md');
  const body = readText(file);
  const out = new Set<string>();
  const pattern = /^\s*-\s+`?([a-z][a-z0-9_]+)`?\s*:/gm;
  for (const match of body.matchAll(pattern)) {
    out.add(match[1]);
  }
  return out;
}

function checkToolAllowlist(issues: Issue[]): void {
  const allowlist = buildToolAllowlist();
  const futureTools = loadFutureToolNames();
  const targetFiles: string[] = [];
  for (const folder of listSkillFolders()) {
    targetFiles.push(join(folder, 'SKILL.md'));
    targetFiles.push(join(folder, 'references', 'recipe.md'));
  }
  const backtickedIdent = /`([a-z][a-z0-9_]+)`/g;
  for (const file of targetFiles) {
    let body: string;
    try {
      body = readText(file);
    } catch {
      continue;
    }
    for (const match of body.matchAll(backtickedIdent)) {
      const name = match[1];
      if (ALLOWLIST_DENYLIST.has(name)) continue;
      if (allowlist.has(name)) continue;
      if (futureTools.has(name)) continue;
      // We only flag identifiers that look like tool names (snake_case with underscore).
      if (!name.includes('_')) continue;
      issues.push({
        file,
        message: `Backticked identifier "${name}" is not in the tool allowlist or in tool-gap-signaling.md.`,
      });
    }
  }
}

function main(): void {
  const issues: Issue[] = [];

  // Folder layout
  for (const folder of listSkillFolders()) {
    const expected = [
      ['SKILL.md'],
      ['agents', 'openai.yaml'],
      ['references', 'recipe.md'],
      ['references', 'prerequisites.yaml'],
      ['references', 'troubleshooting.md'],
    ];
    for (const parts of expected) {
      const target = join(folder, ...parts);
      try {
        statSync(target);
      } catch {
        issues.push({
          file: target,
          message: `Missing required skill file: ${parts.join('/')}.`,
        });
      }
    }
  }

  // Per-skill checks
  for (const folder of listSkillFolders()) {
    checkFrontmatter(folder, issues);
    checkAgentsYaml(folder, issues);
    checkRecipeHeadings(folder, issues);
    checkPrerequisitesYaml(folder, issues);
    checkTroubleshooting(folder, issues);
  }

  // Repo-level checks
  checkManifest(issues);
  checkNoEmDashesOrPrivateUrls(issues);
  checkToolAllowlist(issues);

  if (issues.length === 0) {
    console.log('verify-skills: OK');
    return;
  }

  console.error(`verify-skills: ${issues.length} issue(s) found`);
  for (const issue of issues) {
    const rel = relative(ROOT, issue.file);
    const where = issue.line ? `${rel}:${issue.line}` : rel;
    console.error(`  ${where}: ${issue.message}`);
  }
  process.exit(1);
}

main();
