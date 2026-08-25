import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const HTTP_METHOD_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
const ROOT_ROUTE_RE = /^\s*->\s+(\/api\/v1\/\S*)\s+([A-Za-z0-9._]+)\.Routes\b/m;
// Allows `(`, `)`, `,` so template literals like
// `/api/v1/.../${encodePathSegment(id)}` are captured as a single fragment.
// Whitespace stays excluded so the match still terminates at the end of the
// string concatenation.
const PATH_FRAGMENT_RE = /\/api\/v1\/[A-Za-z0-9_./${}<>(),\-:*]+/g;
const CLIENT_METHOD_NAMES = new Set([
  'get',
  'getText',
  'getBytes',
  'post',
  'postText',
  'postMultipart',
  'put',
  'patch',
  'delete',
]);

export const SOURCE_ONLY_ALLOWED_PATHS = new Set<string>([
  '/api/v1/crypto/detect',
  // DCV policy status listing: routed in Horizon (conf/routes) but absent from
  // the published OpenAPI; the DCV lifecycle tools were derived from the source.
  '/api/v1/dcv/lifecycle/policies',
  '/api/v1/events/csv',
  '/api/v1/rfc5280/crl',
  '/api/v1/rfc3161',
  '/api/v1/rfc6960',
  '/api/v1/security/principals/dashboards',
  '/api/v1/security/principals/dashboards/{name}',
  '/api/v1/security/principals/queries',
  '/api/v1/security/principals/queries/{name}',
]);

export interface NormalizedOperation {
  method: string;
  path: string;
  sourceFile: string;
}

export interface McpPathReference {
  path: string;
  file: string;
  line: number;
  rawPath: string;
  method?: string;
}

export interface RouteTruthIssue {
  type:
    | 'allowlist_stale'
    | 'method_mismatch'
    | 'missing_route'
    | 'source_only_not_allowlisted';
  path: string;
  file?: string;
  line?: number;
  method?: string;
  details: string;
}

export interface RouteTruthVerification {
  issues: RouteTruthIssue[];
  verifiedCount: number;
  sourceOnlyCount: number;
  referencedCount: number;
}

export interface TruthInputs {
  projectRoot: string;
  horizonRoot: string;
  openApiPath: string;
  outputDir: string;
}

interface StoredOperationsDocument {
  routes?: unknown;
  operations?: unknown;
  paths?: Record<string, Record<string, unknown>>;
}

function expandHome(pathValue: string): string {
  if (!pathValue.startsWith('~/')) {
    return pathValue;
  }
  return join(homedir(), pathValue.slice(2));
}

function resolveExistingPath(
  projectRoot: string,
  candidates: readonly string[],
): string {
  for (const candidate of candidates) {
    const resolved = candidate.startsWith('/')
      ? candidate
      : resolve(projectRoot, candidate);
    if (existsSync(expandHome(resolved))) {
      return expandHome(resolved);
    }
  }
  throw new Error(
    `Could not resolve any of the required paths: ${candidates.join(', ')}`,
  );
}

export function resolveTruthInputs(projectRoot: string): TruthInputs {
  const horizonRoot = resolveExistingPath(
    projectRoot,
    [
      process.env['HORIZON_SOURCE_ROOT'] ?? '',
      '../horizon',
      'src/generated/docs/horizon-routes.json',
      '/Users/sbo/Documents/EVERTRUST/horizon',
    ].filter(Boolean),
  );
  const openApiPath = resolveExistingPath(
    projectRoot,
    [
      process.env['HORIZON_OPENAPI_PATH'] ?? '',
      '../evertrust_horizon_openapi.json',
      'src/generated/docs/openapi-operations.json',
      '/Users/sbo/Downloads/evertrust_horizon_openapi.json',
    ].filter(Boolean),
  );
  const outputDir = resolve(
    projectRoot,
    process.env['HORIZON_TRUTH_OUTPUT_DIR'] ?? 'src/generated/docs',
  );
  return { projectRoot, horizonRoot, openApiPath, outputDir };
}

function collectFiles(root: string, extension: string): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files.sort();
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function isNormalizedOperation(value: unknown): value is NormalizedOperation {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as NormalizedOperation).method === 'string' &&
    typeof (value as NormalizedOperation).path === 'string' &&
    typeof (value as NormalizedOperation).sourceFile === 'string'
  );
}

