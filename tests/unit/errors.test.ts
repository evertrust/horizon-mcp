import { describe, expect, it } from 'vitest';

import { HorizonError, parseErrorResponse } from '../../src/client/errors.js';

describe('HorizonError', () => {
  describe('message formatting', () => {
    it('formats with status code only', () => {
      const err = new HorizonError(500);
      expect(err.message).toBe('Horizon API error 500');
      expect(err.statusCode).toBe(500);
    });

    it('includes error code in brackets', () => {
      const err = new HorizonError(404, { errorCode: 'CRT-003' });
      expect(err.message).toContain('Horizon API error 404 [CRT-003]');
    });

    it('includes message text', () => {
      const err = new HorizonError(400, {
        errorCode: 'VAL-002',
        message: 'Invalid field value',
      });
      expect(err.message).toContain('Invalid field value');
    });

    it("includes detail with 'Detail:' prefix", () => {
      const err = new HorizonError(422, {
        message: 'Validation error',
        detail: "Field 'dn' is required",
      });
      expect(err.message).toContain("Detail: Field 'dn' is required");
    });

    it("includes remediation with 'Hint:' prefix", () => {
      const err = new HorizonError(401, {
        errorCode: 'SecAuth001',
        remediation: 'Check your credentials',
      });
      expect(err.message).toContain('Hint: Check your credentials');
    });

    it('formats all parts together separated by periods', () => {
      const err = new HorizonError(400, {
        errorCode: 'HQL-001',
        message: 'Parse error',
        detail: 'Unexpected token at pos 5',
        remediation: 'Fix the query',
      });
      expect(err.message).toBe(
        'Horizon API error 400 [HQL-001]. Parse error. ' +
          'Detail: Unexpected token at pos 5. Hint: Fix the query',
      );
    });
  });

  describe('properties', () => {
    it('exposes name as HorizonError', () => {
      const err = new HorizonError(500);
      expect(err.name).toBe('HorizonError');
    });

    it('is an instance of Error', () => {
      const err = new HorizonError(500);
      expect(err).toBeInstanceOf(Error);
    });

    it('stores statusCode, errorCode, detail, and remediation', () => {
      const err = new HorizonError(422, {
        errorCode: 'TEST-001',
        detail: 'some detail',
        remediation: 'some hint',
      });
      expect(err.statusCode).toBe(422);
      expect(err.errorCode).toBe('TEST-001');
      expect(err.detail).toBe('some detail');
      expect(err.remediation).toBe('some hint');
    });
  });

  describe('toToolResult', () => {
    it('returns the formatted message string', () => {
      const err = new HorizonError(500, { message: 'Internal error' });
      expect(err.toToolResult()).toBe(err.message);
    });
  });
});

