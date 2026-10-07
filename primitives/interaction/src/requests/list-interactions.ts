import {
  BrainReader,
  InvalidInput,
  PagingInputFields,
  PagingOutputFields,
  counted,
  cursorOfParts,
  defaultPageLimit,
  defineQuery,
  partsOfCursor,
  type ProjectedCondition,
  type ProjectedRunRow,
  type ProjectedValue,
} from '@beonauto/operations';
import { Effect, Option, Schema } from 'effect';

import { openRequestsName } from './open-requests.ts';
import { StandingSchema, requestRowFrom } from './request-rows.ts';

const InteractionSchema = Schema.Struct({
  execution_id: Schema.String.annotate({ description: 'The run of the request, to answer with answer_interaction' }),
  function: Schema.String.annotate({ description: 'The interaction function that asked' }),
  version: Schema.Int.annotate({ description: 'The version of the function that asked' }),
  to: Schema.String.annotate({ description: 'The party the request goes to' }),
  channel: Schema.String.annotate({ description: 'The channel the request goes through, or inbox' }),
  message: Schema.String.annotate({ description: 'The message of the request' }),
  takes_answer: Schema.Boolean.annotate({ description: 'true for a question, false for a notification' }),
  requested_at: Schema.String.annotate({ description: 'When the request was made, in ISO 8601 UTC' }),
  expires_at: Schema.String.annotate({ description: 'When the request expires unanswered, in ISO 8601 UTC' }),
  attempts: Schema.Int.annotate({ description: 'The delivery attempts made so far' }),
  standing: StandingSchema.annotate({
    description:
      'How its delivery stands: in_inbox, to_deliver, delivering, delivered, retrying, or undelivered once every attempt failed',
  }),
}).annotate({ identifier: 'Interaction', description: 'An open request of an interaction function' });

const requestNoun = { one: 'request', other: 'requests' };

const FilterText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

const description = [
  'Lists the open requests of the brain, newest first: what each interaction function asked, of whom,',
  'through which channel, until when, and how its delivery stands, with the `execution_id` to answer with',
  'answer_interaction. `to` keeps the requests to one party and `function` those of one interaction function.',
  `\`limit\` is 1 to 100, ${defaultPageLimit} when left out; \`next_cursor\` reads the next page.`,
  'Every reader of the brain sees each party, as a run’s input is seen.',
].join(' ');

const CursorSchema = Schema.Tuple([Schema.Int, Schema.String]);

const isCursor = Schema.is(CursorSchema);

const badCursor = new InvalidInput({
  detail: 'The cursor is not one list_interactions gave',
  issues: [{ pointer: '/cursor', detail: 'Expected the next_cursor of a page of list_interactions' }],
});

function afterOf(cursor: string | undefined): Effect.Effect<readonly ProjectedValue[] | undefined, InvalidInput> {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const parts = Option.getOrUndefined(partsOfCursor(cursor));
  return isCursor(parts) ? Effect.succeed(parts) : Effect.fail(badCursor);
}

function shownOf({ runId, row }: ProjectedRunRow) {
  const kept = requestRowFrom(row);
  return [
    {
      execution_id: runId,
      function: kept.function,
      version: kept.version,
      to: kept.party,
      channel: kept.channel,
      message: kept.message,
      takes_answer: kept.answers,
      requested_at: new Date(kept.requested_at).toISOString(),
      expires_at: new Date(kept.expires_at).toISOString(),
      attempts: kept.attempts,
      standing: kept.standing,
    },
  ];
}

interface Listing {
  readonly to?: string | undefined;
  readonly function?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

const listed = Effect.fnUntraced(function* ({ to, function: name, limit = defaultPageLimit, cursor }: Listing) {
  const after = yield* afterOf(cursor);
  const where: ProjectedCondition[] = [{ column: 'open', equals: true }];
  if (to !== undefined) {
    where.push({ column: 'party', equals: to });
  }
  if (name !== undefined) {
    where.push({ column: 'function', equals: name });
  }
  const rows = yield* (yield* BrainReader).readProjectedRows(openRequestsName, {
    where,
    orderBy: ['requested_at'],
    order: 'desc',
    ...(after === undefined ? {} : { after }),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return {
    interactions: page.flatMap((kept) => shownOf(kept)),
    has_more: hasMore,
    next_cursor: hasMore ? cursorOfParts([Number(last.row['requested_at']), last.runId]) : null,
  };
});

export const listInteractions = defineQuery('brain', {
  name: 'list_interactions',
  title: 'List open requests',
  description,
  route: { method: 'GET', path: '/interactions' },
  inputSchema: Schema.Struct({
    to: Schema.optionalKey(FilterText.annotate({ description: 'Only the requests to this party' })),
    function: Schema.optionalKey(
      FilterText.annotate({ description: 'Only the requests of this interaction function' }),
    ),
    limit: PagingInputFields.limit,
    cursor: PagingInputFields.cursor,
  }),
  outputSchema: Schema.Struct({ interactions: Schema.Array(InteractionSchema), ...PagingOutputFields }),
  reasons: ['invalid_input'],
  handle: listed,
  plainLanguage: {
    task: 'list the open requests',
    attempt: () => 'list the open requests',
    outcome: ({ interactions }) =>
      interactions.length === 0
        ? 'No request is waiting.'
        : `Found ${counted(interactions.length, requestNoun)} waiting on this page.`,
  },
});
