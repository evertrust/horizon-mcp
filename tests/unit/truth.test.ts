import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SOURCE_ONLY_ALLOWED_PATHS,
  collectHorizonOperations,
  collectOpenApiOperations,
  normalizeRoutePath,
  resolveTruthInputs,
  verifyMcpRouteTruth,
} from '../../scripts/lib/truth.js';

describe('normalizeRoutePath', () => {
  it('normalizes Horizon source route syntax into OpenAPI-like placeholders', () => {
    expect(
      normalizeRoutePath('/api/v1/certificates/$id<[0-9a-fA-F]{24}>'),
    ).toBe('/api/v1/certificates/{id}');
    expect(
      normalizeRoutePath(
        '/api/v1/certificate/grading/policies/:policy/explain/:input',
      ),
    ).toBe('/api/v1/certificate/grading/policies/{policy}/explain/{input}');
    expect(
      normalizeRoutePath('/api/v1/security/principals/${principalId}'),
    ).toBe('/api/v1/security/principals/{param}');
  });
});

describe('verifyMcpRouteTruth', () => {
  it('requires explicit allowlisting for source-only routes', () => {
    const result = verifyMcpRouteTruth({
      horizonOperations: [
        {
          method: 'POST',
          path: '/api/v1/rfc5280/crl',
          sourceFile: 'conf/api.rfc5280.routes',
        },
      ],
      openApiOperations: [],
      references: [
        {
          path: '/api/v1/rfc5280/crl',
          rawPath: '/api/v1/rfc5280/crl',
          file: 'src/tools/assist/crypto.ts',
          line: 273,
          method: 'POST',
        },
      ],
      sourceOnlyAllowlist: new Set<string>(),
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe('source_only_not_allowlisted');
  });

  it('accepts the known source-only CRL route when allowlisted', () => {
    const result = verifyMcpRouteTruth({
      horizonOperations: [
        {
          method: 'POST',
          path: '/api/v1/rfc5280/crl',
          sourceFile: 'conf/api.rfc5280.routes',
        },
      ],
      openApiOperations: [],
      references: [
        {
          path: '/api/v1/rfc5280/crl',
          rawPath: '/api/v1/rfc5280/crl',
          file: 'src/tools/assist/crypto.ts',
          line: 273,
          method: 'POST',
        },
      ],
      sourceOnlyAllowlist: SOURCE_ONLY_ALLOWED_PATHS,
    });

    expect(result.issues).toEqual([]);
    expect(result.sourceOnlyCount).toBe(1);
  });

  it('flags routes missing from both source and OpenAPI', () => {
    const result = verifyMcpRouteTruth({
      horizonOperations: [],
      openApiOperations: [],
      references: [
        {
          path: '/api/v1/imaginary/route',
          rawPath: '/api/v1/imaginary/route',
          file: 'src/tools/example.ts',
          line: 12,
          method: 'GET',
        },
      ],
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe('missing_route');
  });

  it('flags method mismatches when a route exists with other verbs only', () => {
    const result = verifyMcpRouteTruth({
      horizonOperations: [
        {
          method: 'POST',
          path: '/api/v1/datasource/flows',
          sourceFile: 'conf/api.datasource.flow.routes',
        },
      ],
      openApiOperations: [],
      references: [
        {
          path: '/api/v1/datasource/flows',
          rawPath: '/api/v1/datasource/flows',
          file: 'src/tools/example.ts',
          line: 8,
          method: 'GET',
        },
      ],
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe('method_mismatch');
  });
});

describe('resolveTruthInputs', () => {
  it('falls back to checked-in truth artifacts when external inputs are unavailable', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'horizon-truth-'));
    const artifactDir = join(projectRoot, 'src/generated/docs');

    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, 'horizon-routes.json'),
      JSON.stringify({
        generatedAt: '2026-04-22T00:00:00.000Z',
        sourceRoot: '../horizon',
        routeCount: 1,
        routes: [
          {
            method: 'GET',
            path: '/api/v1/certificates',
            sourceFile: '../horizon/conf/api.certificate.routes',
          },
        ],
      }),
      'utf8',
    );
    writeFileSync(
      join(artifactDir, 'openapi-operations.json'),
      JSON.stringify({
        generatedAt: '2026-04-22T00:00:00.000Z',
        openApiPath: '../evertrust_horizon_openapi.json',
        operationCount: 1,
        operations: [
          {
            method: 'GET',
            path: '/api/v1/certificates',
            sourceFile: '../evertrust_horizon_openapi.json',
          },
        ],
      }),
      'utf8',
    );

    try {
      const inputs = resolveTruthInputs(projectRoot);

      expect(inputs.horizonRoot).toBe(join(artifactDir, 'horizon-routes.json'));
      expect(inputs.openApiPath).toBe(
        join(artifactDir, 'openapi-operations.json'),
      );
      expect(collectHorizonOperations(inputs.horizonRoot, projectRoot)).toEqual(
        [
          {
            method: 'GET',
            path: '/api/v1/certificates',
            sourceFile: '../horizon/conf/api.certificate.routes',
          },
        ],
      );
      expect(collectOpenApiOperations(inputs.openApiPath, projectRoot)).toEqual(
        [
          {
            method: 'GET',
            path: '/api/v1/certificates',
            sourceFile: '../evertrust_horizon_openapi.json',
          },
        ],
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