function sortOperations(
  operations: readonly NormalizedOperation[],
): NormalizedOperation[] {
  return [...operations].sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    if (pathOrder !== 0) {
      return pathOrder;
    }
    const methodOrder = left.method.localeCompare(right.method);
    if (methodOrder !== 0) {
      return methodOrder;
    }
    return left.sourceFile.localeCompare(right.sourceFile);
  });
}

function readStoredOperations(
  inputPath: string,
  field: 'routes' | 'operations',
): NormalizedOperation[] | undefined {
  if (!inputPath.endsWith('.json')) {
    return undefined;
  }

  const document = JSON.parse(readText(inputPath)) as StoredOperationsDocument;
  const operations = document[field];
  if (!Array.isArray(operations)) {
    return undefined;
  }

  return sortOperations(
    operations.filter(isNormalizedOperation).map((operation) => ({
      method: operation.method,
      path: normalizeRoutePath(operation.path),
      sourceFile: operation.sourceFile,
    })),
  );
}

function lineNumberAt(
  sourceFile: ts.SourceFile,
  nodeOrIndex: ts.Node | number,
): number {
  const position =
    typeof nodeOrIndex === 'number'
      ? nodeOrIndex
      : nodeOrIndex.getStart(sourceFile);
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function expressionTemplateText(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  return expression.getText(sourceFile).trim();
}

function extractLiteralText(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): string | undefined {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  if (!ts.isTemplateExpression(expression)) {
    return undefined;
  }

  let value = expression.head.text;
  for (const span of expression.templateSpans) {
    value += `\${${expressionTemplateText(sourceFile, span.expression)}}`;
    value += span.literal.text;
  }

  return value;
}

export function normalizeRoutePath(rawPath: string): string {
  let normalized = rawPath.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  normalized = normalized
    .replace(/\$\{[^}]+\}/g, '{param}')
    .replace(/\$([A-Za-z0-9_]+)<[^>]+>/g, '{$1}')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\*([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/+/g, '/');

  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function canonicalRoutePath(rawPath: string): string {
  return normalizeRoutePath(rawPath).replace(/\{[^}]+\}/g, '{}');
}

function extractApiPathFragments(rawText: string): string[] {
  return [...rawText.matchAll(PATH_FRAGMENT_RE)]
    .map((match) => match[0])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/[),.;:]+$/g, ''));
}

function resolveKnownConstants(
  rawValue: string,
  constPathMap: ReadonlyMap<string, string>,
): string {
  let resolved = rawValue;
  let mutated = true;

  while (mutated) {
    mutated = false;
    resolved = resolved.replace(/\$\{([A-Za-z0-9_]+)\}/g, (full, name) => {
      const replacement = constPathMap.get(name);
      if (!replacement) {
        return full;
      }
      mutated = true;
      return replacement;
    });
  }

  return resolved;
}

function joinRoutePath(basePath: string, subPath: string): string {
  if (subPath === '/' || subPath === '') {
    return normalizeRoutePath(basePath);
  }
  const joined = `${basePath.replace(/\/+$/, '')}/${subPath.replace(/^\/+/, '')}`;
  return normalizeRoutePath(joined);
}

function routeFileForModule(horizonRoot: string, moduleName: string): string {
  return join(horizonRoot, 'conf', `${moduleName}.routes`);
}

function parseRootRoutes(horizonRoot: string): Array<{
  basePath: string;
  sourceFile: string;
}> {
  const rootRoutesPath = join(horizonRoot, 'conf', 'routes');
  const lines = readText(rootRoutesPath).split('\n');
  const routes: Array<{ basePath: string; sourceFile: string }> = [];

  for (const line of lines) {
    const match = line.match(ROOT_ROUTE_RE);
    if (!match) {
      continue;
    }
    const [, basePath, moduleName] = match;
    if (!basePath || !moduleName) {
      continue;
    }

    const routeFile = routeFileForModule(horizonRoot, moduleName);
    if (!existsSync(routeFile)) {
      continue;
    }

    routes.push({
      basePath: normalizeRoutePath(basePath),
      sourceFile: routeFile,
    });
  }

  return routes;
}

