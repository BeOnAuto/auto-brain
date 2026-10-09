import type { Schema } from 'effect';

import type { AnswerSchema } from '../schema/answer-schema.ts';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export type ContentPart = TextPart;

export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: readonly ContentPart[];
}

export interface TextOutput {
  readonly type: 'text';
}

export interface JsonOutput {
  readonly type: 'json';
  readonly schema: AnswerSchema;
  readonly name?: string;
  readonly description?: string;
}

export type OutputRequest = TextOutput | JsonOutput;

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface GenerationSettings {
  readonly max_output_tokens: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly seed?: number;
  readonly stop_sequences?: readonly string[];
  readonly reasoning?: ReasoningEffort;
}

export interface ProviderOptions {
  readonly [namespace: string]: Schema.JsonObject;
}

export type RetryOwner = 'adapter' | 'caller';

export interface ToolReply {
  readonly text: string;
  readonly isError: boolean;
}

export interface ToolCallRequest {
  readonly callId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolCallSignals {
  readonly signal: Readonly<AbortSignal>;
  readonly cancelled: Readonly<AbortSignal>;
}

export interface ModelTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.JsonObject;
  readonly call: (request: ToolCallRequest, signals: ToolCallSignals) => Promise<ToolReply>;
}

export interface ModelTools {
  readonly offered: readonly ModelTool[];
  readonly callsEnded: () => boolean;
  readonly ended: Readonly<AbortSignal>;
  readonly runBoundMs: number;
}

export interface ModelRequest {
  readonly model: string;
  readonly instructions?: string;
  readonly messages: readonly ModelMessage[];
  readonly output: OutputRequest;
  readonly settings: GenerationSettings;
  readonly provider_options?: ProviderOptions;
  readonly timeout_ms?: number;
  readonly signal?: Readonly<AbortSignal>;
  readonly retries?: RetryOwner;
  readonly run_id?: string;
  readonly tools?: ModelTools;
}
