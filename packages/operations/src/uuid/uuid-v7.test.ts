import { describe, expect, it } from 'vitest';

import { randomUUIDv7 } from './uuid-v7.ts';

const uuidV7 = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

function millisecondsOf(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

describe('a UUID version 7', () => {
  it('is a version 7, RFC 9562 variant UUID in lowercase hex', () => {
    expect(randomUUIDv7()).toMatch(uuidV7);
  });

  it('starts with the Unix time in milliseconds it was made at', () => {
    const before = Date.now();
    const id = randomUUIDv7();
    const after = Date.now();

    expect(millisecondsOf(id)).toBeGreaterThanOrEqual(before);
    expect(millisecondsOf(id)).toBeLessThanOrEqual(after);
  });

  it('sorts later ids after earlier ones', async () => {
    const earlier = randomUUIDv7();
    await new Promise((resolve) => {
      setTimeout(resolve, 2);
    });
    const later = randomUUIDv7();

    expect([later, earlier].toSorted()).toEqual([earlier, later]);
  });

  it('differs between ids made in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomUUIDv7()));

    expect(ids.size).toBe(1000);
  });
});
