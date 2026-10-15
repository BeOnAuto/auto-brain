import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  bulletList,
  defineCapability,
  inputSection,
  named,
  paragraph,
  sectionOf,
  usedBySection,
  writtenOverview,
} from '../index.ts';
import { echo } from '../testing/echo.ts';
import { overviewWithUsers } from './definition-overview.ts';

function overviewOf(source: string, name = 'greet'): string {
  return Effect.runSync(echo.prepare(source)).overview(name);
}

const told = defineCapability({
  type: 'told',
  title: 'Told',
  guide: { name: 'told' },
  noun: { one: 'telling', other: 'tellings' },
  describeOutput: () => 'It told.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed({ words: source.trim() }),
  summarize: ({ words }) => ({ description: words, inputSchema: { type: 'object' } }),
  overview: ({ words }, source) => [
    inputSection(),
    sectionOf('What it says', paragraph('It says ', named(words), ` from a document of ${source.length} characters.`)),
  ],
  run: ({ words }) => Effect.succeed({ output: words, record: {} }),
});

describe('the overview of a definition', () => {
  it('opens with its name and its description, then says what it needs and produces from its schemas', () => {
    expect(overviewOf('{"greeting": "Hello", "description": "Greets a guest"}')).toBe(
      [
        '# greet',
        'Greets a guest',
        '## What it needs',
        'A record.',
        '## What it produces',
        '| Field | Required | What it is |\n| --- | --- | --- |\n| **greeting** | yes | Exactly Hello. |\n| **input** | yes | A record. |',
        '',
      ]
        .join('\n\n')
        .replace(/\n\n$/u, '\n'),
    );
  });

  it('says in one line that a definition has no description yet, in the noun of its capability', () => {
    expect(overviewOf('{"greeting": "Hello"}', 'hello-there').split('\n\n').slice(0, 2)).toEqual([
      '# hello-there',
      'This greeting has no description yet.',
    ]);
  });
});

describe('the overview of a definition that says little', () => {
  it('says what a definition without schemas needs and produces, and that a blank description is none', () => {
    expect(
      writtenOverview({ name: 'plain', noun: { one: 'item', other: 'items' }, summary: { description: ' \n' } }),
    ).toBe(
      [
        '# plain',
        'This item has no description yet.',
        '## What it needs',
        'It takes any input, which its document does not describe.',
        '## What it produces',
        'It produces any output, which its document does not describe.\n',
      ].join('\n\n'),
    );
  });
});

describe('the section of the definitions that use a definition', () => {
  it('says in a line what each one does with it, in the words of its relation', () => {
    const stored = writtenOverview({ name: 'send-build', noun: { one: 'item', other: 'items' }, summary: {} });

    expect(
      overviewWithUsers(stored, [
        { type: 'prediction', name: 'weekly-orders', relation: 'sends-builds' },
        { type: 'prediction', name: 'demand', relation: 'asks-approval' },
        { type: 'recall', name: 'review-history', relation: 'remembers-runs' },
        { type: 'recall', name: 'brief-changes', relation: 'remembers-changes' },
        { type: 'workflow', name: 'weekly-review', relation: 'calls' },
      ]),
    ).toBe(
      `${stored}\n${[
        '## Used by',
        [
          '- The prediction function **weekly-orders** sends it builds to train.',
          '- The prediction function **demand** asks it to approve a version.',
          '- The recall function **review-history** remembers its runs.',
          '- The recall function **brief-changes** remembers its changes.',
          '- The workflow **weekly-review** calls it.\n',
        ].join('\n'),
      ].join('\n\n')}`,
    );
  });

  it('is left out when nothing uses the definition, and is a section of its own to compose', () => {
    const stored = writtenOverview({ name: 'plain', noun: { one: 'item', other: 'items' }, summary: {} });

    expect(overviewWithUsers(stored, [])).toBe(stored);
    expect(usedBySection([{ type: 'echo', name: 'greets', relation: 'calls' }])).toEqual(
      sectionOf('Used by', bulletList([['The echo definition ', named('greets'), ' calls it.']])),
    );
  });
});

describe('the overview of a capability of its own', () => {
  it('is given in place of the one of every type', () => {
    expect(Effect.runSync(told.prepare(' hello ')).overview('saying')).toBe(
      [
        '# saying',
        'hello',
        '## What it needs',
        'It takes any input, which its document does not describe.',
        '## What it says',
        'It says **hello** from a document of 7 characters.\n',
      ].join('\n\n'),
    );
  });
});