export function collectHorizonOperations(
  horizonRoot: string,
  projectRoot = process.cwd(),
): NormalizedOperation[] {
  const storedOperations = readStoredOperations(horizonRoot, 'routes');
  if (storedOperations) {
    return storedOperations;
  }

  const operations: NormalizedOperation[] = [];

  for (const route of parseRootRoutes(horizonRoot)) {
    const lines = readText(route.sourceFile).split('\n');
    for (const line of lines) {
      const methodMatch = line.match(HTTP_METHOD_RE);
      if (!methodMatch) {
        continue;
      }
      const pathMatch = line.trim().split(/\s+/);
      const method = methodMatch[1]!;
      const subPath = pathMatch[1];
      if (!subPath) {
        continue;
      }

      operations.push({
        method,
        path: joinRoutePath(route.basePath, subPath),
        sourceFile: relative(projectRoot, route.sourceFile),
      });
    }
  }

  return sortOperations(operations);
}

export function collectOpenApiOperations(
  openApiPath: string,
  projectRoot = process.cwd(),
): NormalizedOperation[] {
  const storedOperations = readStoredOperations(openApiPath, 'operations');
  if (storedOperations) {
    return storedOperations;
  }

  const document = JSON.parse(
    readText(openApiPath),
  ) as StoredOperationsDocument;

  const operations: NormalizedOperation[] = [];
  const paths = document.paths ?? {};
  for (const [path, definition] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(definition)) {
      const upperMethod = method.toUpperCase();
      if (!HTTP_METHOD_RE.test(upperMethod)) {
        continue;
      }
      if (operation === null || typeof operation !== 'object') {
        continue;
      }

      operations.push({
        method: upperMethod,
        path: normalizeRoutePath(path),
        sourceFile: relative(projectRoot, openApiPath),
      });
    }
  }

  return sortOperations(operations);
}

export function collectMcpPathReferences(
  projectRoot: string,
): McpPathReference[] {
  const srcRoot = join(projectRoot, 'src');
  const references: McpPathReference[] = [];

  for (const file of collectFiles(srcRoot, '.ts')) {
    if (file.includes(`${join('src', 'generated', 'docs')}`)) {
      continue;
    }

    const text = readText(file);
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const rawConstMap = new Map<string, string>();
    const constPathMap = new Map<string, string>();

    function collectConstants(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const literal = extractLiteralText(sourceFile, node.initializer);
        if (literal) {
          rawConstMap.set(node.name.text, literal);
        }
      }
      ts.forEachChild(node, collectConstants);
    }

    collectConstants(sourceFile);

    let resolvedAny = true;
    while (resolvedAny) {
      resolvedAny = false;
      for (const [constName, literal] of rawConstMap) {
        const resolved = resolveKnownConstants(literal, constPathMap);
        const pathFragments = extractApiPathFragments(resolved);
        if (
          pathFragments.length === 1 &&
          constPathMap.get(constName) !== pathFragments[0]
        ) {
          constPathMap.set(constName, pathFragments[0]!);
          resolvedAny = true;
        }
      }
    }

    function recordReference(
      rawValue: string,
      node: ts.Node,
      method?: string,
    ): void {
      const resolved = resolveKnownConstants(rawValue, constPathMap);
      const pathFragments = extractApiPathFragments(resolved);
      if (pathFragments.length === 0) {
        return;
      }

      for (const rawPath of pathFragments) {
        references.push({
          path: normalizeRoutePath(rawPath),
          file: relative(projectRoot, file),
          line: lineNumberAt(sourceFile, node),
          rawPath,
          method,
        });
      }
    }

    function visit(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const literal = extractLiteralText(sourceFile, node.initializer);
        if (literal) {
          recordReference(literal, node);
        }
      }

      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sourceFile) === 'client' &&
        CLIENT_METHOD_NAMES.has(node.expression.name.text)
      ) {
        const firstArgument = node.arguments[0];
        let rawValue: string | undefined;

        if (firstArgument) {
          rawValue = extractLiteralText(sourceFile, firstArgument);
          if (!rawValue && ts.isIdentifier(firstArgument)) {
            rawValue = rawConstMap.get(firstArgument.text);
          }
        }

        if (rawValue) {
          const methodName = node.expression.name.text;
          const method =
            methodName === 'getText' || methodName === 'getBytes'
              ? 'GET'
              : methodName === 'postText' || methodName === 'postMultipart'
                ? 'POST'
                : methodName.toUpperCase();
          recordReference(rawValue, node, method);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    if (relative(projectRoot, file) === 'src/models/payloads.ts') {
      for (const match of text.matchAll(PATH_FRAGMENT_RE)) {
        const rawPath = match[0];
        if (!rawPath) {
          continue;
        }
        references.push({
          path: normalizeRoutePath(rawPath.replace(/[),.;:]+$/g, '')),
          file: relative(projectRoot, file),
          line: lineNumberAt(sourceFile, match.index ?? 0),
          rawPath,
        });
      }
    }
  }

  return references.sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    if (pathOrder !== 0) {
      return pathOrder;
    }
    const fileOrder = left.file.localeCompare(right.file);
    if (fileOrder !== 0) {
      return fileOrder;
    }
    return left.line - right.line;
  });
}

