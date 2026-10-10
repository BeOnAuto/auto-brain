import { describe, expect, it } from 'vitest';

import { scriptedTools } from './scripted-tools.ts';

describe('scripted tools', () => {
  it('say whether the run called any of them', async () => {
    const { tools } = scriptedTools();
    const before = tools.calledAny();
    const signal = new AbortController().signal;

    await tools.offered[0]?.call({ callId: 'call-1', input: { query: 'acme' } }, { signal, cancelled: signal });

    expect([before, tools.calledAny()]).toEqual([false, true]);
  });
});
