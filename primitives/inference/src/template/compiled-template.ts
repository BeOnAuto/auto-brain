import type { Result, Schema } from 'effect';

export interface TemplateIssue {
  readonly line: number;
  readonly detail: string;
}

export type VariableSegment = string | number | null;

export interface VariableReference {
  readonly path: readonly VariableSegment[];
  readonly line: number;
}

export interface TemplateScope {
  readonly input: Schema.Json;
  readonly today: string;
  readonly now: string;
}

export interface RenderedPrompt {
  readonly instructions?: string;
  readonly message: string;
}

export type PromptPart = 'instructions' | 'message';

export type RenderFailure =
  | { readonly reason: 'missing_variable'; readonly variable: string; readonly line: number }
  | { readonly reason: 'too_long'; readonly part: PromptPart; readonly line: number }
  | { readonly reason: 'limit_exceeded'; readonly limit: 'memory' | 'time'; readonly line: number }
  | { readonly reason: 'failed'; readonly detail: string; readonly line: number };

export interface CompiledTemplate {
  readonly hasInstructions: boolean;
  readonly hasMessage: boolean;
  readonly variables: readonly VariableReference[];
  readonly render: (scope: TemplateScope) => Result.Result<RenderedPrompt, RenderFailure>;
}