function addMethod(
  map: Map<string, Set<string>>,
  path: string,
  method: string,
): void {
  const methods = map.get(path) ?? new Set<string>();
  methods.add(method);
  map.set(path, methods);
}

function methodMap(
  operations: readonly NormalizedOperation[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const operation of operations) {
    addMethod(map, canonicalRoutePath(operation.path), operation.method);
  }
  return map;
}

export function verifyMcpRouteTruth(params: {
  horizonOperations: readonly NormalizedOperation[];
  openApiOperations: readonly NormalizedOperation[];
  references: readonly McpPathReference[];
  sourceOnlyAllowlist?: ReadonlySet<string>;
}): RouteTruthVerification {
  const sourceMap = methodMap(params.horizonOperations);
  const openApiMap = methodMap(params.openApiOperations);
  const allowlist = new Set(
    [...(params.sourceOnlyAllowlist ?? SOURCE_ONLY_ALLOWED_PATHS)].map((path) =>
      canonicalRoutePath(path),
    ),
  );
  const issues: RouteTruthIssue[] = [];

  for (const allowedPath of allowlist) {
    if (openApiMap.has(allowedPath)) {
      issues.push({
        type: 'allowlist_stale',
        path: allowedPath,
        details:
          'This source-only allowlist entry is now present in the OpenAPI and should be removed.',
      });
    }
  }

  let verifiedCount = 0;
  let sourceOnlyCount = 0;

  for (const reference of params.references) {
    const referencePath = canonicalRoutePath(reference.path);
    const sourceMethods = sourceMap.get(referencePath);
    const openApiMethods = openApiMap.get(referencePath);
    const allMethods = new Set<string>([
      ...(sourceMethods ?? []),
      ...(openApiMethods ?? []),
    ]);

    if (
      reference.method &&
      allMethods.size > 0 &&
      !allMethods.has(reference.method)
    ) {
      issues.push({
        type: 'method_mismatch',
        path: reference.path,
        file: reference.file,
        line: reference.line,
        method: reference.method,
        details: `Referenced as ${reference.method}, but truth artifacts only expose ${[...allMethods].sort().join(', ')}.`,
      });
      continue;
    }

    if (openApiMethods) {
      verifiedCount += 1;
      continue;
    }

    if (sourceMethods) {
      if (!allowlist.has(referencePath)) {
        issues.push({
          type: 'source_only_not_allowlisted',
          path: reference.path,
          file: reference.file,
          line: reference.line,
          method: reference.method,
          details:
            'The route exists in Horizon source but not in the OpenAPI. Add it to SOURCE_ONLY_ALLOWED_PATHS only after confirming the OpenAPI gap is expected.',
        });
        continue;
      }

      sourceOnlyCount += 1;
      continue;
    }

    issues.push({
      type: 'missing_route',
      path: reference.path,
      file: reference.file,
      line: reference.line,
      method: reference.method,
      details:
        'The route is not present in either Horizon source or the local OpenAPI.',
    });
  }

  return {
    issues,
    verifiedCount,
    sourceOnlyCount,
    referencedCount: params.references.length,
  };
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function writeTruthArtifacts(params: {
  outputDir: string;
  horizonRoot: string;
  openApiPath: string;
  references: readonly McpPathReference[];
  horizonOperations: readonly NormalizedOperation[];
  openApiOperations: readonly NormalizedOperation[];
}): void {
  mkdirSync(params.outputDir, { recursive: true });

  writeJson(join(params.outputDir, 'horizon-routes.json'), {
    generatedAt: new Date().toISOString(),
    sourceRoot: params.horizonRoot,
    routeCount: params.horizonOperations.length,
    routes: params.horizonOperations,
  });
  writeJson(join(params.outputDir, 'openapi-operations.json'), {
    generatedAt: new Date().toISOString(),
    openApiPath: params.openApiPath,
    operationCount: params.openApiOperations.length,
    operations: params.openApiOperations,
  });
  writeJson(join(params.outputDir, 'mcp-api-paths.json'), {
    generatedAt: new Date().toISOString(),
    referenceCount: params.references.length,
    references: params.references,
  });
}
