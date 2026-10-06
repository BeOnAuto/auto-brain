import type { CallerIdentity, Conflict, InvalidInput, Noun, Unavailable } from '@beonauto/operations';
import { Effect, type Schema } from 'effect';

import type { ToolCallFact } from '../execution/execution-commands.ts';

export interface DefinitionSummary {
  readonly description?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
  readonly warnings?: readonly string[];
  readonly details?: Schema.JsonObject;
}

export interface StandingRequest {
  readonly org: string;
  readonly brain: string;
  readonly name: string;
  readonly version: number;
  readonly status: 'active' | 'retired';
}

export type Standing = (request: StandingRequest) => Effect.Effect<Schema.JsonObject | undefined>;

export interface ToolCallJournal {
  readonly record: (fact: ToolCallFact) => Effect.Effect<boolean>;
}

export interface RunLineage {
  readonly startId: string;
  readonly correlationId: string;
}

export interface RunContext {
  readonly id: string;
  readonly org: string;
  readonly brain: string;
  readonly caller: CallerIdentity;
  readonly spec: { readonly name: string; readonly version: number };
  readonly journal: ToolCallJournal;
  readonly lineage: RunLineage;
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
  readonly summarize: (parsed: NoInfer<Parsed>) => DefinitionSummary;
  readonly execute: (
    parsed: NoInfer<Parsed>,
    input: Schema.Json,
    execution: RunContext,
  ) => Effect.Effect<Executed, PrimitiveRejection>;
  readonly whenCancelled?: WhenCancelled;
  readonly longestExecutionMs?: number;
  readonly reachesOutside?: boolean;
  readonly mayChangeOutside?: boolean;
  readonly callsTools?: (parsed: NoInfer<Parsed>) => boolean;
  readonly mostActive?: number;
  readonly standing?: Standing;
}

export interface PreparedDefinition {
  readonly summary: DefinitionSummary;
  readonly execute: (input: Schema.Json, execution: RunContext) => Effect.Effect<Executed, PrimitiveRejection>;
  readonly whenCancelled: WhenCancelled;
  readonly callsTools: boolean;
}

function callsNoTools(): boolean {
  return false;
}

function standsAsSaved(): Effect.Effect<Schema.JsonObject | undefined> {
  return Effect.undefined;
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
  readonly mayChangeOutside: boolean;
  readonly mostActive: number;
  readonly standing: Standing;
  readonly prepare: (source: string) => Effect.Effect<PreparedDefinition, InvalidInput>;
}

const primitiveName = /^[a-z][a-z0-9-]{2,31}$/u;

export function isPrimitiveName(name: string): boolean {
  return primitiveName.test(name);
}

export function definePrimitive<Parsed>(definition: PrimitiveDefinition<Parsed>): Primitive {
  const { name, title, description, noun, describeOutput, mediaType, parse, summarize, execute } = definition;
  const {
    whenCancelled = 'stop',
    longestExecutionMs = defaultLongestExecutionMs,
    reachesOutside = false,
    mayChangeOutside = false,
    callsTools = callsNoTools,
    mostActive = Number.POSITIVE_INFINITY,
    standing = standsAsSaved,
  } = definition;
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
    mayChangeOutside,
    mostActive,
    standing,
    prepare: (source) =>
      parse(source).pipe(
        Effect.map((parsed) => ({
          summary: summarize(parsed),
          execute: (input, execution) => execute(parsed, input, execution),
          whenCancelled,
          callsTools: callsTools(parsed),
        })),
      ),
  };
}
