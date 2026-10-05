import type { CallerIdentity, Conflict, InvalidInput, Noun, Unavailable } from '@beonauto/operations';
import { Effect, type Schema } from 'effect';

export interface SpecSummary {
  readonly description?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
  readonly warnings?: readonly string[];
}

export interface ExecutionContext {
  readonly id: string;
  readonly org: string;
  readonly brain: string;
  readonly caller: CallerIdentity;
  readonly spec: { readonly name: string; readonly version: number };
}

export interface Finished {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
}

export interface FinishesLater {
  readonly finishesLater: true;
  readonly record: Schema.JsonObject;
}

export type Executed = Finished | FinishesLater;

export type PrimitiveRejection = InvalidInput | Unavailable | Conflict;

type WhenCancelled = 'stop' | 'finish';

const defaultLongestExecutionMs = 600_000;

export interface PrimitiveDefinition<Parsed> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly noun: Noun;
  readonly describeOutput: (output: Schema.Json) => string;
  readonly mediaType: string;
  readonly parse: (source: string) => Effect.Effect<Parsed, InvalidInput>;
  readonly summarize: (parsed: NoInfer<Parsed>) => SpecSummary;
  readonly execute: (
    parsed: NoInfer<Parsed>,
    input: Schema.Json,
    execution: ExecutionContext,
  ) => Effect.Effect<Executed, PrimitiveRejection>;
  readonly whenCancelled?: WhenCancelled;
  readonly longestExecutionMs?: number;
  readonly reachesOutside?: boolean;
}

export interface PreparedSpec {
  readonly summary: SpecSummary;
  readonly execute: (input: Schema.Json, execution: ExecutionContext) => Effect.Effect<Executed, PrimitiveRejection>;
  readonly whenCancelled: WhenCancelled;
}

export interface Primitive {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly noun: Noun;
  readonly describeOutput: (output: Schema.Json) => string;
  readonly mediaType: string;
  readonly longestExecutionMs: number;
  readonly reachesOutside: boolean;
  readonly prepare: (source: string) => Effect.Effect<PreparedSpec, InvalidInput>;
}

const primitiveName = /^[a-z][a-z0-9-]{2,31}$/u;

export function isPrimitiveName(name: string): boolean {
  return primitiveName.test(name);
}

export function definePrimitive<Parsed>(definition: PrimitiveDefinition<Parsed>): Primitive {
  const { name, title, description, noun, describeOutput, mediaType, parse, summarize, execute } = definition;
  const { whenCancelled = 'stop', longestExecutionMs = defaultLongestExecutionMs, reachesOutside = false } = definition;
  if (!isPrimitiveName(name)) {
    throw new Error(`The primitive name ${name} is malformed`);
  }
  return {
    name,
    title,
    description,
    noun,
    describeOutput,
    mediaType,
    longestExecutionMs,
    reachesOutside,
    prepare: (source) =>
      parse(source).pipe(
        Effect.map((parsed) => ({
          summary: summarize(parsed),
          execute: (input, execution) => execute(parsed, input, execution),
          whenCancelled,
        })),
      ),
  };
}
