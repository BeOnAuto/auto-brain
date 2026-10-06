import { fileURLToPath } from 'node:url';

import { withMcpSession } from '@beonauto/api/testing';
import { createApiKey } from '@beonauto/identity';
import { Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { spawnServer, spawnedServerTestTimeoutMs } from './testing/spawned-server.ts';
import { temporaryLedger } from './testing/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('main.ts', import.meta.url));

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const loopback = { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName };

const invalidSettings: ReadonlyArray<readonly [Readonly<Record<string, string>>, string]> = [
  [{ PORT: 'eighty' }, 'InvalidPortError: PORT must be an integer from 0 to 65535, received "eighty"'],
  [{ ALLOWED_ORIGINS: 'app.example.com' }, 'InvalidSettingsError: SchemaError(Expected an origin'],
  [{ API_KEYS: '[{"id":"ci-1"}]' }, 'InvalidApiKeysError: API_KEYS[0].org: Missing key'],
  [{ LOG_FORMAT: 'fancy' }, 'InvalidSettingsError: SchemaError(Expected "json" | "pretty" at ["LOG_FORMAT"])'],
  [
    {
      API_KEYS: JSON.stringify([
        createApiKey({ id: 'ci-1', org: 'local', permissions: ['org:read'], brains: '*' }).entry,
      ]),
    },
    'InvalidApiKeysError: API_KEYS[0].org: This org id is reserved for local mode',
  ],
  [
    { HOST: '0.0.0.0', LOCAL_MODE: 'true' },
    'InvalidLocalModeError: LOCAL_MODE is on, but HOST 0.0.0.0 is not a loopback address',
  ],
  [
    { ORCHESTRATION_SWEEP_INTERVAL: 'PT2M' },
    'InvalidSettingsError: The workflow settings are invalid. ORCHESTRATION_SWEEP_INTERVAL: Expected an ISO 8601 duration from PT0.01S to PT1M, such as PT1S',
  ],
  [
    { MODEL_ALIASES: '{"fast":"gemini"}' },
    'model_settings_invalid: The model settings are invalid. MODEL_ALIASES: /fast: An alias and its target are each written provider/model',
  ],
];

const protectedPath = '/v1/orgs/demo/brains';

const decodeLogLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ message: Schema.String, level: Schema.String })),
);

function logLines(stderr: string): readonly { readonly message: string; readonly level: string }[] {
  return stderr
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const { message, level } = decodeLogLine(line);
      return { message, level };
    });
}

const noModelProvider =
  'No model provider is configured, so reasoning functions cannot run; set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY or MODEL_GATEWAYS';

const workflowsRun =
  'Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms';

const ledgerKept = `The ledger is kept in the file ${ledger.fileName}`;

const ModelLineSchema = Schema.Struct({
  message: Schema.String,
  level: Schema.String,
  annotations: Schema.Record(Schema.String, Schema.Unknown),
});

type ModelLine = typeof ModelLineSchema.Type;

const decodeModelLine = Schema.decodeUnknownSync(Schema.fromJsonString(ModelLineSchema));

