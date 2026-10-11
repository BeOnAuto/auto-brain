import { Effect, type Schema } from 'effect';

import { isStreamedContent, type StreamedContent } from '../content/streamed-content.ts';
import { streamedSucceeded, succeeded, type Succeeded } from '../outcome/outcome.ts';
import type { BodyArguments, HttpBody, StreamedBody, StreamedBodyKind } from './definition.ts';

type BodyArgumentsOf = {
  readonly [Kind in keyof BodyArguments]: (
    name: string,
    given: StreamedContent | undefined,
  ) => Effect.Effect<BodyArguments[Kind]>;
};

export const mediaTypeOfBody: Readonly<Record<StreamedBodyKind, string>> = {
  'octet-stream': 'application/octet-stream',
  csv: 'text/csv',
};

export function isStreamedBody(body: HttpBody): body is StreamedBody {
  return body.kind === 'octet-stream' || body.kind === 'csv';
}

export function requireMostBytes(name: string, body: HttpBody): void {
  if (isStreamedBody(body) && !(Number.isSafeInteger(body.mostBytes) && body.mostBytes > 0)) {
    throw new Error(`The most bytes of the body of ${name} must be a whole number above 0`);
  }
}

function noBody(): Effect.Effect<readonly []> {
  return Effect.succeed([]);
}

function streamedBody(name: string, given: StreamedContent | undefined): Effect.Effect<readonly [StreamedContent]> {
  return given === undefined
    ? Effect.die(new Error(`The operation ${name} takes its body as a stream and was given none`))
    : Effect.succeed([given]);
}

export const bodyArgumentsOf: BodyArgumentsOf = {
  json: noBody,
  none: noBody,
  'octet-stream': streamedBody,
  csv: streamedBody,
};

export function answeredWith<Output>(
  encodeOutput: (output: Output) => Effect.Effect<Schema.JsonObject>,
): (answer: Output | StreamedContent) => Effect.Effect<Succeeded> {
  return (answer) =>
    isStreamedContent(answer) ? Effect.succeed(streamedSucceeded(answer)) : Effect.map(encodeOutput(answer), succeeded);
}
