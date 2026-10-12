import { recordedRunIn, runCanceller } from '@on.auto/definitions';
import { Effect } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { lifecycleStep } from '../shadow/model-lifecycle.ts';
import { advanced, restingUntil, type Performing } from './build-performing.ts';

function childCancelled(performing: Performing, child: string): Effect.Effect<void> {
  const { ports, build, lineage } = performing;
  const address = { ...build.address, id: child };
  return Effect.flatMap(recordedRunIn(ports.ledger, address), (run) =>
    run?.run.status === 'started'
      ? runCanceller(ports.ledger)(
          address,
          { kind: 'parent_ended', reason: 'The build that asked for it has ended' },
          lineage,
        ).pipe(Effect.orDie, Effect.andThen(restingUntil(performing, null)))
      : Effect.void,
  );
}

export function afterTheRun(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
): Effect.Effect<void> {
  const { ports, row, build, now } = performing;
  const { org, playbook, id } = build.address;
  if (row.staged) {
    return Effect.andThen(
      ports.ledger.content.unstage({ org, playbook }, id),
      advanced(performing, build.address, { staged: false, next_due_at: now }),
    );
  }
  const lifecycle =
    build.run.run.status === 'succeeded' && row.version !== null && row.open
      ? lifecycleStep(performing, document)
      : restingUntil(performing, null);
  return row.through === null || row.open
    ? lifecycle
    : Effect.andThen(childCancelled(performing, row.through), lifecycle);
}
