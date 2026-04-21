import { describe, expect, it } from 'vitest';

import {
  SOURCE_ONLY_ALLOWED_PATHS,
  normalizeRoutePath,
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
