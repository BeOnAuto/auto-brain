import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { logAccessMode, logIncident } from './logging.ts';
import { spawnServer, spawnedServerTestTimeoutMs } from './testing/spawned-server.ts';

async function linesLoggedBy(effect: Effect.Effect<void>): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([capture]))));
  return lines;
}

const serveWithTestRoutes = fileURLToPath(new URL('testing/serve-with-test-routes.ts', import.meta.url));

describe('logAccessMode', () => {
  it('says local mode is on', async () => {
    const [line] = await linesLoggedBy(logAccessMode('local'));

    expect(line).toContain('"level":"INFO"');
    expect(line).toContain(
      '"message":"Local mode is on: the server listens only on loopback and no API keys are configured"',
    );
  });

  it('warns when the server is not in local mode and has no API keys', async () => {
    const [line] = await linesLoggedBy(logAccessMode('closed'));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"message":"Local mode is off and no API keys are configured"');
  });

  it('says nothing when API keys are configured', async () => {
    expect(await linesLoggedBy(logAccessMode('keys'))).toEqual([]);
  });
});

describe('logIncident', () => {
  it('logs the error with its stack under the incident id', async () => {
    const [line] = await linesLoggedBy(
      logIncident({ id: 'incident-1', original: new Error('the ledger is unreachable') }),
    );

    expect(line).toContain('"level":"ERROR"');
    expect(line).toContain('"annotations":{"incident":"incident-1"}');
    expect(line).toContain('Error: the ledger is unreachable\\n    at ');
  });

  it('logs the operation, the org, the brain and the caller of the call that failed', async () => {
    const call = { operation: 'add_note', org: 'acme', brain: 'alpha', caller: 'acme-admin' };

    const [line] = await linesLoggedBy(logIncident({ id: 'incident-2', original: 'not an error', call }));

    expect(line).toContain(
      '"annotations":{"incident":"incident-2","operation":"add_note","org":"acme","brain":"alpha","caller":"acme-admin"}',
    );
    expect(line).toContain('not an error');
  });
});

describe('the server process', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('logs an unexpected error to stderr under the incident id it answers with', async () => {
    const child = spawnServer(serveWithTestRoutes, { HOST: '127.0.0.1', PORT: '0' });
    const port = await child.port;

    const response = await fetch(`http://127.0.0.1:${port}/fail`);
    const text = await response.text();
    child.signal('SIGTERM');
    await child.exited;
    const incident = /"instance":"urn:uuid:([^"]+)"/u.exec(text)?.[1];

    expect(text).not.toContain('hunter2');
    expect(child.output().stderr).toContain(`"annotations":{"incident":"${String(incident)}"}`);
    expect(child.output().stderr).toContain('database password is hunter2');
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
  });

  it('writes nothing more to stdout when a client abandons a slow request', async () => {
    const child = spawnServer(serveWithTestRoutes, { HOST: '127.0.0.1', PORT: '0' });
    const port = await child.port;

    const abandoned = await fetch(`http://127.0.0.1:${port}/slow?ms=300`, { signal: AbortSignal.timeout(50) }).then(
      () => 'answered',
      () => 'abandoned',
    );
    await setTimeout(500);
    child.signal('SIGTERM');

    expect({ abandoned, exitCode: await child.exited }).toEqual({ abandoned: 'abandoned', exitCode: 0 });
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
  });
});
