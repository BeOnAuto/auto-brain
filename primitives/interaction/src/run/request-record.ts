import { Option, Schema } from 'effect';

const RequestRecordSchema = Schema.Struct({
  channel: Schema.String,
  to: Schema.String,
  message: Schema.String,
  answer_schema: Schema.optionalKey(Schema.JsonObject),
  expires_at: Schema.String,
});

export type RequestRecord = typeof RequestRecordSchema.Type;

const decodeRecord = Schema.decodeUnknownOption(RequestRecordSchema);

export function requestRecordOf(record: unknown): RequestRecord | undefined {
  return Option.getOrUndefined(decodeRecord(record));
}

export function takesAnswer({ answer_schema: schema }: RequestRecord): boolean {
  return schema !== undefined;
}
