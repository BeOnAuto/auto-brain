import { Conflict } from '@beonauto/operations';
import { Effect } from 'effect';

import type { Primitive } from '../primitive/primitive.ts';
import { findSpec } from '../registry/registry-lookup.ts';
import type { StoredSpec } from '../registry/spec.ts';
import type { Rejection } from './issue-pointers.ts';
import { loadRegistry } from './registry-access.ts';

const activeSpec = Effect.fnUntraced(function* (primitive: string, name: string) {
  const spec = yield* findSpec(yield* loadRegistry(primitive), primitive, name);
  if (spec.status === 'retired') {
    return yield* new Conflict({ detail: `The ${primitive} spec ${name} is retired and can no longer be executed` });
  }
  return spec;
});

function unparseable(primitive: string, { name, version }: StoredSpec): (rejection: Rejection) => Conflict {
  return ({ detail }) =>
    new Conflict({
      detail: `The ${primitive} spec ${name} at version ${version} no longer parses (${detail}); update it`,
    });
}

export const preparedSpec = Effect.fnUntraced(function* (primitive: Primitive, name: string) {
  const spec = yield* activeSpec(primitive.name, name);
  const prepared = yield* primitive.prepare(spec.source).pipe(Effect.mapError(unparseable(primitive.name, spec)));
  return { spec, prepared };
});
