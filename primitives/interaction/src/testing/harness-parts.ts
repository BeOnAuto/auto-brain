import type { ToolAccess } from '@beonauto/mcp';
import type { Outcome } from '@beonauto/operations';
import type { BrainOperation } from '@beonauto/specs';
import { Effect, Schema } from 'effect';

import { listInteractions } from '../requests/list-interactions.ts';
import type { DueRequestItem } from '../schedule/due-requests.ts';

const ListedSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({ interactions: Schema.Array(Schema.Unknown) }),
});

const decodeListed = Schema.decodeUnknownSync(ListedSchema);

export async function firstOpenOf(
  call: (operation: BrainOperation, input: unknown) => Promise<Outcome>,
): Promise<unknown> {
  return decodeListed(await call(listInteractions, {})).output.interactions[0];
}

export const noTools: Pick<ToolAccess, 'callOnce'> = {
  callOnce: () => Effect.succeed({ outcome: 'not_offered', detail: 'No MCP server is configured', retryAfterMs: null }),
};

export function performedAll(items: readonly DueRequestItem[], now: number): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(items, (item) => item.perform(now), { concurrency: 'unbounded', discard: true }),
  );
}

export function performedEach(times: readonly number[], perform: (now: number) => Promise<number>): Promise<void> {
  return Effect.runPromise(Effect.forEach(times, (now) => Effect.promise(() => perform(now)), { discard: true }));
}
