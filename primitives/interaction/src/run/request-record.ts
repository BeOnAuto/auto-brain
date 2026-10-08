import { Option, Schema } from 'effect';

import { RepliesSchema, ToolDeliverySchema } from '../route/route-schemas.ts';

const RequestRecordSchema = Schema.Struct({
  to: Schema.String,
  message: Schema.String,
  answer_schema: Schema.optionalKey(Schema.JsonObject),
  expires_at: Schema.String,
  requested_at: Schema.String,
  deliver: Schema.optionalKey(ToolDeliverySchema),
  replies: Schema.optionalKey(RepliesSchema),
});

export type RequestRecord = typeof RequestRecordSchema.Type;

const DeliveringRecordSchema = Schema.Struct({ ...RequestRecordSchema.fields, deliver: ToolDeliverySchema });

export type DeliveringRecord = typeof DeliveringRecordSchema.Type;

export const deliveringRecordOf: (record: unknown) => DeliveringRecord =
  Schema.decodeUnknownSync(DeliveringRecordSchema);

const decodeRecord = Schema.decodeUnknownOption(RequestRecordSchema);

export function requestRecordOf(record: unknown): RequestRecord | undefined {
  return Option.getOrUndefined(decodeRecord(record));
}

export function takesAnswer({ answer_schema: schema }: Pick<RequestRecord, 'answer_schema'>): boolean {
  return schema !== undefined;
}
