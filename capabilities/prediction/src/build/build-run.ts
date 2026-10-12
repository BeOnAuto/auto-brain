import { workRecorder, type CapabilityAnswer, type CapabilityRejection, type RunContext } from '@on.auto/definitions';
import { Clock, Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { buildRunFacts } from '../facts/prediction-facts.ts';
import { keptBrief } from './build-brief.ts';
import { assembledOf, buildFilesOf } from './build-files.ts';
import { buildRefusal } from './build-refusals.ts';
import { buildRecordOf } from './build-request.ts';

export function buildRun(
  ports: PredictionPorts,
  document: PredictionFunctionDefinitionDocument,
  context: RunContext,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const { org, playbook: playbookId, id, definition } = context;
  const playbook = { org, playbook: playbookId };
  const record = workRecorder(ports.ledger, buildRunFacts);
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const refusal = yield* buildRefusal(ports, {
      playbook,
      name: definition.name,
      now,
      inbox: document.source.through === undefined,
    });
    if (refusal !== undefined) {
      return yield* Effect.fail(refusal);
    }
    const files = yield* buildFilesOf(ports, playbook, document, now);
    const assembled = assembledOf(files);
    yield* record(
      { org, playbook: playbookId, id },
      { type: 'work', fact: { type: 'dataset_assembled', data: assembled } },
      { causationId: context.lineage.startId, correlationId: context.lineage.correlationId },
    );
    const brief = yield* keptBrief(ports.ledger.content, playbook, document, { name: definition.name, files });
    return {
      finishesLater: true,
      record: buildRecordOf({
        run: { org, playbook: playbookId, id },
        name: definition.name,
        document,
        assembled,
        brief,
        requestedAt: now,
      }),
    };
  });
}
