import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { refused, type PipelineStep } from '../index.ts';
import { labelBrain } from '../testing/brain-labels.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain, toOrg } from '../testing/harness.ts';
import { addNote, copyNote, getNote, listNotes } from '../testing/notes.ts';

const toAlpha = toBrain('acme', 'alpha');

const closedToCommands: PipelineStep = ({ kind }) =>
  kind === 'command' ? Effect.fail(refused('unavailable', 'The org has used its operations')) : Effect.void;

function recordedSteps(): { readonly steps: readonly PipelineStep[]; readonly passed: () => readonly string[] } {
  const passed: string[] = [];
  const recording =
    (label: string): PipelineStep =>
    ({ name }, { org }) =>
      Effect.sync(() => {
        passed.push(`${label} ${name} in ${org}`);
      });
  return { steps: [recording('first'), recording('second')], passed: () => passed };
}

describe('a dispatched handler', () => {
  it('may call another operation of its scope within the same call', async () => {
    const { dispatcher, run } = harness();
    const copying = (name: string, copy: string) =>
      run(dispatcher.inBrain(copyNote.registration, toAlpha(acmeAdmin, { name, copy })));
    await run(dispatcher.inBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));

    expect(await copying('anvil', 'twin')).toEqual({
      status: 'done',
      output: { added: { name: 'twin', text: 'heavy' }, version: 2 },
    });
    expect(await copying('ghost', 'echo')).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'There is no note ghost',
    });
  });

  it('refuses with a reason it declares', async () => {
    const { dispatcher, run } = harness();
    const anvil = toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' });

    expect(await run(dispatcher.inBrain(addNote.registration, anvil))).toEqual({
      status: 'done',
      output: { added: { name: 'anvil', text: 'heavy' }, version: 1 },
    });
    expect(await run(dispatcher.inBrain(addNote.registration, anvil))).toEqual({
      status: 'refused',
      reason: 'conflict',
      detail: 'A note named anvil exists',
    });
  });

  it('is refused with conflict when its stream moved while it decided', async () => {
    const { dispatcher, run } = harness();
    const adding = (name: string) => dispatcher.inBrain(addNote.registration, toAlpha(acmeAdmin, { name, text: name }));

    expect(await run(Effect.all([adding('anvil'), adding('bolt')], { concurrency: 'unbounded' }))).toEqual([
      { status: 'done', output: { added: { name: 'anvil', text: 'anvil' }, version: 1 } },
      { status: 'refused', reason: 'conflict', detail: 'The state changed while the command was decided' },
    ]);
  });
});

describe('pipeline steps', () => {
  it('run in order once a call is admitted and its brain exists, before its input is decoded', async () => {
    const { steps, passed } = recordedSteps();
    const { dispatcher, run } = harness({ steps });

    await run(dispatcher.inBrain(getNote.registration, toBrain('globex', 'gamma')(acmeAdmin, { name: 'gear' })));
    await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'nowhere')(acmeAdmin, { name: 'gear' })));
    const invalid = await run(dispatcher.inBrain(getNote.registration, toAlpha(acmeAdmin, { name: 7 })));

    expect(invalid).toMatchObject({ reason: 'invalid_input' });
    expect(passed()).toEqual(['first get_note in acme', 'second get_note in acme']);
  });

  it('stop a call with their refusal before its handler runs', async () => {
    const { dispatcher, run } = harness({ steps: [closedToCommands] });
    const unavailable = { status: 'refused', reason: 'unavailable', detail: 'The org has used its operations' };

    expect(
      await run(dispatcher.inBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'x' }))),
    ).toEqual(unavailable);
    expect(
      await run(dispatcher.inOrg(labelBrain.registration, toOrg('acme')(acmeAdmin, { brain: 'alpha', label: 'x' }))),
    ).toEqual(unavailable);
    expect(await run(dispatcher.inBrain(listNotes.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'done',
      output: { notes: [] },
    });
  });
});
