import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PublicEventSchema, mostPublicEventDataBytes } from '../index.ts';

const decodeEvent = Schema.decodeUnknownResult(PublicEventSchema);

function eventWithData(bytes: number) {
  const free = bytes - JSON.stringify({ text: '' }).length;
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL3NhbGVzLyIsIjQyIl0',
    causation_id: null,
    at: '2026-10-05T09:00:00.000Z',
    type: 'run_started',
    summary: 'A run of the summary reasoning started',
    data: { text: `${'é'.repeat(Math.floor(free / 2))}${'a'.repeat(free % 2)}` },
  };
}

describe('a public event', () => {
  it('carries data of up to 4 KiB as JSON in UTF-8', () => {
    const largest = eventWithData(mostPublicEventDataBytes);

    expect(decodeEvent(largest)).toEqual(Result.succeed(largest));
  });

  it('is refused with data of more than 4 KiB', () => {
    expect(Result.isFailure(decodeEvent(eventWithData(mostPublicEventDataBytes + 1)))).toBe(true);
  });
});
