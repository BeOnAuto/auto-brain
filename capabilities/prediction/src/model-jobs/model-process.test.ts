import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { modelProcessModule } from '../model-processes/model-processes.ts';

describe('the module a model process runs', { timeout: 30_000 }, () => {
  it('says it is ready to its server, and ends of itself when its server lets it go', async () => {
    const child = fork(fileURLToPath(modelProcessModule), [], {
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const heard: readonly unknown[] = await once(child, 'message');
    const ended = once(child, 'exit');
    child.disconnect();

    expect([heard[0], await ended]).toEqual([{ ready: true }, [0, null]]);
  });
});
