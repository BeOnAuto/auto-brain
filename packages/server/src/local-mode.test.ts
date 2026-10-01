import { describe, expect, it } from 'vitest';

import { isLocalMode } from './local-mode.ts';

describe('isLocalMode', () => {
  it.each(['127.0.0.1', '127.1.2.3', '127.255.255.255', '::1', '0:0:0:0:0:0:0:1', 'localhost'])(
    'is on when the server listens on the loopback address %s and no API keys are configured',
    (host) => {
      expect(isLocalMode({ host, apiKeysConfigured: false })).toBe(true);
    },
  );

  it.each(['0.0.0.0', '::', '10.0.0.1', '192.168.1.10', '128.0.0.1', 'auto-brain.example'])(
    'is off when the server listens on %s',
    (host) => {
      expect(isLocalMode({ host, apiKeysConfigured: false })).toBe(false);
    },
  );

  it('is off on loopback once API keys are configured', () => {
    expect(isLocalMode({ host: '127.0.0.1', apiKeysConfigured: true })).toBe(false);
  });
});
