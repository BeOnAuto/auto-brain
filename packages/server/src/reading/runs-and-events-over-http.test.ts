import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { internalTermsIn } from '@beonauto/api/testing';
import { answers, textResult } from '@beonauto/inference/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import type { TestResponse } from '../testing/http-client.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onADatabaseOfItsOwn(): Promise<Readonly<Record<string, string>>> {
  const name = `reading_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LOCAL_MODE: 'true', LEDGER_FILE: '', DATABASE_URL: database.href };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly environment: () => Promise<Readonly<Record<string, string>>>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, environment: () => Promise.resolve({ LOCAL_MODE: 'true' }) },
  { store: `PostgreSQL${postgresqlNotice}`, skipped: postgresql === '', environment: onADatabaseOfItsOwn },
];

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const succeeded = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const rejected = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const EventsSchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String })),
  next_cursor: Schema.NullOr(Schema.String),
});

const eventsOf = Schema.decodeUnknownSync(EventsSchema);

const ExecutionsSchema = Schema.Struct({
  executions: Schema.Array(Schema.Struct({ execution_id: Schema.String })),
  next_cursor: Schema.NullOr(Schema.String),
});

const executionsOf = Schema.decodeUnknownSync(ExecutionsSchema);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function eventually(
  path: string,
  until: (response: TestResponse) => boolean,
  tries = 500,
): Promise<TestResponse> {
  const response = await server.call('GET', path);
  if (until(response) || tries === 0) {
    return response;
  }
  await setTimeout(20);
  return eventually(path, until, tries - 1);
}

function holding(count: number): (response: TestResponse) => boolean {
  return ({ status, body }) =>
    status === 200 &&
    (Schema.is(EventsSchema)(body) ? body.events.length : executionsOf(body).executions.length) === count;
}

async function brainWithTwoRuns(environment: Readonly<Record<string, string>>): Promise<void> {
  server = await servingReasoning([answers(textResult('Profits\u0000rose.'))], environment);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/specs/inference/summary/execute`, {
    body: { input: { text: 'the\u0000quarter' }, execution_id: succeeded },
  });
  await server.call('POST', `${alpha}/specs/inference/summary/execute`, {
    body: { input: { text: 7 }, execution_id: rejected },
  });
}

function nextPageOf({ body }: TestResponse): string {
  return `${alpha}/executions?cursor=${String(executionsOf(body).next_cursor)}`;
}

describe.each(stores)('the runs of a brain over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('are listed newest first, filtered, and paged through', async () => {
    await brainWithTwoRuns(await environment());

    const listed = await eventually(`${alpha}/executions`, holding(2));
    const filtered = await server.call('GET', `${alpha}/executions?status=succeeded&primitive=inference&name=summary`);
    const first = await server.call('GET', `${alpha}/executions?limit=1`);
    const next = await server.call('GET', nextPageOf(first));

    expect(listed).toMatchObject({
      status: 200,
      body: {
        executions: [
          { execution_id: rejected, status: 'rejected', rejection: { reason: 'invalid_input' } },
          { execution_id: succeeded, status: 'succeeded', primitive: 'inference', name: 'summary', spec_version: 1 },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
    expect(listed.body).not.toHaveProperty('executions.1.output');
    expect([filtered, next].map(({ body }) => executionsOf(body).executions.map(({ execution_id: id }) => id))).toEqual(
      [[succeeded], [succeeded]],
    );
  });
});

describe.each(stores)('the history of a run over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('reads a run whose input and output hold U+0000', async () => {
    await brainWithTwoRuns(await environment());

    expect(await eventually(`${alpha}/executions/${succeeded}/history`, holding(2))).toMatchObject({
      status: 200,
      body: {
        events: [
          { type: 'execution_started', data: { execution_id: succeeded, input_bytes: 27 } },
          { type: 'execution_succeeded', data: { execution_id: succeeded, output_bytes: 20 } },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
    expect(await server.call('GET', `${alpha}/executions/0199a3c4-7d2e-7c1a-9b3f-000000000000/history`)).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
  });
});

describe.each(stores)('the events of a brain over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('follow what happened in the brain, in plain words, by type', async () => {
    await brainWithTwoRuns(await environment());

    const feed = eventsOf((await eventually(`${alpha}/events`, holding(5))).body);
    const created = eventsOf((await server.call('GET', `${alpha}/events?type=spec_created`)).body);

    expect(feed.events.map(({ type }) => type)).toEqual([
      'execution_rejected',
      'execution_started',
      'execution_succeeded',
      'execution_started',
      'spec_created',
    ]);
    expect(feed.events.flatMap(({ summary: words }) => internalTermsIn(words))).toEqual([]);
    expect(created.events.map(({ summary: words }) => words)).toEqual([
      'The reasoning function “summary” was created.',
    ]);
  });
});

describe.each(stores)('a retired brain over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('keeps its runs and events readable, while a change is refused', async () => {
    await brainWithTwoRuns(await environment());
    await server.call('POST', '/v1/orgs/acme/brains/alpha/retire');

    const reads = await Promise.all(
      [`${alpha}/executions`, `${alpha}/executions/${succeeded}/history`, `${alpha}/events`].map((path) =>
        server.call('GET', path),
      ),
    );
    const change = await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'other', source: summary } });

    expect(reads.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(change).toMatchObject({
      status: 409,
      body: { reason: 'conflict', detail: 'The brain alpha is retired and can no longer change' },
    });
  });

  it.skipIf(skipped)('refuse a cursor the brain did not give', async () => {
    await brainWithTwoRuns(await environment());

    expect(await server.call('GET', `${alpha}/events?cursor=not-a-cursor`)).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/cursor' }] },
    });
  });
});

async function anAppendLeftOpen(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY['{}'::jsonb], ARRAY['1'], ARRAY['note_added'], ARRAY['E'],
      'brain/acme/alpha/notes', 'brain', 0, 'emt:default')`,
    [{ json: JSON.stringify({ type: 'note_added', text: 'late' }) }],
  );
  return client;
}

describe.skipIf(postgresql === '')(
  `the history of a run behind an append left open, on PostgreSQL${postgresqlNotice}`,
  () => {
    it('is an empty page oldest first, not not_found, and the events once the append commits', async () => {
      const environment = await onADatabaseOfItsOwn();
      server = await servingReasoning([answers(textResult('Profits rose.'))], environment);
      await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
      const open = await anAppendLeftOpen(String(environment['DATABASE_URL']));
      await server.call('POST', `${alpha}/specs/inference/summary/execute`, {
        body: { input: { text: 'the quarter' }, execution_id: succeeded },
      });

      const execution = await server.call('GET', `${alpha}/executions/${succeeded}`);
      const behind = await server.call('GET', `${alpha}/executions/${succeeded}/history`);
      const newestFirst = await server.call('GET', `${alpha}/executions/${succeeded}/history?order=desc`);
      await open.query('COMMIT');
      const after = await eventually(`${alpha}/executions/${succeeded}/history`, holding(2));

      expect(execution).toMatchObject({ status: 200, body: { status: 'succeeded' } });
      expect(behind).toMatchObject({ status: 200, body: { events: [], has_more: false, next_cursor: null } });
      expect(eventsOf(newestFirst.body).events.map(({ type }) => type)).toEqual([
        'execution_succeeded',
        'execution_started',
      ]);
      expect(eventsOf(after.body).events.map(({ type }) => type)).toEqual(['execution_started', 'execution_succeeded']);
    });
  },
);
