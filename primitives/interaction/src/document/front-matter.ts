import type { FrontMatterSection, FrontMatterShape } from '@beonauto/specs/document';
import { Schema } from 'effect';

import { WrittenRuleSchema } from '../replies/reply-rule.ts';
import {
  EachSchema,
  ReadSchema,
  RepliesSchema,
  SentSchema,
  TellSchema,
  ToolDeliverySchema,
} from '../route/route-schemas.ts';

const descriptionLength = 1000;

const SectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(descriptionLength))),
  to: Schema.String,
  from: Schema.optionalKey(Schema.String),
  expires: Schema.String,
  deliver: Schema.optionalKey(ToolDeliverySchema),
  replies: Schema.optionalKey(RepliesSchema),
  input: Schema.optionalKey(SectionSchema),
  output: Schema.optionalKey(SectionSchema),
  reply: Schema.optionalKey(WrittenRuleSchema),
});

export type InteractionFrontMatter = typeof FrontMatterSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(SectionSchema.fields) },
  { name: 'output', keys: Object.keys(SectionSchema.fields) },
  { name: 'deliver', keys: Object.keys(ToolDeliverySchema.fields) },
  { name: 'deliver.sent', keys: Object.keys(SentSchema.fields) },
  { name: 'replies', keys: Object.keys(RepliesSchema.fields) },
  { name: 'replies.read', keys: Object.keys(ReadSchema.fields) },
  { name: 'replies.read.each', keys: Object.keys(EachSchema.fields) },
  { name: 'replies.tell', keys: Object.keys(TellSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const interactionFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'the party it goes to and when it expires',
};
