import { Option, Schema } from 'effect';

import { foldPage, type FoldHost, type FoldPage, type FoldedPage } from '../folds/fold-page.ts';
import type { FoldAnswerSchema } from './fold-messages.ts';

type FoldAnswerData = typeof FoldAnswerSchema.Encoded;

const FoldPageDataSchema = Schema.Struct({
  events: Schema.fromJsonString(Schema.Array(Schema.Record(Schema.String, Schema.Json))),
  views: Schema.Array(
    Schema.Struct({
      fold: Schema.String,
      filters: Schema.Array(Schema.Record(Schema.String, Schema.Json)),
      view: Schema.fromJsonString(Schema.Json),
      schema: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
      events: Schema.Array(Schema.Number),
    }),
  ),
  dialect: Schema.Struct({
    refused: Schema.Array(Schema.Struct({ name: Schema.String, why: Schema.String })),
    variables: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  variable: Schema.String,
  limits: Schema.Struct({
    mostWork: Schema.Number,
    mostSteps: Schema.Number,
    mostDepth: Schema.Number,
    mostOutputs: Schema.Number,
    mostValueDepth: Schema.Number,
  }),
  foldDeadlineMs: Schema.Number,
  pageBudgetMs: Schema.Number,
  mostViewBytes: Schema.Number,
});

export type FoldPageData = typeof FoldPageDataSchema.Encoded;

const decodePage = Schema.decodeUnknownOption(FoldPageDataSchema);

const encodedPageOf = Schema.encodeSync(FoldPageDataSchema);

const unreadable: FoldAnswerData = { ran: 'unreadable' };

export function foldPageData(page: FoldPage): FoldPageData {
  return encodedPageOf(page);
}

function answerFrom({ through, early, views }: FoldedPage): FoldAnswerData {
  return {
    ran: 'folded',
    through,
    early,
    views: views.map(({ view, ...rest }) => ({ ...rest, view: JSON.stringify(view) })),
  };
}

export function foldAnswerOf(data: unknown, host: FoldHost): FoldAnswerData {
  return Option.match(decodePage(data), {
    onNone: () => unreadable,
    onSome: (page) => answerFrom(foldPage(page, host)),
  });
}
