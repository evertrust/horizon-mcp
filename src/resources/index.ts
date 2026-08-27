import {
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';

import {
  SECTION_URI_TEMPLATE,
  getAllResources,
  getListedResources,
  getResourceByUri,
} from './catalog.js';

function listKnowledgeTopics(): string[] {
  const prefix = 'horizon://knowledge/';
  const topics = new Set<string>();
  for (const r of getAllResources()) {
    if (!r.uri.startsWith(prefix)) continue;
    const tail = r.uri.slice(prefix.length);
    const head = tail.split('/')[0];
    if (head) topics.add(head);
  }
  return [...topics].sort();
}

function listSectionsFor(topic: string): string[] {
  const prefix = `horizon://knowledge/${topic}/`;
  const sections = new Set<string>();
  for (const r of getAllResources()) {
    if (!r.uri.startsWith(prefix)) continue;
    const slug = r.uri.slice(prefix.length);
    if (slug && !slug.includes('/')) sections.add(slug);
  }
  return [...sections].sort();
}

// Resources are embedded markdown, so `lastModified` should reflect the
// content itself, not process start time. We derive a deterministic ISO
// timestamp from a content hash: it stays stable across restarts and only
// changes when the embedded markdown actually changes.
const CONTENT_DIGEST = createHash('sha256')
  .update(
    getAllResources()
      .map((r) => `${r.uri} ${r.content}`)
      .join(''),
  )
  .digest();
// Map the first 5 digest bytes to a millisecond offset from the Unix epoch.
// Deterministic, content-derived, and bounded to a valid four-digit-year ISO
// datetime (the MCP `lastModified` annotation requires ISO-8601).
const CONTENT_TIMESTAMP_ISO = new Date(
  CONTENT_DIGEST.readUIntBE(0, 5),
).toISOString();

export function registerAllResources(server: McpServer): void {
  // Listed resources -- advertised in `resources/list`.
  for (const resource of getListedResources()) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: 'text/markdown',
        annotations: {
          audience: [...(resource.audience ?? ['assistant'])],
          priority: resource.priority ?? 0.5,
          lastModified: CONTENT_TIMESTAMP_ISO,
        },
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: resource.content,
          },
        ],
      }),
    );
  }

  // Unlisted resources (integration recipes + split sections). They are
  // readable by URI but kept out of the default list to keep it short.
  for (const resource of getAllResources()) {
    if (resource.listed !== false) continue;
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: 'text/markdown',
        annotations: {
          audience: [...(resource.audience ?? ['assistant'])],
          priority: resource.priority ?? 0.3,
          lastModified: CONTENT_TIMESTAMP_ISO,
        },
      },
      async (uri: URL) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: resource.content,
          },
        ],
      }),
    );
  }

  // Section URI template -- documents the `horizon://knowledge/{topic}/{section}`
  // scheme for clients that prefer templates over an enumerated list.
  server.registerResource(
    'knowledge-section-template',
    new ResourceTemplate(SECTION_URI_TEMPLATE, {
      list: undefined,
      complete: {
        topic: (value: string) =>
          listKnowledgeTopics().filter((t) => t.startsWith(value)),
        section: (value: string, ctx) => {
          const topic = (ctx?.arguments ?? {})['topic'];
          if (!topic) return [];
          return listSectionsFor(topic).filter((s) => s.startsWith(value));
        },
      },
    }),
    {
      description:
        'Section view of a knowledge topic (e.g. horizon://knowledge/query-languages/ownership-patterns).',
      mimeType: 'text/markdown',
      annotations: {
        audience: ['assistant'],
        priority: 0.4,
      },
    },
    async (uri: URL) => {
      const entry = getResourceByUri(uri.href);
      if (!entry) {
        // MCP 2026-07-28 requires resource-not-found to be -32602 with the
        // requested URI echoed in the error data. A plain Error would surface
        // as an internal error instead.
        throw new ResourceNotFoundError(uri.href);
      }
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: entry.content },
        ],
      };
    },
  );
}
