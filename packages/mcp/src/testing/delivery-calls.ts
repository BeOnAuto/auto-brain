import { Effect } from 'effect';
import { afterEach } from 'vitest';

import type { ToolAccess } from '../access/tool-access.ts';
import type { CalledOnce, DeliveryCall } from '../delivery/delivery-bounds.ts';
import { serveFakeMcp, type FakeMcpServer } from './fake-mcp-server.ts';
import { patientTiming } from './index.ts';
import { reportingAccess } from './reporting-access.ts';

export const deliveryKey = 'graph-api-key-4f1d9a7c2b';

export const deliveredRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const deliveryId = '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

export function closedAfter(close: () => Promise<void>): void {
  closing.push(close);
}

export async function deliveryServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: deliveryKey });
  closedAfter(fake.close);
  return fake;
}

const delivered = ['echo', 'denied', 'sleep', 'large', 'search', 'gone', 'profile'];

export function deliveryAccess(
  url: string,
  changes: Readonly<Record<string, unknown>> = {},
  callMs = patientTiming.callMs,
): ToolAccess {
  const { access } = reportingAccess(
    {
      graph: {
        url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
        org: 'acme',
        allowed: delivered,
        ...changes,
      },
    },
    { environment: { GRAPH_API_KEY: deliveryKey }, timing: { ...patientTiming, callMs } },
  );
  closedAfter(access.close);
  return access;
}

export const delivery: DeliveryCall = {
  org: 'acme',
  brain: 'alpha',
  reference: { server: 'graph', tool: 'echo' },
  input: { channel: '#approvals', text: 'Please approve' },
  meta: { 'com.beonauto/execution_id': deliveredRunId, 'com.beonauto/delivery_id': deliveryId },
};

export function calledOnce(
  access: Pick<ToolAccess, 'callOnce'>,
  changes: Readonly<Partial<DeliveryCall>> = {},
): Promise<CalledOnce> {
  return Effect.runPromise(access.callOnce({ ...delivery, ...changes }));
}

export function failedWith(outcome: string, detail: unknown, retryAfterMs: number | null = null) {
  return { kind: 'answered', outcome, detail, retryAfterMs };
}

export function unopenedWith(detail: string) {
  return { kind: 'unopened', because: 'mcp_server_failed', detail };
}
