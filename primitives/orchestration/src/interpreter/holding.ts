import type { Json } from '@beonauto/workflow-engine/dsl/json';

import { raised } from './raised-error.ts';
import { retainedBytesOf } from './retained-size.ts';

export type Release = () => void;

export type Hold = (values: readonly Json[], reference: string) => Release;

export const mostHeldBytes = 16_777_216;

export const taskFrameBytes = 4096;

interface Holding {
  readonly bytes: number;
  count: number;
}

export function makeHolding(): Hold {
  const objects = new Map<object, Holding>();
  let held = 0;
  const holdOne = (value: Json): Release => {
    if (typeof value !== 'object' || value === null) {
      const bytes = retainedBytesOf(value);
      held += bytes;
      return () => {
        held -= bytes;
      };
    }
    const known = objects.get(value);
    const holding = known ?? { bytes: retainedBytesOf(value), count: 0 };
    objects.set(value, holding);
    holding.count += 1;
    held += known === undefined ? holding.bytes : 0;
    return () => {
      holding.count -= 1;
      if (holding.count === 0) {
        objects.delete(value);
        held -= holding.bytes;
      }
    };
  };
  return (values, reference) => {
    const releases = values.map((value) => holdOne(value));
    held += taskFrameBytes;
    let released = false;
    const release: Release = () => {
      if (!released) {
        released = true;
        held -= taskFrameBytes;
        for (const releaseOne of releases) {
          releaseOne();
        }
      }
    };
    if (held > mostHeldBytes) {
      const holding = held;
      release();
      throw raised(
        'runtime',
        500,
        `The workflow would hold about ${holding} bytes of data at once, more than the ${mostHeldBytes} a workflow may hold`,
        reference,
      );
    }
    return release;
  };
}
