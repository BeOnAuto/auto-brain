import { describe, expect, it } from 'vitest';

import { redactedUrlAttributes } from './redacted-url.ts';

describe('the URL of an outbound request on its span', () => {
  it('keeps the origin and the path, and redacts every value of the query and the credentials', () => {
    expect(
      redactedUrlAttributes({
        origin: 'https://user:secret@gateway.example.com',
        path: '/v1/chat?api-key=sk-123&api-key=sk-456&model=x',
      }),
    ).toEqual({
      'url.full': 'https://gateway.example.com/v1/chat?api-key=REDACTED&model=REDACTED',
      'url.query': '?api-key=REDACTED&model=REDACTED',
    });
  });

  it('is left to the instrumentation when the request names no URL', () => {
    expect(redactedUrlAttributes({ origin: 'not a url', path: 'nor this' })).toEqual({});
  });
});
