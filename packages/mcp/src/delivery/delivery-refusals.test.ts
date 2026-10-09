import { once } from 'node:events';
import { createServer } from 'node:http';

import { Effect, Function, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import {
  calledOnce,
  closedAfter,
  deliveryAccess,
  deliveryKey,
  deliveryServer,
  failedWith,
  unopenedWith,
} from '../testing/delivery-calls.ts';
import { patientTiming, recordingCallJournal, reportingAccess, toolRun } from '../testing/index.ts';
import { deliveryBounds } from './delivery-bounds.ts';

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const alpha = { org: 'acme', brain: 'alpha' };

describe('a server that cannot take a delivery now', () => {
  it('hands on the wait a 429 asks for to the schedule of the delivery, without waiting it out in the call', async () => {
    const fake = await deliveryServer();
    const access = deliveryAccess(fake.url);
    const tools = Result.getOrThrow(
      await Effect.runPromise(
        Effect.result(access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }])),
      ),
    );
    closedAfter(tools.close);

    fake.answerNextWith(429, 1, { 'retry-after': '120' });

    expect(await calledOnce(access)).toMatchObject(
      failedWith('server_failure', 'The MCP server answered HTTP 429', 120_000),
    );
  });

  it('is unopened when the server cannot be reached, so nothing was sent', async () => {
    const fake = await deliveryServer();
    const { url } = fake;
    await fake.close();

    expect(await calledOnce(deliveryAccess(url))).toEqual(unopenedWith('The MCP server could not be reached'));
  });

  it('keeps the words of a failure to 1 KiB, the bound every reader of a failure shares', async () => {
    const fake = await deliveryServer();
    const refusal = 'The gateway refused the request. '.repeat(100);
    const { access } = reportingAccess(
      { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: deliveryKey }, fetch: () => Promise.reject(new Error(refusal)) },
    );
    closedAfter(access.close);

    expect(await calledOnce(access)).toEqual(unopenedWith(refusal.slice(0, toolBounds.failureBytes)));
  });
});

describe('a delivery through a tool this brain is not offered', () => {
  it('is refused before anything is sent or recorded, for a server it does not have, of another org, or a tool not allowed', async () => {
    const fake = await deliveryServer();
    const access = deliveryAccess(fake.url);

    expect([
      await calledOnce(access, { reference: { server: 'wiki', tool: 'echo' } }),
      await calledOnce(deliveryAccess(fake.url, { org: 'globex' })),
      await calledOnce(access, { reference: { server: 'graph', tool: 'environment' } }),
    ]).toEqual([
      {
        kind: 'not_offered',
        because: 'mcp_server_not_configured',
        detail: 'No MCP server named wiki is configured for this brain',
      },
      {
        kind: 'not_offered',
        because: 'mcp_server_not_configured',
        detail: 'No MCP server named graph is configured for this brain',
      },
      {
        kind: 'not_offered',
        because: 'tool_not_allowed',
        detail: 'The operator of this server does not allow graph/environment',
      },
    ]);
    expect(fake.received()).toEqual([]);
  });

  it('is told by name alone, before any connection, as a run asks before it records anything', async () => {
    const fake = await deliveryServer();
    const access = deliveryAccess(fake.url);

    expect([
      Result.isSuccess(access.named(alpha, [{ server: 'graph', tool: 'echo' }])),
      access.named(alpha, [{ server: 'graph', tool: 'environment' }]),
    ]).toMatchObject([true, Result.fail({ because: 'tool_not_allowed' })]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('a delivery to a server that opens no connection', () => {
  it(
    'fails at the bound of a delivery, though the shared opening of tool calls may wait longer',
    async () => {
      const silent = createServer(Function.constVoid);
      silent.listen(0, '127.0.0.1');
      await once(silent, 'listening');
      closedAfter(async () => {
        silent.closeAllConnections();
        silent.close();
        await once(silent, 'close');
      });
      const startedAt = Date.now();

      const ended = await calledOnce(deliveryAccess(`http://127.0.0.1:${String(portOf(silent.address()).port)}/mcp`));

      expect(patientTiming.openMs).toBeGreaterThan(deliveryBounds.connectionMs);
      expect(ended).toEqual(
        unopenedWith(`The MCP server graph did not open a connection within ${deliveryBounds.connectionMs} ms`),
      );
      expect(Date.now() - startedAt).toBeLessThan(patientTiming.openMs);
    },
    2 * deliveryBounds.connectionMs,
  );
});
