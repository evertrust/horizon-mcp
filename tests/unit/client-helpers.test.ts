import { describe, expect, it } from 'vitest';

import { versionCompatibilityLog } from '../../src/client/client-helpers.js';

describe('versionCompatibilityLog', () => {
  it('suppresses tested versions and classifies warned and unknown versions', () => {
    expect(
      versionCompatibilityLog('2.10.3', ['2.10'], ['2.8', '2.9']),
    ).toBeNull();
    expect(versionCompatibilityLog('2.8.3', ['2.10'], ['2.8', '2.9'])).toEqual({
      level: 'warning',
      message:
        'Horizon version 2.8.3 - partially tested, some features may not work as expected',
    });
    expect(versionCompatibilityLog('2.7.3', ['2.10'], ['2.8', '2.9'])).toEqual({
      level: 'warning',
      message: 'Horizon version 2.7.3 - untested, proceed with caution',
    });
  });
});
