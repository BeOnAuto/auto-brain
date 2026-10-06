import {
  BrainContext,
  BrainReader,
  BrainWriter,
  messageIdOf,
  NotFound,
  streamPrefixOfBrain,
} from '@beonauto/operations';
import { Effect } from 'effect';

import { definitionResourceLabel } from '../primitive/function-terminology.ts';
import { findSpec } from '../registry/registry-lookup.ts';
import type { SpecCommandData } from '../registry/spec-commands.ts';
import type { SpecRegistry } from '../registry/spec-registry.ts';
import { specVersionDecider, type RecordedVersion } from '../registry/spec-versions.ts';
import type { StoredDefinition } from '../registry/spec.ts';
import { specsDecider, specsStreamOf } from '../registry/specs-decider.ts';
import { commandMetadata } from './command-metadata.ts';

export function loadRegistry(primitive: string): Effect.Effect<SpecRegistry, never, BrainReader> {
  return BrainReader.use((reader) => reader.load(specsStreamOf(primitive), specsDecider(primitive))).pipe(
    Effect.map(({ state }) => state),
  );
}

export function recordedVersionOf(
  primitive: string,
  name: string,
  version: number,
): Effect.Effect<RecordedVersion, NotFound, BrainReader> {
  return BrainReader.use((reader) => reader.load(specsStreamOf(primitive), specVersionDecider(name, version))).pipe(
    Effect.flatMap(({ state: { found } }) =>
      found === undefined
        ? Effect.fail(
            new NotFound({
              detail: `There is no version ${version} of the ${definitionResourceLabel(primitive)} ${name} in this brain`,
            }),
          )
        : Effect.succeed(found),
    ),
  );
}

export const reactingSince = Effect.fnUntraced(function* (primitive: string, { name, version }: StoredDefinition) {
  const { position } = yield* Effect.orDie(recordedVersionOf(primitive, name, version));
  return messageIdOf(`${streamPrefixOfBrain(yield* BrainContext)}${specsStreamOf(primitive)}`, position);
});

export function versionOf(primitive: string, name: string, version: number) {
  return Effect.map(recordedVersionOf(primitive, name, version), ({ source }) => ({ name, version, source }));
}

export const recordInRegistry = Effect.fnUntraced(function* (primitive: string, data: SpecCommandData) {
  const metadata = yield* commandMetadata;
  const { state } = yield* (yield* BrainWriter).execute(specsStreamOf(primitive), specsDecider(primitive), {
    ...data,
    ...metadata,
  });
  return yield* Effect.orDie(findSpec(state, primitive, data.name));
});
