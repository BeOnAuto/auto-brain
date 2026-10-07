import { setTimeout as sleep } from 'node:timers/promises';

import type { Timing } from '../bounds/call-bounds.ts';
import type { ServerSlot } from '../calls/server-slot.ts';
import type { McpConnection } from '../connections/mcp-connection.ts';
import { failureOf, type ServerFailure } from '../connections/server-failures.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { deliveryBounds } from './delivery-bounds.ts';

export type Taken =
  | { readonly connection: McpConnection }
  | { readonly failure: ServerFailure }
  | { readonly late: true };

const late: Taken = { late: true };

export function connectionBoundOf({ openMs }: Pick<Timing, 'openMs'>): number {
  return Math.min(openMs, deliveryBounds.connectionMs);
}

function releasedIfTaken(link: Pick<ServerLink, 'release'>, after: Taken): Promise<void> {
  return 'connection' in after ? link.release() : Promise.resolve();
}

export async function takenWithin(link: Pick<ServerLink, 'take' | 'release'>, connectionMs: number): Promise<Taken> {
  const opening = link.take().then(
    (connection): Taken => ({ connection }),
    (error: unknown): Taken => ({ failure: failureOf(error) }),
  );
  const taken = await Promise.race([opening, sleep(connectionMs, late, { ref: false })]);
  if ('late' in taken) {
    void opening.then((after) => releasedIfTaken(link, after));
  }
  return taken;
}

function afterTheBound<A>(connectionMs: number, value: A): Promise<A> {
  return sleep(connectionMs, value, { ref: false });
}

const lateRestart: unique symbol = Symbol('a restart that did not come in time');

export function boundedSlot(slot: ServerSlot, connectionMs: number): ServerSlot {
  return {
    ...slot,
    reopenOnce: () => Promise.race([slot.reopenOnce(), afterTheBound(connectionMs, false)]),
    restartIfExited: async () => {
      const restart = await Promise.race([slot.restartIfExited(), afterTheBound(connectionMs, lateRestart)]);
      if (restart === lateRestart) {
        throw new Error(`The MCP server process did not start again within ${connectionMs} ms`);
      }
      return restart;
    },
  };
}
