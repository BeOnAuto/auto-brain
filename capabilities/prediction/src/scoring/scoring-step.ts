import { Effect } from 'effect';

import { aMinute, recordedWork, restingUntil, type Performing } from '../build-work/build-performing.ts';
import { untilTheRunEnds } from '../build-work/run-watch.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { Assembled, BuildWorkOf } from '../facts/build-facts.ts';
import type { ModelOutcome, WalkAnswer } from '../model-processes/model-processes.ts';
import { baselineWalks, verdictOf, type Scoring } from './candidate-scoring.ts';
import { remainingOfTheOrigins } from './scoring-grid.ts';
import { featureNamesOf, givenIndexesOf, scoringOf, type ScoredBuild } from './scoring-inputs.ts';

type Disqualified = BuildWorkOf<'candidate_disqualified'>['data'];

type Interrupted = Exclude<ModelOutcome<WalkAnswer>, { readonly ended: 'answered' }>;

const cancelled: ModelOutcome<WalkAnswer> = { ended: 'cancelled', milliseconds: 0 };

function disqualifiedOf(sha256: string, outcome: Interrupted): Disqualified | undefined {
  if (outcome.ended === 'timed_out' || outcome.ended === 'out_of_memory') {
    return { sha256, because: outcome.ended };
  }
  if (outcome.ended === 'crashed') {
    return { sha256, because: 'crashed', detail: outcome.detail };
  }
  return outcome.ended === 'badly' ? { sha256, because: 'answered_badly', detail: outcome.detail } : undefined;
}

function answeredFact(scoring: Scoring, sha256: string, answer: WalkAnswer, milliseconds: number) {
  const verdict = verdictOf(scoring, baselineWalks(scoring), answer);
  return verdict.verdict === 'scored'
    ? {
        type: 'candidate_scored',
        data: {
          sha256,
          scores: verdict.scores,
          coverage: verdict.coverage,
          against: verdict.against,
          duration_ms: Math.round(milliseconds),
        },
      }
    : { type: 'candidate_disqualified', data: { sha256, because: verdict.because, detail: verdict.detail } };
}

function walked(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
  assembled: Assembled,
  { sha256, path }: { readonly sha256: string; readonly path: string },
) {
  const { ports, build, now } = performing;
  return Effect.gen(function* () {
    const { path: rows, scoring } = yield* scoringOf(ports, build, document, assembled);
    const walk = ports.models.walk(
      { sha256, path },
      {
        rows,
        window: assembled.window,
        holdout: assembled.holdout,
        steps: scoring.grid.steps,
        features: featureNamesOf(document).length,
        given: givenIndexesOf(document),
        remaining: remainingOfTheOrigins(scoring.grid),
      },
    );
    const outcome = yield* Effect.raceFirst(walk, Effect.as(untilTheRunEnds(ports, build.address), cancelled));
    if (outcome.ended === 'answered') {
      return yield* recordedWork(performing, answeredFact(scoring, sha256, outcome.answer, outcome.milliseconds));
    }
    const disqualified = disqualifiedOf(sha256, outcome);
    return disqualified === undefined
      ? yield* restingUntil(performing, now + aMinute)
      : yield* recordedWork(performing, { type: 'candidate_disqualified', data: disqualified });
  });
}

export function scoredCandidate(
  performing: Performing,
  { document, assembled }: ScoredBuild,
  sha256: string,
): Effect.Effect<void> {
  const { ports, build, now } = performing;
  const release = ports.permits.take();
  if (release === null) {
    return restingUntil(performing, now + aMinute);
  }
  const { org, playbook, id } = build.address;
  const notLoaded = (detail: string) =>
    recordedWork(performing, { type: 'candidate_disqualified', data: { sha256, because: 'not_loaded', detail } });
  return Effect.gen(function* () {
    const path = yield* ports.caches.models.pathOf(sha256, () =>
      ports.ledger.content.staged({ org, playbook }, id, sha256),
    );
    return path === undefined
      ? yield* notLoaded(`Candidate ${sha256.slice(0, 12)}… is no longer staged under its build`)
      : yield* walked(performing, document, assembled, { sha256, path });
  }).pipe(Effect.ensuring(Effect.sync(release)));
}
