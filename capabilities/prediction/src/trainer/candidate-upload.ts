import { RunIdInputField, workRecorder, type WorkRule } from '@on.auto/definitions';
import { Conflict, defineHttpOperation, InvalidInput, Unavailable, type StreamedContent } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { correlationOf, type BuildState } from '../builds/build-state.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { buildRunFacts } from '../facts/prediction-facts.ts';
import { checkedCandidate, type Checked } from './candidate-checks.ts';
import { staged } from './candidate-staging.ts';
import { waitingBuildOf } from './waiting-builds.ts';

const UploadedSchema = Schema.Struct({
  candidate: Schema.String.annotate({ description: 'The SHA-256 of the candidate, which the answer names' }),
  bytes: Schema.Int,
  opset: Schema.Int,
});

const busy = new Unavailable({ detail: 'Every model process is busy; try again shortly', kind: 'model_process_busy' });

const alreadyUploaded = new Conflict({ detail: 'The candidate was uploaded to the build meanwhile' });

const fullBuild = new Conflict({
  detail: `The build took its ${predictionBounds.candidatesInABuild} candidates meanwhile`,
});

const recordsAgainAtMost = 3;

function changedMeanwhile(error: unknown): boolean {
  return error instanceof Conflict && error.kind === 'concurrent_change';
}

function wasAlreadyUploaded(error: unknown): boolean {
  return error === alreadyUploaded;
}

function uploadRule(sha256: string): WorkRule {
  return ({ work }) => {
    const uploads = work.filter(({ type }) => type === 'candidate_uploaded');
    if (uploads.some(({ data }) => data['sha256'] === sha256)) {
      return alreadyUploaded;
    }
    return uploads.length >= predictionBounds.candidatesInABuild ? fullBuild : undefined;
  };
}

function recorded(
  ports: PredictionPorts,
  build: BuildState,
  fact: { readonly type: string; readonly data: Schema.JsonObject },
  rule?: WorkRule,
) {
  const record = workRecorder(ports.ledger, buildRunFacts);
  return Effect.flatMap(correlationOf(ports.ledger, build.address), (correlationId) =>
    record(build.address, { type: 'work', fact }, { causationId: null, correlationId }, rule).pipe(
      Effect.retry({ times: recordsAgainAtMost, while: changedMeanwhile }),
    ),
  );
}

function refused(ports: PredictionPorts, build: BuildState, checked: Extract<Checked, { readonly refused: unknown }>) {
  const { sha256, bytes, because, detail } = checked.refused;
  return Effect.andThen(
    recorded(ports, build, { type: 'candidate_refused', data: { sha256, bytes, because, detail } }),
    Effect.fail(new InvalidInput({ detail, issues: [{ pointer: '', detail: `${because}: ${detail}` }] })),
  );
}

export function uploadCandidate(ports: PredictionPorts) {
  return defineHttpOperation('playbook', 'command', {
    name: 'upload_candidate',
    title: 'Upload candidate',
    description: [
      'Uploads a candidate model to a build of a prediction function that waits for its trainer: an ONNX file in the signature the guide prediction-function gives, at most 64 MiB, with its Content-Length.',
      'The file is checked in a model process, and refused when the runtime does not load it, when its signature is not the one the function feeds, or when the build has its 8 candidates.',
      'The answer is the SHA-256 the answer to the build names; the same bytes again answer the same.',
    ].join(' '),
    route: { method: 'POST', path: '/runs/{run_id}/build/candidates' },
    body: { kind: 'octet-stream', mostBytes: predictionBounds.mostCandidateBytes },
    inputSchema: Schema.Struct({ run_id: RunIdInputField }),
    answer: { kind: 'json', outputSchema: UploadedSchema },
    reasons: ['invalid_input', 'not_found', 'conflict', 'unavailable'],
    handle: ({ run_id: id }, body: StreamedContent) =>
      Effect.gen(function* () {
        const { build } = yield* waitingBuildOf(id);
        const file = yield* ports.caches.models.received(body.stream);
        const checked = yield* checkedCandidate(ports, build, file);
        if ('busy' in checked) {
          return yield* Effect.fail(busy);
        }
        if ('refused' in checked) {
          return yield* refused(ports, build, checked);
        }
        const { uploaded } = checked;
        const taken = checked.already
          ? false
          : yield* recorded(
              ports,
              build,
              { type: 'candidate_uploaded', data: uploaded },
              uploadRule(uploaded.sha256),
            ).pipe(
              Effect.as(true),
              Effect.catchIf(wasAlreadyUploaded, () => Effect.succeed(false)),
            );
        if (taken) {
          yield* staged(ports, build, file.path, file.sha256);
        }
        return { candidate: uploaded.sha256, bytes: uploaded.bytes, opset: uploaded.opset };
      }),
  });
}
