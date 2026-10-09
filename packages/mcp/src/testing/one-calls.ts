import { Effect } from 'effect';
import { afterEach } from 'vitest';

import type { ToolAccess } from '../access/tool-access.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import type { CalledOnce } from '../one-call/called-once.ts';
import type { OneCall, RunCall } from '../one-call/one-call.ts';
import { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer } from './fake-mcp-server.ts';
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

export async function deliveryServer(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ ...options, bearer: deliveryKey });
  closedAfter(fake.close);
  return fake;
}

const delivered = ['echo', 'denied', 'sleep', 'large', 'search', 'gone', 'profile'];

export function deliveryAccess(
  url: string,
  changes: Readonly<Record<string, unknown>> = {},
  timing: Partial<Timing> = {},
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
    { environment: { GRAPH_API_KEY: deliveryKey }, timing: { ...patientTiming, ...timing } },
  );
  closedAfter(access.close);
  return access;
}

export const delivery: OneCall = {
  org: 'acme',
  brain: 'alpha',
  reference: { server: 'graph', tool: 'echo' },
  input: { channel: '#approvals', text: 'Please approve' },
  meta: { 'com.beonauto/run_id': deliveredRunId, 'com.beonauto/delivery_id': deliveryId },
};

export function calledOnce(
  access: Pick<ToolAccess, 'callOnce'>,
  changes: Readonly<Partial<OneCall>> = {},
  runCall?: RunCall,
): Promise<CalledOnce> {
  return Effect.runPromise(access.callOnce({ ...delivery, ...changes }, runCall));
}

export function failedWith(outcome: string, detail: unknown, retryAfterMs: number | null = null) {
  return { kind: 'answered', outcome, detail, retryAfterMs };
}

export function unopenedWith(refused: string, because: string, detail: string) {
  return { kind: 'unopened', refused, because, detail };
}
