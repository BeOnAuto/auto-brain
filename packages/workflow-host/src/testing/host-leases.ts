import { Effect, Schema } from 'effect';

import { oneRowOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { until } from '../reaction-testing/until.ts';

const LeaseRow = Schema.Struct({ holder: Schema.String, expires_at: WholeNumber });

export type Lease = typeof LeaseRow.Type;

export function leaseOn(database: HostDatabase): Promise<Lease> {
  return Effect.runPromise(
    oneRowOf(LeaseRow, database.read(statement`SELECT holder, expires_at FROM workflow_leases`)),
  );
}

export async function untilRenewedBy(database: HostDatabase, { holder }: Lease, renewals: number): Promise<void> {
  const expiries = new Set<number>();
  await until(
    async () => {
      const lease = await leaseOn(database);
      for (const renewal of [lease].filter((each) => each.holder === holder)) {
        expiries.add(renewal.expires_at);
      }
      return expiries.size;
    },
    (renewed) => renewed > renewals,
  );
}
