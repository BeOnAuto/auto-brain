import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/logged-lines.ts';
import { logHostNote } from './host-notes.ts';

const run = { org: 'acme', brain: 'alpha', executionId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

describe('the notes of the workflow host', () => {
  it('warn that another server runs the workflows of the database, and until when it holds them', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({ kind: 'standing_by', holder: 'server-a', until: 1_790_845_203_000 }),
    );

    expect(line).toContain(
      '"message":"The workflows of this database run in another server; this server serves everything else, and takes the workflows over if that server stops renewing its claim","level":"WARN"',
    );
    expect(line).toContain('"annotations":{"holder":"server-a","claimed_until":"2026-10-01T09:00:03.000Z"}');
  });

  it('warn that this server took the workflows over', async () => {
    const [line] = await linesLoggedBy(logHostNote({ kind: 'took_over', holder: 'server-b' }));

    expect(line).toContain(
      '"message":"This server took over the workflows of its database, since the server that ran them stopped renewing its claim","level":"WARN"',
    );
  });

  it('warn once when a settlement backs off, and once when it is settled at last, naming only the execution', async () => {
    const lines = [
      ...(await linesLoggedBy(
        logHostNote({ kind: 'settle_backing_off', run, attempts: 20, detail: 'The ledger cannot be reached' }),
      )),
      ...(await linesLoggedBy(logHostNote({ kind: 'settled_after_back_off', run, attempts: 22 }))),
    ];

    expect(lines).toEqual([
      expect.stringContaining(
        '"message":"An execution could not be settled in 20 attempts; it is tried again once a minute until it is","level":"WARN"',
      ),
      expect.stringContaining(
        '"message":"An execution that could not be settled was settled at attempt 22","level":"WARN"',
      ),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"org":"acme","brain":"alpha","execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","error":"The ledger cannot be reached"}',
    );
  });
});
