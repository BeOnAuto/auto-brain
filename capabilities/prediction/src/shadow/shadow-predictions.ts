import { textToKeep } from '@on.auto/operations';
import { Effect } from 'effect';

import { aMinute, restingUntil, type Performing } from '../builds/build-performing.ts';
import { executed } from '../models/model-commands.ts';
import { predictionsText } from './shadow-records.ts';
import { shadowRowsOf, type ShadowRows } from './shadow-rows.ts';
import { shadowWalk, type Predicting } from './shadow-walk.ts';

function predictedOn(performing: Performing, predicting: Predicting, rows: ShadowRows): Effect.Effect<void> {
  const { ports, build, now } = performing;
  const { org, playbook, id } = build.address;
  const { document, challenger, of, origin } = predicting;
  return Effect.gen(function* () {
    const outcome = yield* shadowWalk(ports, { org, playbook }, predicting, rows);
    if (outcome.ended === 'busy' || outcome.ended === 'closing' || outcome.ended === 'cancelled') {
      return yield* restingUntil(performing, now + aMinute);
    }
    const answer = outcome.ended === 'answered' ? outcome.answer : undefined;
    const text = yield* predictionsText(document, origin, rows, answer);
    const predictions = yield* Effect.orDie(
      ports.ledger.content.put({ org, playbook }, textToKeep(text, 'application/json')),
    );
    return yield* executed(performing, (asked) => ({
      ...asked,
      type: 'predict',
      definitionVersion: challenger.definitionVersion,
      data: {
        version: challenger.version,
        of: of.version,
        build: id,
        origin: origin.form,
        count: answer === undefined ? 0 : answer.series.length,
        predictions_sha256: predictions.sha256,
        predictions_bytes: predictions.bytes,
      },
    }));
  });
}

export function predicted(performing: Performing, predicting: Predicting): Effect.Effect<void> {
  const { ports, build, now } = performing;
  const release = ports.permits.take();
  if (release === null) {
    return restingUntil(performing, now + aMinute);
  }
  const { org, playbook } = build.address;
  return shadowRowsOf(ports, { org, playbook }, predicting.document, predicting.origin.closesAt).pipe(
    Effect.matchEffect({
      onFailure: () => restingUntil(performing, now + aMinute),
      onSuccess: (rows) => predictedOn(performing, predicting, rows),
    }),
    Effect.ensuring(Effect.sync(release)),
  );
}
