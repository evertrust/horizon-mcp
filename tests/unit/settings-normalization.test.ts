import { describe, expect, it } from 'vitest';

import { loadSettings } from '../../src/settings.js';

const API_KEY_ENV = {
  HORIZON_API_ID: 'settings-test',
  HORIZON_API_KEY: 'settings-secret',
};

describe('loadSettings URL normalization', () => {
  it('strips a single trailing slash', () => {
    const settings = loadSettings({
      ...API_KEY_ENV,
      HORIZON_URL: 'https://horizon.example.com/',
    });
    expect(settings.url).toBe('https://horizon.example.com');
  });

  it('strips multiple trailing slashes', () => {
    const settings = loadSettings({
      ...API_KEY_ENV,
      HORIZON_URL: 'https://horizon.example.com///',
    });
    expect(settings.url).toBe('https://horizon.example.com');
  });

  it('leaves URL without trailing slash unchanged', () => {
    const settings = loadSettings({
      ...API_KEY_ENV,
      HORIZON_URL: 'https://horizon.example.com',
    });
    expect(settings.url).toBe('https://horizon.example.com');
  });

  it('preserves path segments that are not trailing', () => {
    const settings = loadSettings({
      ...API_KEY_ENV,
      HORIZON_URL: 'https://horizon.example.com/api/',
    });
    expect(settings.url).toBe('https://horizon.example.com/api');
  });
});
