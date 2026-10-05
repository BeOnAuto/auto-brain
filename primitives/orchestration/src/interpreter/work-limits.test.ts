import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';
import type { RunSettlement } from './host.ts';

function tasks(count: number, body: (index: number) => string): string {
  return `do:\n${Array.from({ length: count }, (_, index) => `  - t${index}: ${body(index)}`).join('\n')}`;
}

function rejectionOf(settlement: RunSettlement | undefined): string {
  return settlement?.status === 'rejected' ? settlement.detail : '';
}

function yieldsIn(commands: Awaited<ReturnType<typeof interpret>>['commands']): readonly string[] {
  return commands.flatMap((command) =>
    command.kind === 'timer' && command.summary.endsWith('lets other workflows run') ? [command.summary] : [],
  );
}

describe('a workflow whose expressions do too much work', () => {
  it('fails with a runtime error at the first expression past the budget of an expression', async () => {
    const document = workflow(tasks(6, () => `{ set: { size: '\${ "x" * 40000000 | length }' } }`));
    const { ending, settlement } = await interpret(document);

    expect(ending).toMatchObject({ kind: 'failed' });
    expect(settlement).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(rejectionOf(settlement)).toContain('an expression may do 8000000 units of work (at /do/0/t0)');
  });

  it('fails once one task does more than an activation may, since it can yield only between tasks', async () => {
    const big = `'\${ "x" * 3000000 | length }'`;
    const { settlement } = await interpret(workflow(`do:\n  - heavy: { set: { a: ${big}, b: ${big}, c: ${big} } }`));

    expect(rejectionOf(settlement)).toContain('the workflow did 16000000 units of expression work in one input');
  });
});

describe('a workflow that runs many pure tasks', () => {
  it('lets other workflows run before a task once its tasks did the budget of an expression', async () => {
    const document = workflow(tasks(6, () => `{ set: { size: '\${ "x" * 1000000 | length }' } }`));
    const { ending, commands } = await interpret(document);

    expect(ending).toStrictEqual({ kind: 'completed', output: { size: 1_000_000 } });
    expect(yieldsIn(commands)).toStrictEqual(['/do/4/t4 lets other workflows run']);
  });

  it('lets other workflows run after every hundred tasks', async () => {
    const { ending, commands } = await interpret(workflow(tasks(250, (index) => `{ set: { n: ${index} } }`)));

    expect(ending).toStrictEqual({ kind: 'completed', output: { n: 249 } });
    expect(yieldsIn(commands)).toStrictEqual([
      '/do/100/t100 lets other workflows run',
      '/do/200/t200 lets other workflows run',
    ]);
  });
});

describe('a value a workflow holds', () => {
  it('may not take more work to visit than an expression may do', async () => {
    const half = `'\${ "x" * 5000000 }'`;
    const { settlement } = await interpret(workflow(`do:\n  - pair: { set: { a: ${half}, b: ${half} } }`));

    expect(rejectionOf(settlement)).toContain(
      'units of work to visit, more than the 8000000 a workflow may hold (at /do/0/pair)',
    );
  });

  it('is admitted as the input of a workflow only if it takes no more work than that', async () => {
    const { settlement } = await interpret(workflow('do: []'), { input: Array.from({ length: 600_000 }, () => 0) });

    expect(rejectionOf(settlement)).toContain(
      'A value takes 9600016 units of work to visit, more than the 8000000 a workflow may hold (at /)',
    );
  });

  it('may not double by sharing itself from task to task', async () => {
    const { settlement } = await interpret(workflow(tasks(40, () => `{ set: { a: '\${ . }', b: '\${ . }' } }`)));

    expect(rejectionOf(settlement)).toContain('a workflow may hold');
  });

  it('may not nest more than 512 levels deep', async () => {
    const deep = `'\${ reduce range(511) as $i (0; [.]) }'`;
    const { settlement } = await interpret(workflow(`do:\n  - deep: { set: { a: { b: ${deep} } } }`));

    expect(rejectionOf(settlement)).toContain('A value nests more than 512 levels deep (at /do/0/deep)');
  });
});
