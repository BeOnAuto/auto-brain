import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/logged-lines.ts';
import { spawnServer, spawnedServerTestTimeoutMs, type SpawnedServer } from '../testing/spawned-server.ts';
import { logIncident } from './logging.ts';

const serveWithSelfCausedError = fileURLToPath(new URL('../testing/serve-with-self-caused-error.ts', import.meta.url));

const selfCaused = new Error('an error whose cause is itself');
selfCaused.cause = selfCaused;

async function stderrOnceItContains(child: SpawnedServer, text: string, attemptsLeft = 40): Promise<string> {
  const { stderr } = child.output();
  if (stderr.includes(text) || attemptsLeft === 0) {
    return stderr;
  }
  await setTimeout(50);
  return stderrOnceItContains(child, text, attemptsLeft - 1);
}

describe('logIncident for an error whose cause cannot be formatted', () => {
  it('logs a line with the incident id and the call, and no cause', async () => {
    const call = { operation: 'add_note', org: 'acme', caller: 'acme-admin' };

    const lines = await linesLoggedBy(logIncident({ id: 'incident-1', original: selfCaused, call }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"message":"Unexpected error whose cause could not be formatted"');
    expect(lines[0]).toContain(
      '"annotations":{"incident":"incident-1","operation":"add_note","org":"acme","caller":"acme-admin"}',
    );
    expect(lines[0]).not.toContain('"cause"');
  });
});

describe('a server whose route throws an error that is its own cause', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('answers 500, logs the incident and keeps serving', async () => {
    const child = spawnServer(serveWithSelfCausedError, { HOST: '127.0.0.1', PORT: '0', LOCAL_MODE: 'true' });
    const port = await child.port;

    const failed = await fetch(`http://127.0.0.1:${port}/self-caused`);
    const incident = /"instance":"urn:uuid:([^"]+)"/u.exec(await failed.text())?.[1];
    const stderr = await stderrOnceItContains(child, `"incident":"${String(incident)}"`);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');

    expect({ failed: failed.status, health: health.status, exitCode: await child.exited }).toEqual({
      failed: 500,
      health: 200,
      exitCode: 0,
    });
    expect(stderr).toContain('"message":"Unexpected error whose cause could not be formatted"');
    expect(stderr).toContain(
      `"annotations":{"requestId":"${String(failed.headers.get('x-request-id'))}","incident":"${String(incident)}"}`,
    );
  });
});
