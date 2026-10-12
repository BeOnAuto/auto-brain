import { describe, expect, it } from 'vitest';

import { valueOf, wireOf, type ProcessValue } from './process-values.ts';

function acrossThePipe(value: ProcessValue): ProcessValue | undefined {
  const text: unknown = JSON.parse(JSON.stringify(wireOf(value)));
  return valueOf(text);
}

describe('a value crossing the pipe to a process', () => {
  it('keeps its JSON as it is and every kind of typed array as base64, typed again on the other side', () => {
    const value: ProcessValue = {
      plain: [null, true, 1.5, 'text', { nested: [] }],
      typed: [
        new Int8Array([-1, 2]),
        new Uint8Array([255]),
        new Uint8ClampedArray([3]),
        new Int16Array([-300]),
        new Uint16Array([60_000]),
        new Int32Array([-70_000]),
        new Uint32Array([4_000_000_000]),
        new Float32Array([0.5, Number.NaN]),
        new Float64Array([Math.PI]),
        new BigInt64Array([-5n]),
        new BigUint64Array([5n]),
      ],
    };

    expect(acrossThePipe(value)).toEqual(value);
  });

  it('sends the bytes a typed array views, not the whole buffer beneath it', () => {
    const buffer = new Float32Array([1, 2, 3, 4]);

    expect(acrossThePipe(buffer.subarray(1, 3))).toEqual(new Float32Array([2, 3]));
    expect(wireOf(new Uint8Array([1, 2, 3]))).toEqual({ $typed: 'Uint8Array', base64: 'AQID' });
  });

  it('reads an object of those two names that is not a typed array as an object, and one of more names as one too', () => {
    expect(valueOf({ $typed: 'Float32Array', base64: 'AQID', more: 1 })).toEqual({
      $typed: 'Float32Array',
      base64: 'AQID',
      more: 1,
    });
  });

  it.each<readonly [string, unknown]>([
    ['a typed array of a kind it does not know', { $typed: 'Float16Array', base64: 'AAA=' }],
    ['a typed array whose name is not text', { $typed: 4, base64: 'AAAA' }],
    ['a typed array whose bytes are not text', { $typed: 'Uint8Array', base64: 4 }],
    ['a typed array whose bytes do not fill its elements', { $typed: 'Float32Array', base64: 'AQID' }],
    ['a list holding something it cannot read', [1, { $typed: 'Nope', base64: '' }]],
    ['an object holding something it cannot read', { fine: 1, bad: { $typed: 'Nope', base64: '' } }],
    ['something that is not JSON', () => 1],
  ])('reads nothing from %s', (_what, wire) => {
    expect(valueOf(wire)).toBeUndefined();
  });
});
