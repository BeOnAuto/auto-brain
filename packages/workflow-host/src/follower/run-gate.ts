import type { RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { passedListeners, pendingArmings } from '../listeners/listener-rows.ts';

export type GateVerdict = 'held' | 'passed' | 'listened';

export interface RunGate {
  readonly verdictOn: (record: RecordedEvent) => Effect.Effect<GateVerdict>;
}

interface Known {
  readonly through: number;
  readonly pending: readonly number[];
}

export function runGateOf(database: HostDatabase, brainKey: string): RunGate {
  const watermark = sqlWatermark(database);
  const [, org = '', brain = ''] = brainKey.split('/');
  const known = new Map<string, Known>();
  const knownOf = (runId: string, record: RecordedEvent): Effect.Effect<Known> => {
    const cached = known.get(runId);
    return cached !== undefined && cached.through >= record.version
      ? Effect.succeed(cached)
      : Effect.map(
          Effect.zip(watermark.read(runId), pendingArmings(database, record.stream)),
          ([through, pending]: readonly [number, readonly number[]]) => {
            known.set(runId, { through, pending });
            return { through, pending };
          },
        );
  };
  return {
    verdictOn: (record) =>
      Effect.gen(function* () {
        const runId = `${org}/${brain}/${record.stream.slice(record.stream.lastIndexOf('/') + 1)}`;
        const { through, pending } = yield* knownOf(runId, record);
        if (through < record.version) {
          return 'held';
        }
        if (!pending.some((armedBy) => armedBy <= record.version)) {
          return 'passed';
        }
        known.set(runId, { through, pending: pending.filter((armedBy) => armedBy > record.version) });
        yield* passedListeners(database, record.stream, record.version);
        return 'listened';
      }),
  };
}
