import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logModelProcesses } from './model-process-logging.ts';

describe('the model process logs', () => {
  it('say how many model processes may run at once, how many of them builds may hold, the data each may have, and that prlimit bounds it', async () => {
    const [line] = await linesLoggedBy(
      logModelProcesses({ processes: 4, memoryMebibytes: 1024, buildsAtOnce: 2, limiter: '/usr/bin/prlimit' }),
    );

    expect(line).toContain(
      '"message":"Model processes may run at most 4 at once, at most 2 of them for builds, with 1,024 MiB of data each, which prlimit bounds","level":"INFO"',
    );
    expect(line).toContain(
      '"annotations":{"model_processes":4,"model_process_memory_mib":1024,"model_process_builds":2,"model_process_limiter":"/usr/bin/prlimit"}',
    );
  });

  it('say that nothing bounds their data where prlimit is not on the path', async () => {
    const [line] = await linesLoggedBy(
      logModelProcesses({ processes: 4, memoryMebibytes: 512, buildsAtOnce: 2, limiter: undefined }),
    );

    expect(line).toContain(
      '"message":"Model processes may run at most 4 at once, at most 2 of them for builds, with 512 MiB of data each, which nothing bounds, since prlimit is not on the path","level":"INFO"',
    );
    expect(line).toContain('"model_process_limiter":null');
  });
});
