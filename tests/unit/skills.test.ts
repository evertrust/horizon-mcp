import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '..', '..');
const SKILLS_DIR = join(ROOT, 'skills');

function skillFolders(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((name) => name.startsWith('setup-'))
    .map((name) => join(SKILLS_DIR, name))
    .filter((p) => statSync(p).isDirectory());
}

function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

function readFrontmatter(skillFolder: string): Record<string, unknown> {
  const md = readText(join(skillFolder, 'SKILL.md'));
  expect(md.startsWith('---\n')).toBe(true);
  const end = md.indexOf('\n---\n', 4);
  expect(end).toBeGreaterThan(0);
  return parseYaml(md.slice(4, end)) as Record<string, unknown>;
}

describe('skills/manifest.json', () => {
  it('exists and is parseable', () => {
    const file = join(SKILLS_DIR, 'manifest.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readText(file)) as {
      schema_version: string;
      skills: unknown[];
    };
    expect(parsed.schema_version).toBe('1');
    expect(Array.isArray(parsed.skills)).toBe(true);
    expect(parsed.skills.length).toBeGreaterThan(0);
  });

  it('lists every setup-* folder', () => {
    const file = join(SKILLS_DIR, 'manifest.json');
    const parsed = JSON.parse(readText(file)) as { skills: { id: string }[] };
    const ids = parsed.skills.map((s) => s.id);
    const folders = skillFolders().map((p) => p.split('/').pop() ?? '');
    for (const folder of folders) {
      expect(ids).toContain(folder);
    }
  });
});

describe.each(
  skillFolders().map((folder) => [folder.split('/').pop() ?? '', folder]),
)('skill %s', (name, folder) => {
  it('has the canonical five-file layout', () => {
    const expected = [
      ['SKILL.md'],
      ['agents', 'openai.yaml'],
      ['references', 'recipe.md'],
      ['references', 'prerequisites.yaml'],
      ['references', 'troubleshooting.md'],
    ];
    for (const parts of expected) {
      expect(existsSync(join(folder, ...parts))).toBe(true);
    }
  });

  it('SKILL.md has the six required frontmatter keys', () => {
    const fm = readFrontmatter(folder);
    for (const key of [
      'name',
      'description',
      'when_to_use',
      'version',
      'requires_mcp',
      'tags',
    ]) {
      expect(fm).toHaveProperty(key);
    }
    expect(fm.version).toBe('0.1.0');
    expect(fm.requires_mcp).toEqual(expect.arrayContaining(['horizon']));
  });

  it('frontmatter description includes the colon-form trigger phrase', () => {
    const fm = readFrontmatter(folder);
    const colonForm = `setup:${name.replace(/^setup-/, '')}`;
    expect(typeof fm.description).toBe('string');
    expect((fm.description as string).includes(colonForm)).toBe(true);
  });

  it('agents/openai.yaml has schema and references', () => {
    const yaml = parseYaml(
      readText(join(folder, 'agents', 'openai.yaml')),
    ) as Record<string, unknown>;
    expect(yaml.schema).toBe('openai-skill-agent/v1');
    expect(typeof yaml.model).toBe('string');
    expect((yaml.model as string).length).toBeGreaterThan(0);
    const prompts = yaml.prompts as { system?: string; references?: string[] };
    expect(prompts.system).toBe('./SKILL.md');
    expect(prompts.references).toEqual(
      expect.arrayContaining([
        './references/recipe.md',
        './references/prerequisites.yaml',
        './references/troubleshooting.md',
      ]),
    );
  });

  it('references/recipe.md has all eight required headings in order', () => {
    const body = readText(join(folder, 'references', 'recipe.md'));
    const lines = body.split('\n');
    const required = [
      /^#\s.+/,
      /^##\s+Architecture summary\s*$/,
      /^##\s+External system prerequisites\s*$/,
      /^##\s+Horizon prerequisites\s*$/,
      /^##\s+External system setup steps\s*$/,
      /^##\s+Horizon setup steps\s*$/,
      /^##\s+Verification\s*$/,
      /^##\s+Common failure points\s*$/,
    ];
    let cursor = 0;
    for (const pattern of required) {
      const idx = lines.findIndex(
        (line, i) => i >= cursor && pattern.test(line),
      );
      expect(idx, `heading not found: ${pattern}`).toBeGreaterThanOrEqual(0);
      cursor = idx + 1;
    }
  });

  it('references/prerequisites.yaml validates against schema', () => {
    const yaml = parseYaml(
      readText(join(folder, 'references', 'prerequisites.yaml')),
    ) as Record<string, unknown>;
    expect(yaml.schema_version).toBe('1');
    const list = yaml.prerequisites as Record<string, unknown>[];
    expect(Array.isArray(list)).toBe(true);
    for (const entry of list) {
      for (const key of ['key', 'description', 'required', 'sensitive']) {
        expect(entry).toHaveProperty(key);
      }
    }
  });

  it('contains no em-dashes', () => {
    const files = [
      'SKILL.md',
      'references/recipe.md',
      'references/troubleshooting.md',
    ];
    for (const rel of files) {
      const body = readText(join(folder, rel));
      expect(body.includes('—'), `em-dash in ${rel}`).toBe(false);
    }
  });

  it('contains no private Outline URL', () => {
    const files = [
      'SKILL.md',
      'references/recipe.md',
      'references/troubleshooting.md',
    ];
    for (const rel of files) {
      const body = readText(join(folder, rel));
      expect(
        /evertrust\.getoutline\.com/i.test(body),
        `outline URL in ${rel}`,
      ).toBe(false);
    }
  });
});
