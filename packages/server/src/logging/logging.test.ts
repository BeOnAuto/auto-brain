import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Cause, Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';
import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import {
  formatPretty,
  logAccessMode,
  logIncident,
  logLostWorkflowConnection,
  logMcpError,
  logUnsettled,
  logWorkflows,
  logWorkflowTrouble,
} from './logging.ts';

async function prettyLinesLoggedBy(effect: Effect.Effect<void>): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(formatPretty, (line: string) => {
    lines.push(line.replace(/^\d{2}:\d{2}:\d{2}\.\d{3} /u, '<time> '));
  });
  await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([capture]))));
  return lines;
}

function syntaxErrorParsing(text: string): SyntaxError {
  try {
    JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return error;
    }
  }
  throw new TypeError(`${text} parsed as JSON`);
}

const serveWithTestRoutes = fileURLToPath(new URL('../testing/entries/serve-with-test-routes.ts', import.meta.url));

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ':memory:' };

describe('logAccessMode', () => {
  it('warns that local mode trusts every request', async () => {
    const [line] = await linesLoggedBy(logAccessMode('local', true));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain(
      '"message":"Local mode is on: every request is trusted as the local developer, with every permission in every org. Never enable LOCAL_MODE on a machine reachable through a proxy"',
    );
  });

  it('warns when the server is not in local mode and has no API keys', async () => {
    const [line] = await linesLoggedBy(logAccessMode('closed', false));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain(
      '"message":"No request can authenticate: API_KEYS lists no keys and local mode is off, so every path except /health answers 401"',
    );
  });

  it('says nothing when API keys are configured', async () => {
    expect(await linesLoggedBy(logAccessMode('keys', false))).toEqual([]);
  });

  it('warns that LOCAL_MODE is ignored when API keys are configured', async () => {
    const lines = await linesLoggedBy(logAccessMode('keys', true));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"message":"LOCAL_MODE is ignored because API keys are configured"');
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

describe('the workflow logs', () => {
  it('say how long a run lasts at most, how many calls run at once and how often the runs are swept', async () => {
    const [line] = await linesLoggedBy(
      logWorkflows({ mostDurationMs: 2_592_000_000, mostCallsAtOnce: 32, sweepEveryMs: 1000 }),
    );

    expect(line).toContain(
      '"message":"Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms","level":"INFO"',
    );
    expect(line).toContain(
      '"annotations":{"most_duration_ms":2592000000,"most_calls_at_once":32,"sweep_every_ms":1000}',
    );
  });

  it.each([
    [86_400_000, 'a run lasts at most 1 day,'],
    [7_200_000, 'a run lasts at most 2 hours,'],
    [5_400_000, 'a run lasts at most 1.5 hours,'],
  ])('say a longest run of %i ms in days or hours', async (mostDurationMs, words) => {
    const [line] = await linesLoggedBy(logWorkflows({ mostDurationMs, mostCallsAtOnce: 1, sweepEveryMs: 10 }));

    expect(line).toContain(words);
  });

  it('report a run settling left started as an error with its org, brain, id and reason only', async () => {
    const [line] = await linesLoggedBy(
      logUnsettled({ org: 'acme', brain: 'alpha', runId: 'e-1', reason: 'The ledger has no such run' }),
    );

    expect(line).toContain('"message":"A run stays started because settling it failed","level":"ERROR"');
    expect(line).toContain(
      '"annotations":{"org":"acme","brain":"alpha","run_id":"e-1","reason":"The ledger has no such run"}',
    );
  });
});

describe('the workflow warnings', () => {
  it('warn of trouble in the workflows with what failed and its cause, cut to 2,000 characters', async () => {
    const [line] = await linesLoggedBy(
      logWorkflowTrouble(
        'A sweep of the runs failed; the next sweep tries again',
        Cause.fail(new Error(`the database is gone ${'x'.repeat(3000)}`)),
      ),
    );

    expect(line).toContain('"message":"A sweep of the runs failed; the next sweep tries again","level":"WARN"');
    expect(line).toContain('"error":"Error: the database is gone xxx');
    expect(line).not.toContain('x'.repeat(2000));
  });

  it('warn that a connection of the workflows to PostgreSQL was lost, with the message of its error', async () => {
    const [line] = await linesLoggedBy(logLostWorkflowConnection(new Error('Connection terminated unexpectedly')));

    expect(line).toContain(
      '"message":"A connection of the workflows to their PostgreSQL database was lost; they open another when they need one","level":"WARN"',
    );
    expect(line).toContain('"annotations":{"error":"Connection terminated unexpectedly"}');
  });
});

describe('logMcpError', () => {
  it('warns with the message of an error the MCP layer reports', async () => {
    const [line] = await linesLoggedBy(
      logMcpError(new Error('Unsupported Media Type: Content-Type must be application/json')),
    );

    expect(line).toContain('"message":"The MCP layer reported an error","level":"WARN"');
    expect(line).toContain('"annotations":{"error":"Unsupported Media Type: Content-Type must be application/json"}');
  });

  it('leaves out the part of the request body that a JSON syntax error quotes', async () => {
    const error = syntaxErrorParsing('token=hunter2');

    const [line] = await linesLoggedBy(logMcpError(error));

    expect(error.message).toBe('Unexpected token \'o\', "token=hunter2" is not valid JSON');
    expect(line).toContain('"annotations":{"error":"The request body is not valid JSON"}');
    expect(line).not.toContain('hunter2');
  });
});

describe('the server process', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('logs an unexpected error to stderr under the incident id it answers with', async () => {
    const child = spawnServer(serveWithTestRoutes, { HOST: '127.0.0.1', PORT: '0', LOCAL_MODE: 'true' });
    const port = await child.port;

    const response = await fetch(`http://127.0.0.1:${port}/fail`);
    const text = await response.text();
    child.signal('SIGTERM');
    await child.exited;
    const incident = /"instance":"urn:uuid:([^"]+)"/u.exec(text)?.[1];

    expect(text).not.toContain('hunter2');
    expect(child.output().stderr).toContain(
      `"annotations":{"requestId":"${String(response.headers.get('x-request-id'))}","incident":"${String(incident)}"}`,
    );
    expect(child.output().stderr).toContain('database password is hunter2');
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
  });

  it('writes nothing more to stdout when a client abandons a slow request', async () => {
    const child = spawnServer(serveWithTestRoutes, { HOST: '127.0.0.1', PORT: '0', LOCAL_MODE: 'true' });
    const port = await child.port;

    const client = new AbortController();
    const requesting = fetch(`http://127.0.0.1:${port}/slow?ms=300`, { signal: client.signal }).then(
      () => 'answered',
      () => 'abandoned',
    );
    await setTimeout(50);
    client.abort();
    const abandoned = await requesting;
    await setTimeout(500);
    child.signal('SIGTERM');

    expect({ abandoned, exitCode: await child.exited }).toEqual({ abandoned: 'abandoned', exitCode: 0 });
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
  });
});

describe('the pretty log format', () => {
  it('writes the local time, the level, the message and then the annotations on one line', async () => {
    const lines = await prettyLinesLoggedBy(
      logWorkflows({ mostDurationMs: 604_800_000, mostCallsAtOnce: 8, sweepEveryMs: 250 }),
    );

    expect(lines).toEqual([
      '<time> INFO  Workflows run in this server: a run lasts at most 7 days, at most 8 of their calls run at once, and the runs are swept every 250 ms most_duration_ms=604800000 most_calls_at_once=8 sweep_every_ms=250',
    ]);
  });

  it('writes an annotation that is not one plain word as JSON', async () => {
    const lines = await prettyLinesLoggedBy(
      logUnsettled({ org: 'acme', brain: 'alpha', runId: 'e-1', reason: 'The ledger has no such run' }),
    );

    expect(lines).toEqual([
      '<time> ERROR A run stays started because settling it failed org=acme brain=alpha run_id=e-1 reason="The ledger has no such run"',
    ]);
  });

  it('puts the source of a line first, in brackets, and writes a message that is not text as JSON', async () => {
    const lines = await prettyLinesLoggedBy(
      Effect.logWarning({ answered: false }).pipe(Effect.annotateLogs({ source: 'dev', attempt: 2 })),
    );

    expect(lines).toEqual(['<time> WARN  [dev] {"answered":false} attempt=2']);
  });

  it('writes the cause of an incident below its line, indented', async () => {
    const [line] = await prettyLinesLoggedBy(
      logIncident({ id: 'incident-1', original: new Error('the ledger is unreachable') }),
    );

    expect(line?.split('\n').slice(0, 2)).toEqual([
      '<time> ERROR Unexpected error incident=incident-1',
      '    Error: the ledger is unreachable',
    ]);
  });
});

describe('the server with LOG_FORMAT=pretty', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('writes its logs as readable lines to stderr, and still exactly the listening line to stdout', async () => {
    const child = spawnServer(mainModule, { ...loopback, LOCAL_MODE: 'true', LOG_FORMAT: 'pretty' });
    const port = await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(
      child
        .output()
        .stderr.split('\n')
        .map((line) => line.replace(/^\d{2}:\d{2}:\d{2}\.\d{3} /u, '')),
    ).toEqual([
      expect.stringMatching(/^WARN {2}Local mode is on: /u),
      'INFO  The ledger is kept in the file :memory: ledger_file=:memory:',
      expect.stringMatching(/^WARN {2}No model provider is configured, .* providers=\[\{"provider":"anthropic",/u),
      'INFO  Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms most_duration_ms=2592000000 most_calls_at_once=32 sweep_every_ms=1000',
      '',
    ]);
  });
});
