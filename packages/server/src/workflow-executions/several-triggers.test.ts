import { setTimeout } from 'node:timers/promises';

import { internalTermsIn, withMcpSession } from '@beonauto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';

const aWhile = 150_000;

const closing = workflowSource(
  'close-the-month',
  [
    'schedule:',
    '  on: { one: { with: { type: com.acme.ledger.closed } } }',
    "  cron: '* * * * *'",
    '  every: PT1M',
    'do:',
    "  - keep: { set: { input: '${ . }' } }",
    '',
  ].join('\n'),
);

const TriggerSchema = Schema.Struct({ kind: Schema.String, reference: Schema.String });

const ListedRuns = Schema.Struct({
  executions: Schema.Array(
    Schema.Struct({ execution_id: Schema.String, status: Schema.String, started_by: Schema.String }),
  ),
});

const StartSchema = Schema.Struct({
  type: Schema.String,
  causation_id: Schema.NullOr(Schema.String),
  summary: Schema.String,
  data: Schema.Struct({ trigger: TriggerSchema }),
});

const HistoryPage = Schema.Struct({ events: Schema.NonEmptyArray(Schema.Unknown) });

const Triggers = Schema.Struct({ triggers: Schema.Array(TriggerSchema) });

const SavedSpec = Schema.Struct({ ...Triggers.fields, triggers_since: Schema.String });

const BrainEvents = Schema.Struct({ events: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const historyIn = Schema.decodeUnknownSync(HistoryPage);

const startIn = Schema.decodeUnknownSync(StartSchema);

const specIn = Schema.decodeUnknownSync(SavedSpec);

const ListedSpecs = Schema.Struct({ specs: Schema.Array(Triggers) });

const listedIn = Schema.decodeUnknownSync(ListedSpecs);

const eventsIn = Schema.decodeUnknownSync(BrainEvents);

type Start = typeof StartSchema.Type;

interface Seen {
  readonly runs: typeof ListedRuns.Type;
  readonly starts: readonly Start[];
  readonly spec: typeof SavedSpec.Type;
  readonly eventRecord: string;
  readonly listedOverMcp: typeof ListedSpecs.Type;
  readonly startOverMcp: Start;
}

let server: ReasoningServer;

let seen: Seen;

async function endedRuns(attempts = 1200): Promise<typeof ListedRuns.Type> {
  const listed = runsIn(
    (await server.call('GET', `${alpha}/executions?primitive=orchestration&name=close-the-month`)).body,
  );
  if (listed.executions.filter(({ status }) => status !== 'started').length >= 3 || attempts <= 1) {
    return listed;
  }
  await setTimeout(100);
  return endedRuns(attempts - 1);
}

async function startOf(executionId: string): Promise<Start> {
  return startIn(historyIn((await server.call('GET', `${alpha}/executions/${executionId}/history`)).body).events[0]);
}

function startByKind(kind: string): Start | undefined {
  return seen.starts.find(({ data }) => data.trigger.kind === kind);
}

async function triggeredThreeTimes(): Promise<Seen> {
  server = await servingWorkflows([]);
  const mcp = { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} };
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await withMcpSession('current revision', mcp, (session) =>
    session.callTool('create_spec', { primitive: 'orchestration', name: 'close-the-month', source: closing }),
  );
  await server.call('POST', `${alpha}/events`, {
    body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'september' } } },
  });
  const runs = await endedRuns();
  const starts = await Promise.all(runs.executions.map(({ execution_id: executionId }) => startOf(executionId)));
  const newest = runs.executions[0]?.execution_id ?? '';
  const overMcp = await withMcpSession('current revision', mcp, async (session) => ({
    listed: listedIn((await session.callTool('list_specs', { primitive: 'orchestration' })).structuredContent),
    history: historyIn((await session.callTool('get_execution_history', { execution_id: newest })).structuredContent),
  }));
  return {
    runs,
    starts,
    spec: specIn((await server.call('GET', `${alpha}/specs/orchestration/close-the-month`)).body),
    eventRecord: eventsIn((await server.call('GET', `${alpha}/events?type=event_published`)).body).events[0].id,
    listedOverMcp: overMcp.listed,
    startOverMcp: startIn(overMcp.history.events[0]),
  };
}

beforeAll(async () => {
  seen = await triggeredThreeTimes();
}, aWhile);

afterAll(async () => {
  await server.stop();
});

describe('a workflow with an event trigger, a cron schedule and an every schedule', () => {
  it('shows its triggers in the order its document names them, over HTTP and MCP', () => {
    expect(seen.spec.triggers).toEqual([
      { kind: 'event', reference: '/schedule/on' },
      { kind: 'cron', reference: '/schedule/cron' },
      { kind: 'every', reference: '/schedule/every' },
    ]);
    expect(seen.listedOverMcp.specs).toEqual([{ triggers: seen.spec.triggers }]);
  });

  it('runs as the brain once for an event and once at a due time of each schedule', () => {
    expect(seen.runs.executions.map(({ status, started_by: by }) => [status, by])).toEqual([
      ['succeeded', 'brain:alpha'],
      ['succeeded', 'brain:alpha'],
      ['succeeded', 'brain:alpha'],
    ]);
    expect(
      seen.starts.map(({ data }) => data.trigger.kind).toSorted((first, second) => first.localeCompare(second)),
    ).toEqual(['cron', 'event', 'every']);
  });

  it('names in the history of each run the trigger that started it, and what caused it', () => {
    expect([startByKind('event'), startByKind('cron'), startByKind('every')]).toEqual([
      {
        type: 'execution_started',
        summary: 'A run of the workflow “close-the-month” was started by its event trigger.',
        causation_id: seen.eventRecord,
        data: { trigger: { kind: 'event', reference: '/schedule/on' } },
      },
      {
        type: 'execution_started',
        summary: 'A run of the workflow “close-the-month” was started by its cron schedule.',
        causation_id: seen.spec.triggers_since,
        data: { trigger: { kind: 'cron', reference: '/schedule/cron' } },
      },
      {
        type: 'execution_started',
        summary: 'A run of the workflow “close-the-month” was started by its every schedule.',
        causation_id: seen.spec.triggers_since,
        data: { trigger: { kind: 'every', reference: '/schedule/every' } },
      },
    ]);
    expect(seen.startOverMcp).toEqual(seen.starts[0]);
    expect(seen.starts.flatMap(({ summary }) => internalTermsIn(summary))).toEqual([]);
  });
});
