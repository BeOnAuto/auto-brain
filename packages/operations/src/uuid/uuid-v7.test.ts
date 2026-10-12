import { describe, expect, it } from 'vitest';

import { randomUUIDv7, uuidV7Before, uuidV7TimeOf } from './uuid-v7.ts';

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

  it('tells the time it carries, as the 12 hex digits it starts with, and whether it was made before a time', () => {
    const at = 1_791_778_446_256;
    const id = randomUUIDv7();

    expect(uuidV7TimeOf(at)).toBe('01a12e515bb0');
    expect(uuidV7TimeOf(1)).toBe('000000000001');
    expect([uuidV7Before(id, Date.now() + 1), uuidV7Before(id, millisecondsOf(id))]).toEqual([true, false]);
    expect([
      uuidV7Before('01a12e51-5bb0-7000-8000-000000000001', at),
      uuidV7Before('01a12e51-5baf-7000-8000-000000000001', at),
    ]).toEqual([false, true]);
  });

  it('differs between ids made in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomUUIDv7()));

    expect(ids.size).toBe(1000);
  });
});
