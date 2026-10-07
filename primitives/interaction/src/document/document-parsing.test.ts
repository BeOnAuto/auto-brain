import { issueText } from '@beonauto/specs/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { approvalDocument, notificationDocument } from '../testing/index.ts';
import { parseInteractionDocument } from './document-parsing.ts';

function problemsOf(source: string): readonly string[] {
  const parsed = parseInteractionDocument(source);
  return Result.isFailure(parsed) ? parsed.failure.map((issue) => issueText(issue)) : [];
}

function documentWith(frontMatter: readonly string[], body = 'Approve {{ input.campaign }}?'): string {
  return ['---', ...frontMatter, '---', body].join('\n');
}

const essentials = ['channel: approvals', "to: '{{ input.owner }}'", 'expires: P2D'];

describe('an interaction function definition', () => {
  it('reads its channel, party, expiry, schemas and message', () => {
    const parsed = Result.getOrThrow(parseInteractionDocument(approvalDocument('approvals')));

    expect(parsed).toMatchObject({
      description: 'Ask the campaign owner to approve a brief',
      channel: 'approvals',
      expires: 'P2D',
      expiresMs: 172_800_000,
      output: { schema: { document: { required: ['choice'] } } },
    });
    expect(parsed.to.variables.map(({ path }) => path)).toEqual([['input', 'owner']]);
    expect(parsed.message.variables.map(({ path }) => path)).toEqual([['input', 'campaign']]);
  });

  it('is a notification when it gives no answer schema', () => {
    expect(Result.getOrThrow(parseInteractionDocument(notificationDocument())).output).toEqual({});
  });

  it.each(['model', 'tools', 'language', 'config'])(
    'refuses %s, which only other functions take, with its line',
    (key) => {
      expect(problemsOf(documentWith([...essentials, `${key}: x`]))).toEqual([
        `Line 5, /${key}: ${key} is not a key of the front matter; it takes description, channel, to, expires, input, output`,
      ]);
    },
  );
});

describe('the refusals of a definition', () => {
  it('refuse a channel name that is not one, and an expiry outside its bounds or not a duration', () => {
    expect([
      problemsOf(documentWith(['channel: Approvals!', "to: 'x'", 'expires: P2D'])),
      problemsOf(documentWith(['channel: inbox', "to: 'x'", 'expires: PT30S'])),
      problemsOf(documentWith(['channel: inbox', "to: 'x'", 'expires: P31D'])),
      problemsOf(documentWith(['channel: inbox', "to: 'x'", 'expires: two days'])),
    ]).toEqual([
      [
        'Line 2, /channel: Approvals! is not a channel name: inbox, or 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      ],
      [
        'Line 4, /expires: PT30S is not a time a request may wait. A request expires after a duration from one minute to thirty days, such as P2D or PT4H',
      ],
      [
        'Line 4, /expires: P31D is not a time a request may wait. A request expires after a duration from one minute to thirty days, such as P2D or PT4H',
      ],
      [
        'Line 4, /expires: two days is not an ISO 8601 duration. A request expires after a duration from one minute to thirty days, such as P2D or PT4H',
      ],
    ]);
  });

  it('refuse a party or a message that does not compile, or reads what a request does not have', () => {
    expect([
      problemsOf(documentWith(['channel: inbox', "to: '{{ input.owner'", 'expires: P2D'])),
      problemsOf(documentWith(['channel: inbox', "to: '{{ owner }}'", 'expires: P2D'])),
      problemsOf(documentWith(essentials, 'Hello {{ person }}')),
      problemsOf(documentWith(essentials, 'Hello {% if %}')),
    ]).toEqual([
      [expect.stringMatching(/^Line 3, \/to: /u)],
      [
        'Line 3, /to: owner is not a variable of the party of a request, which reads input, today and now; assign it first',
      ],
      [
        'Line 6: person is not a variable of the message of a request, which reads input, today and now; assign it first',
      ],
      [expect.stringMatching(/^Line 6: /u)],
    ]);
  });
});

describe('the refusals of what a definition reads', () => {
  it('refuse a property a closed input schema does not have, in the party and in the message', () => {
    const closed = [
      'input:',
      '  schema: { type: object, additionalProperties: false, properties: { owner: { type: string } } }',
    ];

    expect(problemsOf(documentWith([...essentials, ...closed], 'For {{ input.campaign }}'))).toEqual([
      'Line 8: input.campaign is not a property of the input schema, which allows no others',
    ]);
  });

  it('refuse a definition without a message, a schema that is not one, and front matter of the wrong types', () => {
    expect([
      problemsOf(documentWith(essentials, '  ')),
      problemsOf(documentWith([...essentials, 'output:', '  schema: { type: thing }'])),
      problemsOf(documentWith(['channel: 3', "to: 'x'", 'expires: P2D'], '')),
      problemsOf('channel: inbox'),
      problemsOf('---\n---\nHello'),
    ]).toEqual([
      ['Line 6: The definition has no message: write it after the front matter'],
      [expect.stringMatching(/^Line 6, \/output\/schema/u)],
      ['Line 2, /channel: Expected string', 'Line 6: The definition has no message: write it after the front matter'],
      [
        'Line 1: An interaction function definition starts with a line of three dashes (---) that opens its front matter of YAML',
      ],
      [expect.stringContaining('the channel, the party it goes to and when it expires')],
    ]);
  });
});

describe('a definition past the bounds of a template, or with an input schema that is not one', () => {
  it('refuses a message of more than 1,000 names, and an input schema it cannot compile', () => {
    expect([
      problemsOf(documentWith(essentials, '{{ input.a }}'.repeat(600))),
      problemsOf(
        documentWith([
          'channel: inbox',
          "to: '{{ input.owner }}'",
          'expires: P2D',
          'input:',
          '  schema: { type: thing }',
        ]),
      ),
    ]).toEqual([
      [expect.stringContaining('A template may use at most 1000 names')],
      [expect.stringMatching(/^Line 6, \/input\/schema/u)],
    ]);
  });
});
