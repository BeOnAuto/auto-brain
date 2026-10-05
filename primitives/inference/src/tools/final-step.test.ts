import { describe, expect, it } from 'vitest';

import { finalStepMessages, toolsWithdrawn, type StepMessage } from './final-step.ts';

const prompt: readonly StepMessage[] = [
  { role: 'system', content: 'Answer briefly' },
  { role: 'system', content: 'For a sales team' },
  { role: 'user', content: 'Summarize acme' },
];

const userSays = (...lines: readonly string[]) => ({
  role: 'user',
  content: [{ type: 'text', text: lines.join('\n') }],
});

describe('the messages of the last step of a run that called tools', () => {
  it('tells the calls and their answers in words, and says the tools are withdrawn', () => {
    expect(
      finalStepMessages([
        ...prompt,
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'I should look it up' },
            { type: 'text', text: 'Looking it up.' },
            { type: 'tool-call', toolName: 'mcp__graph__search', input: { query: 'acme' } },
          ],
        },
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolName: 'mcp__graph__search', output: { type: 'text', value: 'Found 2 rows.' } },
          ],
        },
      ]),
    ).toEqual([
      { role: 'system', content: 'Answer briefly' },
      { role: 'system', content: 'For a sales team' },
      userSays('Summarize acme'),
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Looking it up.\nCalled mcp__graph__search with {"query":"acme"}.' }],
      },
      userSays('mcp__graph__search answered: Found 2 rows.\n', toolsWithdrawn),
    ]);
  });
});

describe('the answers told in the last step', () => {
  it('tells every kind of answer, and leaves out what says nothing', () => {
    expect(
      finalStepMessages([
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolName: 'mcp__graph__profile', output: { type: 'json', value: { rows: 2 } } },
            { type: 'tool-result', toolName: 'mcp__graph__denied', output: { type: 'error-text', value: 'Denied.' } },
            { type: 'tool-result', toolName: 'mcp__graph__photo', output: { type: 'execution-denied' } },
            { type: 'tool-approval-response' },
          ],
        },
        { role: 'assistant', content: [{ type: 'reasoning', text: 'Nothing to say' }] },
      ]),
    ).toEqual([
      userSays(
        'mcp__graph__profile answered: {"rows":2}',
        'mcp__graph__denied failed: Denied.',
        'mcp__graph__photo answered nothing.\n',
        toolsWithdrawn,
      ),
    ]);
  });
});
