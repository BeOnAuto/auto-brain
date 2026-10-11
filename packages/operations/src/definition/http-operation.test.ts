import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  InvalidInput,
  contentOfText,
  defineHttpOperation,
  textOfContent,
  type Outcome,
  type StreamedContent,
} from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { addNote } from '../testing/notes.ts';

const toAlpha = toBrain('acme', 'alpha');

const Nothing = Schema.Record(Schema.String, Schema.Never);

const octets = 'application/octet-stream';

const keepModel = defineHttpOperation('brain', 'command', {
  name: 'keep_model',
  title: 'Keep model',
  description: 'Keeps the bytes of a model.',
  route: { method: 'POST', path: '/models/{id}' },
  body: { kind: 'octet-stream', mostBytes: 1024 },
  inputSchema: Schema.Struct({ id: Schema.String }),
  outputSchema: Schema.Struct({ id: Schema.String, bytes: Schema.Number, media_type: Schema.String }),
  reasons: ['invalid_input'],
  handle: ({ id }, body) =>
    body.bytes === 0
      ? Effect.fail(new InvalidInput({ detail: 'The model is empty', issues: [] }))
      : Effect.succeed({ id, bytes: body.bytes, media_type: body.mediaType }),
});

const readModel = defineHttpOperation('brain', 'query', {
  name: 'read_model',
  title: 'Read model',
  description: 'Reads the bytes of a model.',
  route: { method: 'GET', path: '/models/{id}' },
  body: { kind: 'none' },
  inputSchema: Schema.Struct({ id: Schema.String }),
  outputSchema: Nothing,
  reasons: [],
  handle: ({ id }) => Effect.succeed(contentOfText(`model ${id}`, 'text/plain')),
});

const nameModel = defineHttpOperation('brain', 'command', {
  name: 'name_model',
  title: 'Name model',
  description: 'Names a model.',
  route: { method: 'PUT', path: '/models/{id}/name' },
  body: { kind: 'json' },
  inputSchema: Schema.Struct({ id: Schema.String, name: Schema.String }),
  outputSchema: Schema.Struct({ named: Schema.String }),
  reasons: [],
  handle: ({ name }) => Effect.succeed({ named: name }),
});

function withMostBytes(mostBytes: number) {
  return () =>
    defineHttpOperation('brain', 'command', {
      name: 'keep_any',
      title: 'Keep any',
      description: 'Keeps anything.',
      route: { method: 'POST', path: '/any' },
      body: { kind: 'csv', mostBytes },
      inputSchema: Nothing,
      outputSchema: Nothing,
      reasons: [],
      handle: () => Effect.succeed({}),
    });
}

function streamedOf(outcome: Outcome): StreamedContent {
  if (outcome.status !== 'succeeded' || outcome.streamed === undefined) {
    throw new Error('The call answered no stream');
  }
  return outcome.streamed;
}

describe('an operation served over HTTP alone', () => {
  it('registers the body it takes, where an operation served everywhere registers none', () => {
    expect([
      keepModel.registration.servedOverHttpAlone,
      readModel.registration.servedOverHttpAlone,
      nameModel.registration.servedOverHttpAlone,
      addNote.registration.servedOverHttpAlone,
    ]).toEqual([{ kind: 'octet-stream', mostBytes: 1024 }, { kind: 'none' }, { kind: 'json' }, undefined]);
    expect(keepModel.registration).toMatchObject({
      kind: 'command',
      permissions: ['brain:write'],
      reachesOutside: false,
    });
  });

  it('is refused at its definition when its streamed body has no whole number of most bytes above 0', () => {
    expect(withMostBytes(0)).toThrow('The most bytes of the body of keep_any must be a whole number above 0');
    expect(withMostBytes(1.5)).toThrow('The most bytes of the body of keep_any must be a whole number above 0');
    expect(withMostBytes(1)).not.toThrow();
  });
});

describe('the call of an operation served over HTTP alone', () => {
  it('hands its handler the body as a stream with its size and media type, and answers its output as JSON', async () => {
    const { dispatcher, run } = harness();

    const outcomes = await Promise.all([
      run(
        dispatcher.dispatchToBrain(keepModel.registration, {
          ...toAlpha(acmeAdmin, { id: 'm1' }),
          body: contentOfText('weights', octets),
        }),
      ),
      run(
        dispatcher.dispatchToBrain(keepModel.registration, {
          ...toAlpha(acmeAdmin, { id: 'm2' }),
          body: contentOfText('', octets),
        }),
      ),
      run(dispatcher.dispatchToBrain(nameModel.registration, toAlpha(acmeAdmin, { id: 'm1', name: 'first' }))),
    ]);

    expect(outcomes).toEqual([
      { status: 'succeeded', output: { id: 'm1', bytes: 7, media_type: octets } },
      { status: 'rejected', reason: 'invalid_input', detail: 'The model is empty', issues: [] },
      { status: 'succeeded', output: { named: 'first' } },
    ]);
  });

  it('answers a stream its handler gives as that stream', async () => {
    const { dispatcher, run } = harness();

    const outcome = await run(dispatcher.dispatchToBrain(readModel.registration, toAlpha(acmeAdmin, { id: 'm1' })));

    expect(outcome).toMatchObject({ status: 'succeeded', output: {}, streamed: { bytes: 8, mediaType: 'text/plain' } });
    expect(await Effect.runPromise(textOfContent(streamedOf(outcome)))).toBe('model m1');
  });

  it('fails when an operation that takes its body as a stream is given none', async () => {
    const { dispatcher, run, reported } = harness();

    const outcome = await run(dispatcher.dispatchToBrain(keepModel.registration, toAlpha(acmeAdmin, { id: 'm1' })));

    expect(outcome.status).toBe('failed');
    expect(reported().map(({ original }) => String(original))).toEqual([
      'Error: The operation keep_model takes its body as a stream and was given none',
    ]);
  });
});
