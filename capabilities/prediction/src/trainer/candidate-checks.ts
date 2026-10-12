import { Effect } from 'effect';

import { documentOfBuild } from '../builds/build-document.ts';
import type { BuildState } from '../builds/build-state.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { BuildWorkOf } from '../facts/build-facts.ts';
import type { CachedFile } from '../process/model-files.ts';
import type { ModelOutcome, Signature } from '../process/model-processes.ts';
import { signatureIssue } from './signature-check.ts';

type Uploaded = BuildWorkOf<'candidate_uploaded'>['data'];

type Refusal = Omit<BuildWorkOf<'candidate_refused'>['data'], 'sha256' | 'bytes'>;

export type Checked =
  | { readonly uploaded: Uploaded; readonly already: boolean }
  | { readonly refused: BuildWorkOf<'candidate_refused'>['data'] }
  | { readonly busy: true };

const { candidatesInABuild } = predictionBounds;

const loadingWords: Readonly<Record<'timed_out' | 'out_of_memory', string>> = {
  timed_out: 'The file could not be loaded within the 30 s a check takes',
  out_of_memory: 'The file needed more memory to load than a model process has',
};

function refusalOf(outcome: Exclude<ModelOutcome<Signature>, { readonly ended: 'answered' }>): Refusal | undefined {
  if (outcome.ended === 'timed_out' || outcome.ended === 'out_of_memory') {
    return { because: 'failed_to_load', detail: loadingWords[outcome.ended] };
  }
  return outcome.ended === 'crashed' || outcome.ended === 'badly'
    ? { because: 'failed_to_load', detail: `The model process ended while it loaded the file: ${outcome.detail}` }
    : undefined;
}

function answeredOf(
  ports: PredictionPorts,
  build: BuildState,
  file: CachedFile,
  signature: Signature,
): Effect.Effect<Checked> {
  const { sha256, bytes } = file;
  if (!signature.loaded) {
    const detail = `The file is not a model the runtime loads: ${signature.detail}`;
    return Effect.succeed({ refused: { sha256, bytes, because: 'failed_to_load', detail } });
  }
  return Effect.map(documentOfBuild(ports.ledger, build), (document): Checked => {
    const issue = signatureIssue(document, signature);
    const { inputs, outputs, opset } = signature;
    return issue === undefined
      ? { uploaded: { sha256, bytes, opset, inputs, outputs }, already: false }
      : { refused: { sha256, bytes, because: 'wrong_signature', detail: issue } };
  });
}

export function checkedCandidate(ports: PredictionPorts, build: BuildState, file: CachedFile): Effect.Effect<Checked> {
  const { sha256, bytes } = file;
  const already = build.uploads.find((uploaded) => uploaded.sha256 === sha256);
  if (already !== undefined) {
    return Effect.succeed({ uploaded: already, already: true });
  }
  if (build.uploads.length >= candidatesInABuild) {
    const detail = `The build has its ${candidatesInABuild} candidates`;
    return Effect.succeed({ refused: { sha256, bytes, because: 'too_many', detail } });
  }
  return Effect.flatMap(ports.models.check({ sha256, path: file.path }), (outcome): Effect.Effect<Checked> => {
    if (outcome.ended === 'answered') {
      return answeredOf(ports, build, file, outcome.answer);
    }
    const refusal = refusalOf(outcome);
    return Effect.succeed(refusal === undefined ? { busy: true } : { refused: { sha256, bytes, ...refusal } });
  });
}
