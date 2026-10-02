import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/spawned-server.ts';
import {
  formatPretty,
  logAccessMode,
  logIncident,
  logMcpError,
  logProviderMessage,
  logTemporal,
  logUnsettled,
  logWorkflowsNotOffered,
  logWorkflowsOffered,
} from './logging.ts';

async function linesLoggedBy(effect: Effect.Effect<void>): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([capture]))));
  return lines;
}

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

const serveWithTestRoutes = fileURLToPath(new URL('../testing/serve-with-test-routes.ts', import.meta.url));

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
  it('say whether workflows are offered, and with which Temporal server, namespace and task queue', async () => {
    const offered = await linesLoggedBy(
      logWorkflowsOffered({ address: 'temporal:7233', namespace: 'acme', taskQueue: 'brains' }),
    );
    const notOffered = await linesLoggedBy(logWorkflowsNotOffered);

    expect(offered).toEqual([
      expect.stringContaining(
        '"message":"Workflows are offered with Temporal at temporal:7233, namespace acme, task queue brains","level":"INFO"',
      ),
    ]);
    expect(notOffered).toEqual([
      expect.stringContaining('"message":"Workflows are not offered because TEMPORAL_ADDRESS is unset","level":"INFO"'),
    ]);
  });

  it('report an execution settling left started as an error with its org, brain, id and reason only', async () => {
    const [line] = await linesLoggedBy(
      logUnsettled({ org: 'acme', brain: 'alpha', executionId: 'e-1', reason: 'The ledger has no such execution' }),
    );

    expect(line).toContain('"message":"An execution stays started because settling it failed","level":"ERROR"');
    expect(line).toContain(
      '"annotations":{"org":"acme","brain":"alpha","execution_id":"e-1","reason":"The ledger has no such execution"}',
    );
  });

  it("pass on Temporal's warnings and errors at their level, with the fields Temporal gave", async () => {
    const lines = [
      ...(await linesLoggedBy(
        logTemporal({ level: 'WARN', message: 'Temporal reported: Activity failed', context: { attempt: 2 } }),
      )),
      ...(await linesLoggedBy(
        logTemporal({ level: 'ERROR', message: 'Temporal reported: Worker failed', context: {} }),
      )),
      ...(await linesLoggedBy(
        logTemporal({ level: 'INFO', message: 'The workflow worker reached Temporal again', context: {} }),
      )),
    ];

    expect(lines).toEqual([
      expect.stringContaining('"message":"Temporal reported: Activity failed","level":"WARN"'),
      expect.stringContaining('"message":"Temporal reported: Worker failed","level":"ERROR"'),
      expect.stringContaining('"message":"The workflow worker reached Temporal again","level":"INFO"'),
    ]);
    expect(lines[0]).toContain('"annotations":{"attempt":2}');
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

describe('logProviderMessage', () => {
  it('warns with the provider, the model, the status, the execution and what the provider said', async () => {
    const [line] = await linesLoggedBy(
      logProviderMessage({
        provider: 'gateway',
        model: 'gateway/no-such-model',
        status: 404,
        message: 'No fallback model group found',
        execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      }),
    );

    expect(line).toContain('"message":"Model provider gateway answered with an error","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"provider":"gateway","model":"gateway/no-such-model","status":404,"execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","provider_message":"No fallback model group found"}',
    );
  });
});

describe('the pretty log format', () => {
  it('writes the local time, the level, the message and then the annotations on one line', async () => {
    const lines = await prettyLinesLoggedBy(
      logWorkflowsOffered({ address: 'temporal:7233', namespace: 'acme', taskQueue: 'brains' }),
    );

    expect(lines).toEqual([
      '<time> INFO  Workflows are offered with Temporal at temporal:7233, namespace acme, task queue brains temporal_address=temporal:7233 namespace=acme task_queue=brains',
    ]);
  });

  it('writes an annotation that is not one plain word as JSON', async () => {
    const lines = await prettyLinesLoggedBy(
      logUnsettled({ org: 'acme', brain: 'alpha', executionId: 'e-1', reason: 'The ledger has no such execution' }),
    );

    expect(lines).toEqual([
      '<time> ERROR An execution stays started because settling it failed org=acme brain=alpha execution_id=e-1 reason="The ledger has no such execution"',
    ]);
  });

  it('puts the source of a line first, in brackets, and writes a message that is not text as JSON', async () => {
    const lines = await prettyLinesLoggedBy(
      Effect.logWarning({ answered: false }).pipe(Effect.annotateLogs({ source: 'temporal', attempt: 2 })),
    );

    expect(lines).toEqual(['<time> WARN  [temporal] {"answered":false} attempt=2']);
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
      expect.stringMatching(/^WARN {2}No model provider is configured, .* providers=\[\{"provider":"anthropic",/u),
      'INFO  Workflows are not offered because TEMPORAL_ADDRESS is unset',
      '',
    ]);
  });
});
