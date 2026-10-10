import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { messageIdOf, streamPrefixOfBrain } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { addNote, readNoteContent, readNoteEvent } from '../testing/notes.ts';

const toAlpha = toBrain('acme', 'alpha');

const toGamma = toBrain('globex', 'gamma');

describe('the read of one event, bound to a call', () => {
  it('reads an event of the brain of the call by its id, its stream relative to the brain, and none of another', async () => {
    const { dispatcher, run } = harness();
    await run(dispatcher.dispatchToBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));
    await run(dispatcher.dispatchToBrain(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    const ofAlpha = messageIdOf(`${streamPrefixOfBrain({ org: 'acme', brain: 'alpha' })}notes`, 1);
    const ofGamma = messageIdOf(`${streamPrefixOfBrain({ org: 'globex', brain: 'gamma' })}notes`, 1);

    expect(
      await Promise.all(
        [ofAlpha, ofGamma].map((id) =>
          run(dispatcher.dispatchToBrain(readNoteEvent.registration, toAlpha(acmeAdmin, { id }))),
        ),
      ),
    ).toEqual([
      { status: 'succeeded', output: { stream: 'notes', by: 'tester' } },
      { status: 'succeeded', output: { stream: null, by: null } },
    ]);
  });
});

describe('the read of a recorded content, bound to a call', () => {
  it('reads a content of the brain of the call by its digest, and none of another brain', async () => {
    const { dispatcher, ledger, run } = harness();
    await Effect.runPromise(ledger.service.content.put({ org: 'acme', brain: 'alpha' }, 'digest', '{"rows":[]}'));
    await Effect.runPromise(ledger.service.content.put({ org: 'globex', brain: 'gamma' }, 'other', '{}'));

    expect(
      await Promise.all(
        ['digest', 'other'].map((sha256) =>
          run(dispatcher.dispatchToBrain(readNoteContent.registration, toAlpha(acmeAdmin, { sha256 }))),
        ),
      ),
    ).toEqual([
      { status: 'succeeded', output: { text: '{"rows":[]}' } },
      { status: 'succeeded', output: { text: null } },
    ]);
  });
});
