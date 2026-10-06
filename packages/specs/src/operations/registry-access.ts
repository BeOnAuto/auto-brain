import { BrainReader, BrainWriter } from '@beonauto/operations';
import { Effect } from 'effect';

import type { Primitive } from '../primitive/primitive.ts';
import { findSpec } from '../registry/registry-lookup.ts';
import type { SpecCommandData } from '../registry/spec-commands.ts';
import type { SpecRegistry } from '../registry/spec-registry.ts';
import { specsDecider, specsStreamOf } from '../registry/specs-decider.ts';
import { commandMetadata } from './command-metadata.ts';

export function loadRegistry(primitive: string): Effect.Effect<SpecRegistry, never, BrainReader> {
  return BrainReader.use((reader) => reader.load(specsStreamOf(primitive), specsDecider(primitive))).pipe(
    Effect.map(({ state }) => state),
  );
}

export const recordInRegistry = Effect.fnUntraced(function* (
  { name: primitive, mostActive }: Pick<Primitive, 'name' | 'mostActive'>,
  data: SpecCommandData,
) {
  const metadata = yield* commandMetadata;
  const { state } = yield* (yield* BrainWriter).execute(specsStreamOf(primitive), specsDecider(primitive, mostActive), {
    ...data,
    ...metadata,
  });
  return yield* Effect.orDie(findSpec(state, primitive, data.name));
});
