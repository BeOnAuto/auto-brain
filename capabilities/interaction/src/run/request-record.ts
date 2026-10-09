import { Option, Schema } from 'effect';

import { ReplyRuleSchema } from '../replies/reply-rule.ts';
import { RepliesSchema, DeliverBlockSchema } from '../tool-blocks/tool-block-schemas.ts';

const RequestRecordSchema = Schema.Struct({
  to: Schema.String,
  message: Schema.String,
  answer_schema: Schema.optionalKey(Schema.JsonObject),
  answerer: Schema.optionalKey(Schema.String),
  reply: Schema.optionalKey(ReplyRuleSchema),
  expires_at: Schema.String,
  requested_at: Schema.String,
  deliver: Schema.optionalKey(DeliverBlockSchema),
  replies: Schema.optionalKey(RepliesSchema),
});

export type RequestRecord = typeof RequestRecordSchema.Type;

const DeliveringRecordSchema = Schema.Struct({ ...RequestRecordSchema.fields, deliver: DeliverBlockSchema });

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

const DeliveredRecordSchema = Schema.Struct({ delivered_at: Schema.String });

export type DeliveredRecord = typeof DeliveredRecordSchema.Type;

const isDeliveredRecord = Schema.is(DeliveredRecordSchema);

export function isNotification(record: unknown): boolean {
  const request = requestRecordOf(record);
  return request === undefined ? isDeliveredRecord(record) : !takesAnswer(request);
}
