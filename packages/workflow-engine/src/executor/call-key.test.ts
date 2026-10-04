import { describe, expect, it } from 'vitest';

import { callKeyText, timerIdOf, type CallKey } from '../index.ts';

describe('the text of a call key', () => {
  it('is the same for the same execution, reference and run, and different whenever one differs', () => {
    const keys = [
      { executionId: 'e', reference: '/do/0', run: 1 },
      { executionId: 'e', reference: '/do/0', run: 2 },
      { executionId: 'e/do', reference: '/0', run: 1 },
      { executionId: 'e', reference: '/do/0","x', run: 1 },
    ].map((key: CallKey) => callKeyText(key));

    expect(new Set(keys).size).toBe(4);
    expect(callKeyText({ executionId: 'e', reference: '/do/0', run: 1 })).toBe(keys[0]);
  });
});

describe('the id of a timer', () => {
  it('is the execution and the sequence number the run gave it', () => {
    expect([timerIdOf('e', 1), timerIdOf('e', 2)]).toEqual(['e/timers/1', 'e/timers/2']);
  });
});
