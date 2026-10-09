import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  loadedRunOf,
  RunLogEventSchema,
  snapshotFromChunks,
  stateFormats,
  stateInCurrentFormat,
  StateFormatSchema,
} from '../index.ts';

const StoredEventsSchema = Schema.Array(Schema.Struct({ version: Schema.Int, event: RunLogEventSchema }));

const CorpusSchema = Schema.Struct({
  format: StateFormatSchema,
  stream: StoredEventsSchema,
  snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String), bytes: Schema.Int, tail: StoredEventsSchema }),
  state: Schema.Json,
});

type Corpus = typeof CorpusSchema.Type;

const decodeCorpus = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusSchema));

const directory = fileURLToPath(new URL('../../corpus/', import.meta.url));

const corpora: readonly Corpus[] = readdirSync(directory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => decodeCorpus(readFileSync(`${directory}${name}`, 'utf8')));

function loadedBothWays({ stream, snapshot }: Corpus): readonly unknown[] {
  const whole = loadedRunOf({ snapshot: null, tail: stream });
  const fromSnapshot = loadedRunOf({
    snapshot: { snapshot: Result.getOrThrow(snapshotFromChunks(snapshot.chunks)), bytes: snapshot.bytes },
    tail: snapshot.tail,
  });
  return [whole.state, fromSnapshot.state, whole.version, fromSnapshot.version];
}

describe('the committed corpus of past state formats', () => {
  it('holds a stream and a snapshot for every state format up to the current one', () => {
    expect(corpora.map(({ format }) => format).toSorted((first, second) => first - second)).toEqual(
      Array.from({ length: stateFormats.current }, (_, index) => index + 1),
    );
  });

  it('still loads, from the whole stream and from the snapshot and its tail, to the state it recorded', () => {
    expect(corpora.map((corpus) => loadedBothWays(corpus))).toEqual(
      corpora.map(({ format, state, stream }) => {
        const recorded = stateInCurrentFormat(format, state);
        return [recorded, recorded, stream.length, stream.length];
      }),
    );
  });
});
