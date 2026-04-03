import { describe, expect, it } from 'vitest';

import { STRIP_FIELDS, toUpdatePayload } from '../../src/models/payloads.js';

describe('toUpdatePayload', () => {
  describe('profile domain stripping', () => {
    it('strips server-populated profile fields', () => {
      const response = {
        _id: 'mongo-id-123',
        id: 'uuid-456',
        createdAt: '2024-01-01',
        updatedAt: '2024-06-15',
        lastModifiedBy: 'admin',
        statistics: { total: 100 },
        status: 'active',
        certificateCount: 42,
        name: 'TLS-Profile',
        dn: 'CN=test',
        module: 'nCipher',
      };
      const payload = toUpdatePayload(response, { domain: 'profile' });

      expect(payload).not.toHaveProperty('_id');
      expect(payload).not.toHaveProperty('id');
      expect(payload).not.toHaveProperty('createdAt');
      expect(payload).not.toHaveProperty('updatedAt');
      expect(payload).not.toHaveProperty('lastModifiedBy');
      expect(payload).not.toHaveProperty('statistics');
      expect(payload).not.toHaveProperty('status');
      expect(payload).not.toHaveProperty('certificateCount');
      expect(payload.name).toBe('TLS-Profile');
      expect(payload.dn).toBe('CN=test');
      expect(payload.module).toBe('nCipher');
    });

    it('defaults to profile domain when domain is omitted', () => {
      const response = {
        _id: 'id',
        lastModifiedBy: 'admin',
        name: 'Test',
      };
      const payload = toUpdatePayload(response);

      expect(payload).not.toHaveProperty('_id');
      expect(payload).not.toHaveProperty('lastModifiedBy');
      expect(payload.name).toBe('Test');
    });
  });

  describe('other domain stripping', () => {
    it('strips CA-specific fields for ca domain', () => {
      const response = {
        _id: 'id',
        id: 'uuid',
        createdAt: '2024-01-01',
        updatedAt: '2024-06-15',
        certificate: { dn: 'CN=ca' },
        crlCache: [],
        statistics: {},
        name: 'My-CA',
        issuerDn: 'CN=root',
      };
      const payload = toUpdatePayload(response, { domain: 'ca' });

      expect(payload).not.toHaveProperty('_id');
      expect(payload).not.toHaveProperty('certificate');
      expect(payload).not.toHaveProperty('crlCache');
      expect(payload).not.toHaveProperty('statistics');
      expect(payload.name).toBe('My-CA');
      expect(payload.issuerDn).toBe('CN=root');
    });

    it('strips trigger-specific fields for trigger domain', () => {
      const response = {
        _id: 'id',
        id: 'uuid',
        createdAt: '2024-01-01',
        updatedAt: '2024-06-15',
        lastRun: '2024-06-14',
        statistics: {},
        name: 'expiry-trigger',
        type: 'webhook',
      };
      const payload = toUpdatePayload(response, { domain: 'trigger' });

      expect(payload).not.toHaveProperty('_id');
      expect(payload).not.toHaveProperty('lastRun');
      expect(payload).not.toHaveProperty('statistics');
      expect(payload.name).toBe('expiry-trigger');
      expect(payload.type).toBe('webhook');
    });
  });

  describe('overrides', () => {
    it('applies override values to the payload', () => {
      const response = { name: 'old-name', dn: 'CN=old' };
      const payload = toUpdatePayload(response, {
        domain: 'profile',
        overrides: { dn: 'CN=new' },
      });

      expect(payload.dn).toBe('CN=new');
      expect(payload.name).toBe('old-name');
    });

    it('ignores null override values', () => {
      const response = { name: 'test', dn: 'CN=test' };
      const payload = toUpdatePayload(response, {
        domain: 'profile',
        overrides: { dn: null },
      });

      expect(payload.dn).toBe('CN=test');
    });

    it('ignores undefined override values', () => {
      const response = { name: 'test', dn: 'CN=test' };
      const payload = toUpdatePayload(response, {
        domain: 'profile',
        overrides: { dn: undefined },
      });

      expect(payload.dn).toBe('CN=test');
    });

    it('adds new fields via overrides', () => {
      const response = { name: 'test' };
      const payload = toUpdatePayload(response, {
        domain: 'profile',
        overrides: { newField: 'added' },
      });

      expect(payload.newField).toBe('added');
    });
  });

  describe('clearFields', () => {
    it('sets cleared fields to null', () => {
      const response = { name: 'test', description: 'old desc' };
      const payload = toUpdatePayload(response, {
        domain: 'profile',
        clearFields: ['description'],
      });

      expect(payload.description).toBeNull();
    });

    it('can clear multiple fields', () => {
      const response = { name: 'test', description: 'desc', tags: ['a'] };
      const payload = toUpdatePayload(response, {
        domain: 'profile',
        clearFields: ['description', 'tags'],
      });

      expect(payload.description).toBeNull();
      expect(payload.tags).toBeNull();
    });

    it('overrides take precedence over clearFields', () => {
      // clearFields sets to null, then overrides writes a real value
      const response = { name: 'test', description: 'old' };
      const payload = toUpdatePayload(response, {
        domain: 'profile',
        clearFields: ['description'],
        overrides: { description: 'new' },
      });

      expect(payload.description).toBe('new');
    });
  });

  describe('unknown domain fallback', () => {
    it('falls back to baseline strip set for unknown domains', () => {
      const response = {
        _id: 'mongo-id',
        id: 'uuid',
        createdAt: '2024-01-01',
        updatedAt: '2024-06-15',
        name: 'test-object',
        customField: 'preserved',
      };
      const payload = toUpdatePayload(response, {
        domain: 'some_unknown_domain',
      });

      expect(payload).not.toHaveProperty('_id');
      expect(payload).not.toHaveProperty('id');
      expect(payload).not.toHaveProperty('createdAt');
      expect(payload).not.toHaveProperty('updatedAt');
      expect(payload.name).toBe('test-object');
      expect(payload.customField).toBe('preserved');
    });

    it('baseline strips only _id, id, createdAt, updatedAt', () => {
      const response = {
        _id: 'id',
        id: 'uuid',
        createdAt: 'ts1',
        updatedAt: 'ts2',
        statistics: { kept: true },
        lastModifiedBy: 'also-kept',
      };
      const payload = toUpdatePayload(response, {
        domain: 'nonexistent_domain',
      });

      // baseline does NOT strip statistics or lastModifiedBy
      expect(payload.statistics).toEqual({ kept: true });
      expect(payload.lastModifiedBy).toBe('also-kept');
    });
  });

  describe('immutability', () => {
    it('does not mutate the original response object', () => {
      const response = { _id: 'id', name: 'test', dn: 'CN=test' };
      const original = { ...response };
      toUpdatePayload(response, {
        domain: 'profile',
        overrides: { dn: 'CN=new' },
        clearFields: ['name'],
      });

      expect(response).toEqual(original);
    });
  });

  describe('STRIP_FIELDS registry', () => {
    it('has entries for all expected domains', () => {
      const expectedDomains = [
        'profile',
        'ca',
        'connector',
        'trigger',
        'label',
        'proxy',
        'datasource',
        'role',
        'team',
        'idp',
        'grading_policy',
        'grading_ruleset',
        'password_policy',
        'principal',
        'discovery_campaign',
        'automation_policy',
        'execution_policy',
        'wcce_forest',
        'local_identity',
        'scheduled_task',
      ];

      for (const domain of expectedDomains) {
        expect(
          STRIP_FIELDS[domain],
          `Missing strip fields for domain: ${domain}`,
        ).toBeDefined();
      }
    });

    it('every domain strips at least _id', () => {
      for (const [domain, fields] of Object.entries(STRIP_FIELDS)) {
        expect(fields.has('_id'), `Domain '${domain}' should strip _id`).toBe(
          true,
        );
      }
    });
  });
});
