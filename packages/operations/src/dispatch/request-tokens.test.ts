import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Caller, defineCommand, requestTokenCallerOf, requestTokenRefused } from '../index.ts';
import { acmeAlphaReader } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { addNote } from '../testing/notes.ts';

const toAlpha = toBrain('acme', 'alpha');

const answerNote = defineCommand('brain', {
  name: 'answer_note',
  title: 'Answer note',
  description: 'Answers a note, by a token of its own or by a caller who may change the brain.',
  route: { method: 'POST', path: '/notes/{name}/answer' },
  inputSchema: Schema.Struct({ name: Schema.String }),
  outputSchema: Schema.Struct({ by: Schema.String, token: Schema.NullOr(Schema.String) }),
  reasons: [],
  authorizesByToken: true,
  handle: () => Caller.use(({ id, requestToken }) => Effect.succeed({ by: id, token: requestToken ?? null })),
});

describe('a caller who presents a request token', () => {
  const holder = requestTokenCallerOf('acme', 'a-token-of-a-request');

  it('holds no permission and no brain, and carries the token unverified', () => {
    expect(holder).toEqual({
      id: 'request-token',
      org: 'acme',
      permissions: [],
      brains: [],
      requestToken: 'a-token-of-a-request',
    });
  });

  it('reaches an operation that authorizes itself by token, whose handler sees the token', async () => {
    const { dispatcher, run } = harness();

    expect(await run(dispatcher.dispatchToBrain(answerNote.registration, toAlpha(holder, { name: 'n1' })))).toEqual({
      status: 'succeeded',
      output: { by: 'request-token', token: 'a-token-of-a-request' },
    });
    expect(answerNote.registration.authorizesByToken).toBe(true);
    expect(addNote.registration.authorizesByToken).toBe(false);
  });

  it('is refused by every other operation, since it holds no permission', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.dispatchToBrain(addNote.registration, toAlpha(holder, { name: 'n1', text: 'hi' }))),
    ).toEqual({ status: 'rejected', reason: 'forbidden', detail: 'The caller lacks the brain:write permission' });
  });
});

describe('a caller who presents a request token, at a brain the org may not have', () => {
  const holder = requestTokenCallerOf('acme', 'a-token-of-a-request');

  it('learns nothing of the brains of the org: a missing, a retired and a malformed brain answer as a bad token does', async () => {
    const { dispatcher, run } = harness({ retiredBrains: [{ org: 'acme', brain: 'omega' }] });
    const tokenRefused = { status: 'rejected', reason: 'forbidden', detail: requestTokenRefused };

    expect(
      await Promise.all(
        ['nobody', 'omega', 'Not A Brain'].map((brain) =>
          run(dispatcher.dispatchToBrain(answerNote.registration, toBrain('acme', brain)(holder, { name: 'n1' }))),
        ),
      ),
    ).toEqual([tokenRefused, tokenRefused, tokenRefused]);
    expect(
      await run(
        dispatcher.dispatchToBrain(
          answerNote.registration,
          toBrain('acme', 'nobody')({ ...acmeAlphaReader, brains: '*', permissions: ['brain:write'] }, { name: 'n1' }),
        ),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});

describe('a caller who presents a request token for another org', () => {
  const holder = requestTokenCallerOf('acme', 'a-token-of-a-request');

  it('belongs to the org it named, and is refused by another', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(
        dispatcher.dispatchToBrain(answerNote.registration, toBrain('globex', 'gamma')(holder, { name: 'n1' })),
      ),
    ).toEqual({ status: 'rejected', reason: 'forbidden', detail: 'The caller does not belong to this org' });
  });
});

describe('a caller without a request token, at an operation that authorizes itself by token', () => {
  it('needs the permission and the brain as at any other operation', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.dispatchToBrain(answerNote.registration, toAlpha(acmeAlphaReader, { name: 'n1' }))),
    ).toEqual({ status: 'rejected', reason: 'forbidden', detail: 'The caller lacks the brain:write permission' });
    expect(
      await run(
        dispatcher.dispatchToBrain(
          answerNote.registration,
          toBrain('acme', 'beta')({ ...acmeAlphaReader, permissions: ['brain:read', 'brain:write'] }, { name: 'n1' }),
        ),
      ),
    ).toEqual({ status: 'rejected', reason: 'forbidden', detail: 'The caller may not access this brain' });
  });
});
