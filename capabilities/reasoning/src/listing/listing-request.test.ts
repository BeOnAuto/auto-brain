import { describe, expect, it } from 'vitest';

import { endpointUrl } from './listing-request.ts';

describe('the address of a listing', () => {
  it('is built once from a base URL that ends in several slashes, and reads a long run of them once', () => {
    const run = '/'.repeat(200_000);

    expect([
      endpointUrl('https://llm.internal.example/v1///', '/models').href,
      endpointUrl(`https://llm.internal.example${run}v1`, '/models').href,
    ]).toEqual(['https://llm.internal.example/v1/models', `https://llm.internal.example${run}v1/models`]);
  });
});
