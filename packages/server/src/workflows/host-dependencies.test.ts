import { makeAppRuntime } from '@beonauto/api';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { Cause, Effect, Exit, Layer, Logger, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { applicationLayer } from '../composition/composition-root.ts';
import { hostDatabaseOf, hostReports, inRuntime } from './host-dependencies.ts';

const memoryLedger = ledgerLayer({ fileName: ':memory:' });

async function reportedLines(
  report: (reports: ReturnType<typeof hostReports>) => Promise<unknown>,
): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const runtime = await makeAppRuntime(
    applicationLayer(memoryLedger).pipe(Layer.provideMerge(Logger.layer([capture]))),
  );
  await report(hostReports(runtime));
  await runtime.dispose();
  return lines;
}

describe('work the workflow host hands to the runtime of the server', () => {
  it('runs on the services of the runtime, and fails as it fails there', async () => {
    const runtime = await makeAppRuntime(applicationLayer(memoryLedger));

    const done = await Effect.runPromise(inRuntime(runtime, Effect.succeed('done')));
    const refused = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.fail('refused'))));
    await runtime.dispose();

    expect(done).toBe('done');
    expect(refused).toStrictEqual(Exit.fail('refused'));
  });

  it('dies once the runtime is disposed, so the host performs the call again when the server next starts', async () => {
    const runtime = await makeAppRuntime(Layer.empty.pipe(Layer.provideMerge(applicationLayer(memoryLedger))));
    await runtime.dispose();

    const exit = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.succeed('too late'))));

    expect(String(exit)).toContain('The server stopped before the work could be done');
  });
});

describe('the reports of the workflow host', () => {
  it('log an execution left started with the reason the host gave, in words', async () => {
    const lines = await reportedLines(async (reports) => {
      const run = { org: 'acme', brain: 'alpha', executionId: 'e-1' };
      await Effect.runPromise(reports.unsettled({ ...run, receipt: 'unknown_execution' }));
      await Effect.runPromise(reports.unsettled({ ...run, receipt: 'settled_otherwise' }));
    });

    expect(lines).toEqual([
      expect.stringContaining(
        '"annotations":{"org":"acme","brain":"alpha","execution_id":"e-1","reason":"The ledger has no such execution"}',
      ),
      expect.stringContaining('"reason":"The execution was settled otherwise before"'),
    ]);
  });

  it('log trouble, a lost connection and a note of the host as warnings', async () => {
    const lines = await reportedLines(async (reports) => {
      await Effect.runPromise(reports.trouble('A sweep of the runs failed; the next sweep tries again', Cause.empty));
      reports.lostConnection(new Error('Connection terminated unexpectedly'));
      await Effect.runPromise(Effect.yieldNow);
      await Effect.runPromise(
        reports.note({
          kind: 'settled_after_back_off',
          run: { org: 'acme', brain: 'alpha', executionId: 'e-1' },
          attempts: 21,
        }),
      );
    });

    expect(lines).toEqual([
      expect.stringContaining('"message":"A sweep of the runs failed; the next sweep tries again","level":"WARN"'),
      expect.stringContaining('"annotations":{"error":"Connection terminated unexpectedly"}'),
      expect.stringContaining('"message":"An execution that could not be settled was settled at attempt 21"'),
    ]);
  });
});

describe('the database of the workflow host', () => {
  it('is the file of the ledger when the ledger is kept in SQLite', () => {
    expect(hostDatabaseOf({ store: 'sqlite', file: '/data/ledger.db' })).toEqual({
      store: 'sqlite',
      file: '/data/ledger.db',
    });
  });

  it('is the database of the ledger when the ledger is kept in PostgreSQL', () => {
    const url = 'postgresql://brains:secret@db.example.com:5432/brains';

    expect(
      hostDatabaseOf({ store: 'postgresql', url: Redacted.make(url), host: 'db.example.com:5432', database: 'brains' }),
    ).toEqual({
      store: 'postgresql',
      connectionString: url,
    });
  });
});
