import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import type { SpawnedServer } from '../testing/spawned-server.ts';
import { temporaryLedger } from '../testing/temporary-ledger.ts';
import { requestTo, settledOver, workflowProcess } from '../testing/workflow-process.ts';
import { executionIdIn, workflowSource } from '../testing/workflow-server.ts';

const marker = 'marker-7d1c9e';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

interface Spec {
  readonly name: string;
  readonly steps: string;
}

const specs: readonly Spec[] = [
  {
    name: 'document',
    steps: `do:\n  - fail: { raise: { error: { type: https://example.com/${marker}, status: 422, title: ${marker} } } }\n`,
  },
  {
    name: 'input',
    steps:
      "do:\n  - fail: { raise: { error: { type: https://example.com/no, status: 422, title: No, detail: '${ .secret }' } } }\n",
  },
  {
    name: 'event',
    steps: `do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.go } } } } }\n  - fail: { raise: { error: { type: https://example.com/no, status: 422, title: No, detail: '\${ .[0].secret }' } } }\n`,
  },
  {
    name: 'nested',
    steps: `do:\n  - ask: { call: execute_spec, with: { primitive: inference, name: ${marker}, input: { secret: ${marker} } } }\n`,
  },
  { name: 'limit', steps: `timeout: { after: { milliseconds: 300 } }\ndo:\n  - ${marker}: { wait: PT1H }\n` },
  { name: 'flood', steps: 'do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.never } } } } }\n' },
];

async function started(port: number, name: string): Promise<readonly [string, string]> {
  const answer = await requestTo(port, 'POST', `/alpha/specs/orchestration/${name}/execute`, {
    input: { secret: marker },
  });
  return [name, executionIdIn(answer.body)];
}

function idOf(ids: ReadonlyMap<string, string>, name: string): string {
  const id = ids.get(name);
  if (id === undefined) {
    throw new Error(`No execution of ${name} started`);
  }
  return id;
}

async function sent(port: number, executionId: string, event: unknown): Promise<number> {
  const answer = await requestTo(port, 'POST', `/alpha/executions/${executionId}/events`, { event });
  return answer.status;
}

const statusOf = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }));

async function settledEach(port: number, ids: ReadonlyMap<string, string>): Promise<ReadonlyMap<string, unknown>> {
  const settled = await Promise.all(
    [...ids.keys()].map(async (name): Promise<readonly [string, unknown]> => [
      name,
      await settledOver(port, `/alpha/executions/${idOf(ids, name)}`),
    ]),
  );
  return new Map(settled);
}

function statusesOf(settled: ReadonlyMap<string, unknown>): Readonly<Record<string, string>> {
  return Object.fromEntries([...settled.keys()].map((name) => [name, statusOf(settled.get(name)).status]));
}

async function createdInTurn(port: number, remaining: readonly Spec[]): Promise<void> {
  const [first, ...rest] = remaining;
  if (first !== undefined) {
    await requestTo(port, 'POST', '/alpha/specs/orchestration', {
      name: first.name,
      source: workflowSource(first.name, first.steps),
    });
    await createdInTurn(port, rest);
  }
}

async function startedEach(port: number): Promise<ReadonlyMap<string, string>> {
  await requestTo(port, 'POST', '', { brain: 'alpha', name: 'Alpha' });
  await createdInTurn(port, specs);
  return new Map(await Promise.all(specs.map(({ name }) => started(port, name))));
}

async function stopped(child: SpawnedServer): Promise<unknown> {
  await setTimeout(1000);
  child.signal('SIGTERM');
  return child.exited;
}

describe('a workflow that ends for a reason of its tenant', { timeout: 120_000 }, () => {
  it('leaves no trace of its input, document, events or nested rejections in any line the server writes', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;
    const ids = await startedEach(port);

    await sent(port, idOf(ids, 'event'), { type: 'com.acme.go', data: { secret: marker } });
    const flood = await Promise.all(
      Array.from({ length: 70 }, (_, index) =>
        sent(port, idOf(ids, 'flood'), { id: `${marker}-${index}`, type: marker, data: marker }),
      ),
    );
    const settled = await settledEach(port, ids);
    const exitCode = await stopped(child);
    const { stdout, stderr } = child.output();

    expect(exitCode).toBe(0);
    expect(flood).toContain(200);
    expect(statusesOf(settled)).toEqual({
      document: 'rejected',
      input: 'rejected',
      event: 'rejected',
      nested: 'rejected',
      limit: 'rejected',
      flood: 'rejected',
    });
    expect(JSON.stringify([...settled.values()])).toContain(marker);
    expect(`${stdout}${stderr}`).not.toContain(marker);
  });
});
