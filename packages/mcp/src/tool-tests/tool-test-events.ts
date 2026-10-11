import { ActedContextSchema, factOf, type Decided } from '@beonauto/operations';
import { Schema } from 'effect';

import { CallAnsweredSchema, CallFailedSchema, CallSentSchema } from '../calls/call-facts.ts';

export const toolTestsKind = 'tool-tests';

const ofTheTest = { test_id: Schema.String };

export const ToolTestEventSchema = Schema.Union([
  factOf('tool_test_started', Schema.Struct({ ...ofTheTest, ...CallSentSchema.fields }), ActedContextSchema),
  factOf('tool_test_answered', Schema.Struct({ ...ofTheTest, ...CallAnsweredSchema.fields }), ActedContextSchema),
  factOf('tool_test_failed', Schema.Struct({ ...ofTheTest, ...CallFailedSchema.fields }), ActedContextSchema),
]);

export type RecordedToolTest = typeof ToolTestEventSchema.Type;

export type ToolTestEvent = Decided<RecordedToolTest>;

type ToolTestStarted = Extract<ToolTestEvent, { readonly type: 'tool_test_started' }>;

export type ToolTestEnded = Exclude<ToolTestEvent, ToolTestStarted>;

export function toolTestStreamOf(testId: string): string {
  return `${toolTestsKind}/${testId}`;
}