describe('parseErrorResponse', () => {
  describe('nested error object format', () => {
    it('extracts code and message from error object', () => {
      const body = JSON.stringify({
        error: { code: 'CRT-003', message: 'Certificate not found' },
      });
      const err = parseErrorResponse(404, body);

      expect(err.statusCode).toBe(404);
      expect(err.errorCode).toBe('CRT-003');
      expect(err.message).toContain('Certificate not found');
    });

    it('extracts detail from nested error object', () => {
      const body = JSON.stringify({
        error: {
          code: 'VAL-002',
          message: 'Validation failed',
          detail: "Field 'dn' cannot be empty",
        },
      });
      const err = parseErrorResponse(400, body);

      expect(err.detail).toBe("Field 'dn' cannot be empty");
    });

    it('falls back to top-level message when error object has no message', () => {
      const body = JSON.stringify({
        error: { code: 'ERR-001' },
        message: 'Top-level message',
      });
      const err = parseErrorResponse(500, body);

      expect(err.message).toContain('Top-level message');
    });

    it('falls back to top-level title when no message fields exist', () => {
      const body = JSON.stringify({
        error: { code: 'ERR-001' },
        title: 'Something went wrong',
      });
      const err = parseErrorResponse(500, body);

      expect(err.message).toContain('Something went wrong');
    });

    it('uses error.error as errorCode when error.code is absent', () => {
      const body = JSON.stringify({
        error: { error: 'ALT-CODE', message: 'Alternative format' },
      });
      const err = parseErrorResponse(400, body);

      expect(err.errorCode).toBe('ALT-CODE');
    });
  });

  describe('flat error format', () => {
    it('extracts error string as errorCode from top level', () => {
      const body = JSON.stringify({
        error: 'CRT-003',
        message: 'Not found',
      });
      const err = parseErrorResponse(404, body);

      expect(err.errorCode).toBe('CRT-003');
      expect(err.message).toContain('Not found');
    });

    it('uses top-level code when error is absent', () => {
      const body = JSON.stringify({
        code: 'FLAT-001',
        message: 'Flat format',
      });
      const err = parseErrorResponse(400, body);

      expect(err.errorCode).toBe('FLAT-001');
    });

    it('extracts top-level detail', () => {
      const body = JSON.stringify({
        error: 'ERR-002',
        message: 'Failed',
        detail: 'Specific reason',
      });
      const err = parseErrorResponse(422, body);

      expect(err.detail).toBe('Specific reason');
    });
  });

  describe('sensitive field redaction', () => {
    it('redacts apiKey in response body', () => {
      const body = JSON.stringify({
        error: { code: 'ERR-001', message: 'Auth error' },
        apiKey: 'secret-api-key-12345',
      });
      const err = parseErrorResponse(401, body);

      expect(err.message).not.toContain('secret-api-key-12345');
    });

    it('redacts password field', () => {
      const body = JSON.stringify({
        error: 'ERR-001',
        message: 'Error with context',
        password: 'my-password',
      });
      const err = parseErrorResponse(400, body);

      expect(err.message).not.toContain('my-password');
    });

    it('redacts nested sensitive fields', () => {
      const body = JSON.stringify({
        error: {
          code: 'ERR-001',
          message: 'Error',
          detail: 'failure',
        },
        credentials: {
          apiKey: 'nested-secret',
          token: 'bearer-token-xyz',
        },
      });
      const err = parseErrorResponse(500, body);

      expect(err.message).not.toContain('nested-secret');
      expect(err.message).not.toContain('bearer-token-xyz');
    });

    it('redacts all known sensitive field names', () => {
      const sensitiveFields = [
        'apiKey',
        'apiSecret',
        'password',
        'secret',
        'privateKey',
        'clientSecret',
        'token',
        'csrfToken',
        'passphrase',
        'credential',
      ];

      for (const field of sensitiveFields) {
        const body = JSON.stringify({
          error: 'ERR-001',
          message: 'test',
          [field]: `value-of-${field}`,
        });
        const err = parseErrorResponse(400, body);
        expect(err.message).not.toContain(`value-of-${field}`);
      }
    });
  });

  describe('remediation hint resolution', () => {
    it('resolves HQL-001 to query syntax hint', () => {
      const body = JSON.stringify({
        error: { code: 'HQL-001', message: 'Parse error' },
      });
      const err = parseErrorResponse(400, body);

      expect(err.remediation).toContain('validate_hcql/hrql/heql');
    });

    it('resolves SecAuth001 to authentication hint', () => {
      const body = JSON.stringify({
        error: { code: 'SecAuth001', message: 'Unauthorized' },
      });
      const err = parseErrorResponse(401, body);

      expect(err.remediation).toContain('Authentication failed');
      expect(err.remediation).toContain('HORIZON_API_ID');
    });

    it('resolves suffix 003 to not-found hint', () => {
      const body = JSON.stringify({
        error: { code: 'CRT-003', message: 'Certificate not found' },
      });
      const err = parseErrorResponse(404, body);

      expect(err.remediation).toContain('Not found');
      expect(err.remediation).toContain('list_*');
    });

    it('resolves suffix 004 to already-exists hint', () => {
      const body = JSON.stringify({
        error: { code: 'PRF-004', message: 'Profile already exists' },
      });
      const err = parseErrorResponse(409, body);

      expect(err.remediation).toContain('Already exists');
      expect(err.remediation).toContain('update_*');
    });

    it('returns undefined remediation for unknown error codes', () => {
      const body = JSON.stringify({
        error: { code: 'UNKNOWN-999', message: 'Unknown error' },
      });
      const err = parseErrorResponse(500, body);

      expect(err.remediation).toBeUndefined();
    });

    it('returns undefined remediation when no error code', () => {
      const body = JSON.stringify({ message: 'Generic error' });
      const err = parseErrorResponse(500, body);

      expect(err.remediation).toBeUndefined();
    });
  });

  describe('invalid JSON body fallback', () => {
    it('uses raw body text as message when JSON is invalid', () => {
      const err = parseErrorResponse(502, 'Bad Gateway from nginx');

      expect(err.statusCode).toBe(502);
      expect(err.message).toContain('Bad Gateway from nginx');
    });

    it('truncates raw body at 500 characters', () => {
      const longBody = 'x'.repeat(600);
      const err = parseErrorResponse(500, longBody);

      expect(err.message).toContain('x'.repeat(500));
      expect(err.message).not.toContain('x'.repeat(501));
    });

    it('falls through to empty parsed JSON for empty body', () => {
      // Empty string parses as falsy, so JSON.parse is skipped and raw = {}
      // The result is a HorizonError with no errorCode and empty message
      const err = parseErrorResponse(504, '');

      expect(err.statusCode).toBe(504);
      expect(err.message).toContain('Horizon API error 504');
    });
  });
});
