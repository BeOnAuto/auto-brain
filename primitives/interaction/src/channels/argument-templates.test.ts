import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { argumentTemplates, type TemplateSet } from './argument-templates.ts';

const threadSet: TemplateSet = {
  names: ['to', 'sent.conversation', 'sent.id'],
  sample: { to: 'U024BE7LH', sent: { conversation: 'C0123', id: '1699.1' } },
  structured: 'sent',
};

function problemsOf(written: Readonly<Record<string, string>>): readonly string[] {
  const compiled = argumentTemplates(['approvals', 'replies', 'with'], written, threadSet);
  return Result.isFailure(compiled) ? compiled.failure.map(({ detail }) => detail) : [];
}

describe('the templates of a set whose names nest under another', () => {
  it('reads each nested name and the name they nest under, and names a nested name it does not have', () => {
    expect([
      problemsOf({ channel: '{{ sent.conversation }}', ts: '{{ sent.id }}', whole: '{{ sent | json }}' }),
      problemsOf({ user: '{{ sent.user }}', message: '{{ message }}' }),
    ]).toEqual([
      [],
      [
        '/approvals/replies/with/user: Reads sent.user, which this template of a channel does not have; it reads to, sent.conversation and sent.id',
        '/approvals/replies/with/message: Reads message, which this template of a channel does not have; it reads to, sent.conversation and sent.id',
      ],
    ]);
  });

  it('refuses a template that renders a structured value as it is, naming the set’s structured value', () => {
    expect(problemsOf({ whole: '{{ sent }}' })).toEqual([
      '/approvals/replies/with/whole: Renders a value that is not text; write | json after a structured value such as sent',
    ]);
  });
});
