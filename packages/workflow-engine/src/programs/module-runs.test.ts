import { describe, expect, it } from 'vitest';

import { freshInstance } from '../instances/fresh-instances.ts';
import { moduleRun, type ModuleRequest } from './module-runs.ts';
import { threadStackBytes, unitMemoryBytes } from './sandbox-bounds.ts';
import { cachedStripping, notErasable } from './type-stripping.ts';

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1_048_576, clock: () => 0 };

const stripping = cachedStripping();

function requestOf(source: string, more: Partial<ModuleRequest> = {}): ModuleRequest {
  return {
    source,
    entry: 'default',
    arguments: ['{"name":"Ada"}'],
    evaluation: { budget: 500, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 },
    ...more,
  };
}

async function ran(source: string, more: Partial<ModuleRequest> = {}): Promise<unknown> {
  return moduleRun(await freshInstance(unitMemoryBytes), settings, requestOf(source, more), stripping);
}

describe('a run of a module', () => {
  it('calls the function its entry names with its arguments and answers its value as JSON', async () => {
    const source =
      'export default function (input: { name: string }): string {\n  return `Hello, ${input.name}`;\n}\nexport function shout(text: string): string {\n  return text.toUpperCase();\n}';

    expect(await ran(source)).toEqual({ ran: 'answered', text: '"Hello, Ada"', work: 0 });
    expect(await ran(source, { entry: 'shout', arguments: ['"quiet"'] })).toEqual({
      ran: 'answered',
      text: '"QUIET"',
      work: 0,
    });
  });

  it('refuses a module whose syntax is not erasable, that does not load, or that exports no function of its entry', async () => {
    expect(
      await ran('namespace Kept {\n  export const x = 1;\n}\nexport default function (): number {\n  return 1;\n}'),
    ).toEqual({
      ran: 'refused',
      issue: { detail: notErasable, line: 1 },
    });
    expect(await ran('export default function (): number {\n  return 1 +;\n}')).toMatchObject({
      ran: 'refused',
      issue: { detail: "SyntaxError: unexpected token in expression: ';'", line: 2 },
    });
    expect(
      await ran('throw new Error("not now");\nexport default function (): number {\n  return 1;\n}'),
    ).toMatchObject({
      ran: 'refused',
      issue: { detail: 'Error: not now', line: 1 },
    });
    expect(await ran('export const answer = 42;')).toEqual({
      ran: 'refused',
      issue: { detail: 'The program exports no function default', line: null },
    });
  });

  it('ends a module whose loading does more work than its budget allows, as a run that ran out of it', async () => {
    expect(await ran('for (;;) {}\nexport default function (): number {\n  return 1;\n}')).toMatchObject({
      ran: 'exhausted',
      limit: 'work',
    });
  });
});
