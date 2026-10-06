import { Option, Schema } from 'effect';

export const ViewFilterSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Json),
]);

export type ViewFilter = typeof ViewFilterSchema.Type;

export const ViewDetailsSchema = Schema.Struct({
  language: Schema.Literal('jq'),
  fold: Schema.String,
  foldLine: Schema.Int,
  answer: Schema.optionalKey(Schema.String),
  filters: Schema.Array(ViewFilterSchema),
  initial: Schema.Json,
  schema: Schema.optionalKey(Schema.JsonObject),
});

export type ViewDetails = typeof ViewDetailsSchema.Type;

const decodeDetails = Schema.decodeUnknownOption(ViewDetailsSchema);

export function viewDetailsOf(details: unknown): ViewDetails | undefined {
  return Option.getOrUndefined(decodeDetails(details));
}

export function lineInFold({ fold, foldLine }: ViewDetails, offset: number): number {
  return foldLine + fold.slice(0, offset).split('\n').length - 1;
}
