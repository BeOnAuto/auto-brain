import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logPredictionFunctions } from './prediction-logging.ts';

const settings = { mostFunctions: 32, processes: 4, buildsAtOnce: 2 };

describe('the prediction function logs', () => {
  it('say how many active functions a playbook keeps, how many model processes may run at once, how many of them builds may hold, the data each may have, and that prlimit bounds it', async () => {
    const [line] = await linesLoggedBy(
      logPredictionFunctions({ ...settings, memoryMebibytes: 1024, limiter: '/usr/bin/prlimit' }),
    );

    expect(line).toContain(
      '"message":"Prediction functions run in this server: a playbook keeps at most 32 active, and model processes may run at most 4 at once, at most 2 of them for builds, with 1,024 MiB of data each, which prlimit bounds","level":"INFO"',
    );
    expect(line).toContain(
      '"annotations":{"most_functions":32,"model_processes":4,"model_process_memory_mib":1024,"model_process_builds":2,"model_process_limiter":"/usr/bin/prlimit"}',
    );
  });

  it('say that nothing bounds the data of a model process where prlimit is not on the path', async () => {
    const [line] = await linesLoggedBy(
      logPredictionFunctions({ ...settings, memoryMebibytes: 512, limiter: undefined }),
    );

    expect(line).toContain(
      '"message":"Prediction functions run in this server: a playbook keeps at most 32 active, and model processes may run at most 4 at once, at most 2 of them for builds, with 512 MiB of data each, which nothing bounds, since prlimit is not on the path","level":"INFO"',
    );
    expect(line).toContain('"model_process_limiter":null');
  });
});
