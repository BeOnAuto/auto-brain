import { Buffer } from 'node:buffer';

import {
  BrainContext,
  BrainReader,
  BrainWriter,
  Caller,
  Conflict,
  NotFound,
  type InvalidInput,
  defineCommand,
} from '@beonauto/operations';
import {
  ExecutionIdField,
  RunSchema,
  brainBoundSettler,
  recordedRunInBrain,
  type RecordedRun,
  refusingBlankText,
  refusingForbiddenCharacters,
} from '@beonauto/specs';
import { Clock, Effect, Schema } from 'effect';

import type { ChannelSettings } from '../channels/channel-settings.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import { answerFor, answererOf } from './answering.ts';
import { correlationOfRun, openRequestRowIn } from './request-reads.ts';

const ClaimedForField = Schema.String.check(
  Schema.makeFilter((text: string) => Buffer.byteLength(text, 'utf8') <= interactionBounds.claimBytes, {
    expected: `at most ${interactionBounds.claimBytes} bytes`,
  }),
  refusingForbiddenCharacters,
  refusingBlankText,
).annotate({
  description: `Whom the caller says it answers for, kept with the answer as a claim and never checked, at most ${interactionBounds.claimBytes} bytes`,
});

const description = [
  'Answers the request of an interaction function, which a run of it is waiting for, and settles the run:',
  'the run succeeds with the answer as its output, which reaches the workflow step that waits for it.',
  '`execution_id` is the run of the request, as list_interactions shows it; `answer` must match the answer schema',
  'the request names; `claimed_for` is whom the caller says it answers for, kept as a claim.',
  'It answers the run. The same answer again answers the run as it stands.',
  'Rejected with invalid_input when the answer does not match the schema, which leaves the request open;',
  'with conflict when the request has ended with another result, expired or was cancelled, or takes no answer;',
  'with not_found when the brain has no such run; and with forbidden when an answer token does not answer this request.',
  'Over HTTP a system that received the request by webhook may answer with its answer token alone, as',
  '`Authorization: Request <token>`.',
].join(' ');

const answerSchemaOf = Schema.decodeUnknownSync(Schema.Struct({ answer_schema: Schema.JsonObject }));

const notARequest = new Conflict({
  detail: 'The run is not a request of an interaction function that waits for an answer',
});

const takesNoAnswer = new Conflict({ detail: 'The request is a notification, which takes no answer' });

interface Answering {
  readonly id: string;
  readonly answer: Schema.Json;
  readonly claimedFor: string | undefined;
}

function checkedFor(run: RecordedRun, answer: Schema.Json): Effect.Effect<Schema.Json, InvalidInput | Conflict> {
  if (!run.awaitsSettlement) {
    return Effect.succeed(answer);
  }
  return answerFor(answer, answerSchemaOf(run.run.record).answer_schema);
}

const answered = Effect.fnUntraced(function* ({ id, answer, claimedFor }: Answering, channels: ChannelSettings) {
  const brain = yield* BrainContext;
  const row = yield* openRequestRowIn(id);
  const answeredBy = yield* answererOf(yield* Caller, row, channels, brain);
  const run = yield* recordedRunInBrain(yield* BrainReader, id);
  if (run === undefined) {
    return yield* new NotFound({ detail: 'There is no such run in this brain' });
  }
  if (row === undefined) {
    return yield* notARequest;
  }
  if (!row.answers) {
    return yield* takesNoAnswer;
  }
  const output = yield* checkedFor(run, answer);
  const at = new Date(yield* Clock.currentTimeMillis).toISOString();
  const record = {
    answered_by: answeredBy,
    ...(claimedFor === undefined ? {} : { claimed_for: claimedFor }),
    answered_at: at,
  };
  return yield* brainBoundSettler(yield* BrainWriter)(
    { ...brain, id },
    { status: 'succeeded', output, record, by: answeredBy },
    { causationId: row.request_id, correlationId: yield* correlationOfRun(id) },
  ).pipe(Effect.catchTag('not_found', Effect.die));
});

export function defineAnswerInteraction(channels: ChannelSettings) {
  return defineCommand('brain', {
    name: 'answer_interaction',
    title: 'Answer a request',
    description,
    route: { method: 'POST', path: '/executions/{execution_id}/answer' },
    authorizesByToken: true,
    inputSchema: Schema.Struct({
      execution_id: ExecutionIdField,
      answer: Schema.Json.annotate({ description: 'The answer, a JSON value the answer schema of the request takes' }),
      claimed_for: Schema.optionalKey(ClaimedForField),
    }),
    outputSchema: RunSchema,
    reasons: ['invalid_input', 'not_found', 'conflict', 'forbidden'],
    handle: ({ execution_id: id, answer, claimed_for: claimedFor }) => answered({ id, answer, claimedFor }, channels),
    plainLanguage: {
      task: 'answer a request',
      attempt: () => 'answer the request',
      outcome: () => 'The request is answered: the run that asked it succeeded, with the answer as its output.',
    },
  });
}
