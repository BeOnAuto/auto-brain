import { describe, expect, it } from 'vitest';

describe('the workflow entry module', () => {
  it('removes the Temporal global of Node, whose clock would break replay, and exports the interpreter workflow', async () => {
    expect(Reflect.has(globalThis, 'Temporal')).toBe(true);

    const { runWorkflowSpec } = await import('./workflows.ts');

    expect(Reflect.has(globalThis, 'Temporal')).toBe(false);
    expect(runWorkflowSpec).toBeTypeOf('function');
  });
});
