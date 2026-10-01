import { describe, expect, it } from 'vitest';

import { acmeAdmin } from './testing/callers.ts';
import { harness, toBrain } from './testing/harness.ts';
import { addNote, listNotes } from './testing/notes.ts';

const toAlpha = toBrain('acme', 'alpha');

describe('the input of a call', () => {
  it('is refused with a pointer to every problem', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.inBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'Anvil', 'a/b': 1 }))),
    ).toEqual({
      status: 'refused',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [
        { detail: 'Expected no excess property', pointer: '/a~1b' },
        { detail: 'Expected a string matching the RegExp ^[a-z][a-z0-9-]{0,31}$', pointer: '/name' },
        { detail: 'Missing key', pointer: '/text' },
      ],
    });
  });

  it('may arrive as strings, as from a query string', async () => {
    const { dispatcher, run } = harness();
    const listing = (limit: string) =>
      run(dispatcher.inBrain(listNotes.registration, { ...toAlpha(acmeAdmin, { limit }), form: 'strings' }));

    expect(await listing('1')).toEqual({ status: 'done', output: { notes: [] } });
    expect(await listing('many')).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/limit' }] });
  });
});
