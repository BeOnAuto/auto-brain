import type { CallerIdentity, Conflict, InvalidInput, Noun, Settlement, Unavailable } from '@beonauto/operations';
import { Effect, type Schema } from 'effect';

import type { Trigger } from '../registry/definition-triggers.ts';
import { deliveryEnded, deliveryStarted } from '../run-work/delivery-words.ts';
import type { CallAnsweredFact, CallStartedFact } from '../runs/run-commands.ts';
import type { CancelRequestKind, DeliveryEvent } from '../runs/run-events.ts';
import type { BroughtAnswer } from '../runs/run-state.ts';

export interface DefinitionSummary {
  readonly description?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
  readonly warnings?: readonly string[];
  readonly triggers?: readonly Trigger[];
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
  readonly started: (fact: CallStartedFact) => Effect.Effect<number | undefined>;
  readonly answered: (fact: CallAnsweredFact) => Effect.Effect<boolean>;
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
  readonly definition: { readonly name: string; readonly version: number };
  readonly journal: ToolCallJournal;
  readonly lineage: RunLineage;
  readonly depth: number;
  readonly callDepth: number;
  readonly longestRunOf: (type: string, name: string) => Effect.Effect<number | undefined>;
}

export interface Finished {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
}

export interface FinishesLater {
  readonly finishesLater: true;
  readonly record: Schema.JsonObject;
}

export type CapabilityAnswer = Finished | FinishesLater;

export type CapabilityRejection = InvalidInput | Unavailable | Conflict;

export interface CancelledRun {
  readonly run: { readonly org: string; readonly brain: string; readonly id: string };
  readonly record: Schema.JsonObject;
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly broughtAnswer: BroughtAnswer | null;
  readonly deliveredAt: string | null;
}

export type CancelDecision = (run: CancelledRun) => Settlement;

export interface CapabilityGuide {
  readonly name: string;
  readonly onThisServer?: string;
}

export interface RunAccount {
  readonly summary: string;
  readonly data: { readonly [field: string]: Schema.Json };
}

export interface RunWords {
  readonly deferralType: string;
  readonly deferral: (record: Schema.JsonObject) => RunAccount | undefined;
  readonly delivery: (fact: DeliveryEvent) => string;
}

type WhenCancelled = 'stop' | 'finish';

const defaultLongestAnyRunMs = 600_000;

export interface CapabilityDeclaration<Parsed> {
  readonly type: string;
  readonly title: string;
  readonly guide: CapabilityGuide;
  readonly noun: Noun;
  readonly describeOutput: (output: Schema.Json) => string;
  readonly mediaType: string;
  readonly parse: (source: string) => Effect.Effect<Parsed, InvalidInput>;
  readonly summarize: (parsed: NoInfer<Parsed>) => DefinitionSummary;
  readonly run: (
    parsed: NoInfer<Parsed>,
    input: Schema.Json,
    context: RunContext,
  ) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
  readonly whenCancelled?: WhenCancelled;
  readonly longestAnyRunMs?: number;
  readonly reachesOutside?: boolean;
  readonly mayChangeOutside?: boolean;
  readonly callsTools?: (parsed: NoInfer<Parsed>) => boolean;
  readonly finishesLater?: boolean | ((parsed: NoInfer<Parsed>) => boolean);
  readonly longestRunOf?: (parsed: NoInfer<Parsed>) => number;
  readonly cancel?: CancelDecision;
  readonly runWords?: Partial<RunWords>;
  readonly mostActive?: number;
  readonly standing?: Standing;
}

export interface PreparedDefinition {
  readonly summary: DefinitionSummary;
  readonly run: (input: Schema.Json, context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
  readonly whenCancelled: WhenCancelled;
  readonly callsTools: boolean;
  readonly finishesLater: boolean;
  readonly longestRunMs: number;
}

function callsNoTools(): boolean {
  return false;
}

function noDeferralShown(): undefined {
  return undefined;
}

function deliveryInWords(fact: DeliveryEvent): string {
  return fact.type === 'delivery_started' ? deliveryStarted(fact) : deliveryEnded(fact);
}

export const defaultRunWords: RunWords = {
  deferralType: 'run_deferred',
  deferral: noDeferralShown,
  delivery: deliveryInWords,
};

export function cancelledAsAsked({ kind, reason }: CancelledRun): Settlement {
  return { status: 'rejected', reason: 'cancelled', kind, detail: reason };
}

function standsAsSaved(): Effect.Effect<Schema.JsonObject | undefined> {
  return Effect.undefined;
}

export interface Capability {
  readonly type: string;
  readonly title: string;
  readonly guide: CapabilityGuide;
  readonly noun: Noun;
  readonly describeOutput: (output: Schema.Json) => string;
  readonly mediaType: string;
  readonly longestAnyRunMs: number;
  readonly reachesOutside: boolean;
  readonly mayChangeOutside: boolean;
  readonly mostActive: number;
  readonly standing: Standing;
  readonly cancel: CancelDecision;
  readonly runWords: RunWords;
  readonly prepare: (source: string) => Effect.Effect<PreparedDefinition, InvalidInput>;
}

const definitionTypePattern = /^[a-z][a-z0-9-]{2,31}$/u;

export function isDefinitionTypeName(name: string): boolean {
  return definitionTypePattern.test(name);
}

function declaredBounds<Parsed>(definition: CapabilityDeclaration<Parsed>) {
  return {
    longestAnyRunMs: definition.longestAnyRunMs ?? defaultLongestAnyRunMs,
    reachesOutside: definition.reachesOutside ?? false,
    mayChangeOutside: definition.mayChangeOutside ?? false,
    mostActive: definition.mostActive ?? Number.POSITIVE_INFINITY,
    standing: definition.standing ?? standsAsSaved,
    cancel: definition.cancel ?? cancelledAsAsked,
    runWords: { ...defaultRunWords, ...definition.runWords },
  };
}

function finishingOf<Parsed>(declared: CapabilityDeclaration<Parsed>['finishesLater']): (parsed: Parsed) => boolean {
  return typeof declared === 'function' ? declared : () => declared ?? false;
}

function declaredRuns<Parsed>(definition: CapabilityDeclaration<Parsed>, longestAnyRunMs: number) {
  return {
    whenCancelled: definition.whenCancelled ?? 'stop',
    callsTools: definition.callsTools ?? callsNoTools,
    finishesLater: finishingOf<Parsed>(definition.finishesLater),
    longestRunOf: definition.longestRunOf ?? (() => longestAnyRunMs),
  };
}

export function defineCapability<Parsed>(definition: CapabilityDeclaration<Parsed>): Capability {
  const { type, title, guide, noun, describeOutput, mediaType, parse, summarize, run } = definition;
  const bounds = declaredBounds(definition);
  const { whenCancelled, callsTools, finishesLater, longestRunOf } = declaredRuns(definition, bounds.longestAnyRunMs);
  if (!isDefinitionTypeName(type)) {
    throw new Error(`The type ${type} is malformed`);
  }
  return {
    type,
    title,
    guide,
    noun,
    describeOutput,
    mediaType,
    ...bounds,
    prepare: (source) =>
      parse(source).pipe(
        Effect.map((parsed) => ({
          summary: summarize(parsed),
          run: (input, context) => run(parsed, input, context),
          whenCancelled,
          callsTools: callsTools(parsed),
          finishesLater: finishesLater(parsed),
          longestRunMs: longestRunOf(parsed),
        })),
      ),
  };
}