function modelLinesOf(stderr: string): readonly ModelLine[] {
  return stderr
    .split('\n')
    .filter((line) => /"message":"(?:Model provider|No model provider)/u.test(line))
    .map((line) => {
      const { message, level, annotations } = decodeModelLine(line);
      return { message, level, annotations };
    });
}

function messagesOf(stderr: string): readonly string[] {
  return logLines(stderr).map(({ message }) => message);
}

function startInLocalMode(...after: readonly string[]): readonly unknown[] {
  return [expect.stringMatching(/^Local mode is on: /u), ledgerKept, noModelProvider, workflowsRun, ...after];
}

describe('main', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('serves health checks when launched with node and exits cleanly on SIGTERM', async () => {
    const child = spawnServer(mainModule, loopback);
    const port = await child.port;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect({ status: health.status, exitCode }).toEqual({ status: 200, exitCode: 0 });
  });

  it('writes exactly the listening line to stdout, and its logs as JSON lines to stderr', async () => {
    const child = spawnServer(mainModule, { ...loopback, LOCAL_MODE: 'true' });
    const port = await child.port;

    await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');
    await child.exited;

    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(child.output().stderr).toMatch(/^\{"message":"Local mode is on: .*"level":"WARN".*\}\n/u);
    expect(messagesOf(child.output().stderr)).toEqual(startInLocalMode());
  });
});

describe('main at start', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('names the configured model providers in one line, keeping every provider in its annotations', async () => {
    const child = spawnServer(mainModule, { ...loopback, LOCAL_MODE: 'true', OPENAI_API_KEY: 'sk-test' });
    await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(modelLinesOf(child.output().stderr)).toEqual([
      {
        message: 'Model providers configured: openai',
        level: 'INFO',
        annotations: {
          providers: [
            { provider: 'openai', configured: true },
            { provider: 'anthropic', configured: false, missing: ['ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN'] },
            { provider: 'google', configured: false, missing: ['GOOGLE_GENERATIVE_AI_API_KEY'] },
            { provider: 'bedrock', configured: false, missing: ['AWS_REGION'] },
            { provider: 'bedrock-anthropic', configured: false, missing: ['AWS_REGION'] },
            { provider: 'azure', configured: false, missing: ['AZURE_RESOURCE_NAME or AZURE_BASE_URL'] },
            {
              provider: 'vertex',
              configured: false,
              missing: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION'],
            },
            {
              provider: 'vertex-anthropic',
              configured: false,
              missing: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION'],
            },
          ],
        },
      },
    ]);
  });

  it('adds a warning of its own for a provider that has some of its settings and lacks others', async () => {
    const child = spawnServer(mainModule, { ...loopback, LOCAL_MODE: 'true', GOOGLE_VERTEX_PROJECT: 'acme-ai' });
    await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(modelLinesOf(child.output().stderr).map(({ message, level }) => ({ message, level }))).toEqual([
      { message: noModelProvider, level: 'WARN' },
      { message: 'Model provider vertex is not configured; it needs GOOGLE_VERTEX_LOCATION', level: 'WARN' },
      { message: 'Model provider vertex-anthropic is not configured; it needs GOOGLE_VERTEX_LOCATION', level: 'WARN' },
    ]);
  });
});

describe('main when it is told to stop', { timeout: spawnedServerTestTimeoutMs }, () => {
  it.each<NodeJS.Signals>(['SIGTERM', 'SIGINT'])(
    'exits 0 on %s without waiting for the shutdown timeout',
    async (signal) => {
      const child = spawnServer(mainModule, loopback);
      await child.port;

      const signalled = performance.now();
      child.signal(signal);
      const exitCode = await child.exited;

      expect(exitCode).toBe(0);
      expect(performance.now() - signalled).toBeLessThan(3000);
    },
  );
});

describe('main with settings', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('requires an API key on protected paths once keys are configured, and says nothing about access', async () => {
    const { key, entry } = createApiKey({ id: 'ci-1', org: 'demo', permissions: ['org:read'], brains: '*' });
    const child = spawnServer(mainModule, { ...loopback, API_KEYS: JSON.stringify([entry]) });
    const port = await child.port;

    const withoutKey = await fetch(`http://127.0.0.1:${port}${protectedPath}`);
    const withKey = await fetch(`http://127.0.0.1:${port}${protectedPath}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    child.signal('SIGTERM');
    await child.exited;

    expect({ withoutKey: withoutKey.status, withKey: withKey.status }).toEqual({ withoutKey: 401, withKey: 200 });
    expect(withoutKey.headers.get('www-authenticate')).toBe('Bearer');
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(messagesOf(child.output().stderr)).toEqual([ledgerKept, noModelProvider, workflowsRun]);
  });

  it.each(invalidSettings)(
    'does not start with %o, naming the error in one line on stderr and writing nothing to stdout',
    async (env, error) => {
      const child = spawnServer(mainModule, { ...loopback, ...env });

      expect(await child.exited).toBe(1);
      expect(child.output().stdout).toBe('');
      expect(child.output().stderr.split('\n')).toEqual([
        expect.stringContaining(`auto-brain could not start: ${error}`),
        '',
      ]);
    },
  );
});

describe('main with secrets in settings it cannot read', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('does not echo a secret of the model settings', async () => {
    const secret = 'sk-gateway-secret-123';
    const child = spawnServer(mainModule, {
      ...loopback,
      MODEL_GATEWAYS: JSON.stringify([
        { name: 'internal', base_url: 'ftp://llm.example', headers: { 'x-key': secret } },
      ]),
    });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr:
        'auto-brain could not start: model_settings_invalid: The model settings are invalid. MODEL_GATEWAYS: /0/base_url: Expected an http or https URL\n',
    });
    expect(child.output().stderr).not.toContain(secret);
  });

  it('does not echo API_KEYS', async () => {
    const { key } = createApiKey({ id: 'ci-1', org: 'demo', permissions: ['org:read'], brains: '*' });
    const child = spawnServer(mainModule, { ...loopback, API_KEYS: key });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr: 'auto-brain could not start: InvalidApiKeysError: API_KEYS: Expected a valid JSON string\n',
    });
  });
});

describe('main over MCP', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('serves the brain tools without a key in local mode, writing only the listening line to stdout', async () => {
    const child = spawnServer(mainModule, { ...loopback, LOCAL_MODE: 'true' });
    const port = await child.port;

    const brain = await withMcpSession(
      'current revision',
      { url: `http://127.0.0.1:${port}/orgs/demo/mcp`, headers: {} },
      async (session) => {
        await session.callTool('create_brain', { brain: 'support', name: 'Support' });
        return session.callTool('get_brain', { brain: 'support' });
      },
    );
    child.signal('SIGTERM');

    expect({ brain: brain.structuredContent, exitCode: await child.exited }).toMatchObject({
      brain: { id: 'support', name: 'Support', created_by: 'local' },
      exitCode: 0,
    });
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(messagesOf(child.output().stderr)).toEqual(startInLocalMode());
  });

  it('logs what the MCP layer reports as a warning on stderr, answering with its JSON-RPC error', async () => {
    const child = spawnServer(mainModule, { ...loopback, LOCAL_MODE: 'true' });
    const port = await child.port;

    const answer = await fetch(`http://127.0.0.1:${port}/orgs/demo/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', accept: 'application/json, text/event-stream' },
      body: '{}',
    });
    const body: unknown = await answer.json();
    child.signal('SIGTERM');
    await child.exited;

    expect({ status: answer.status, body }).toMatchObject({ status: 415, body: { error: { code: -32_000 } } });
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(child.output().stderr).toMatch(
      /\n\{"message":"The MCP layer reported an error","level":"WARN".*"annotations":\{"error":"Unsupported Media Type: Content-Type must be application\/json"\}.*\}\n$/u,
    );
    expect(messagesOf(child.output().stderr)).toEqual(startInLocalMode('The MCP layer reported an error'));
  });
});
