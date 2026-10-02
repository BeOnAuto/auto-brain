import type { CallerIdentity } from '@beonauto/operations';
import { parse } from 'yaml';

import { isJson, isObject, type Json, type JsonObject } from '../dsl/json.ts';
import type { RunSettlement, SpecCall, SpecCallResult, WorkflowHost } from '../interpreter/host.ts';
import { startWorkflow, type WorkflowStart } from '../interpreter/interpreter.ts';
import type { WorkflowEnding } from '../interpreter/settlement.ts';
import { defaultLongestNestedExecutionMs, defaultMostDuration, type WorkflowRun } from '../interpreter/workflow-run.ts';
import { fakeHost, type Command, type FakeHost, type FakeHostOptions } from './fake-host.ts';

type SettleCommand = Extract<Command, { readonly kind: 'settle' }>;

export interface Interpretation {
  readonly ending: WorkflowEnding;
  readonly settlement: RunSettlement | undefined;
  readonly commands: readonly Command[];
  readonly fake: FakeHost;
}

export interface InterpretOptions extends FakeHostOptions {
  readonly input?: Json;
  readonly host?: (fake: FakeHost) => WorkflowHost;
  readonly started?: (start: WorkflowStart, fake: FakeHost) => void;
  readonly mostDuration?: number;
  readonly longestNestedExecutionMs?: number;
}

export const acmeCaller: CallerIdentity = {
  id: 'acme-admin',
  org: 'acme',
  permissions: ['brain:read', 'brain:write'],
  brains: '*',
};

export const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const header = { dsl: '1.0.3', namespace: 'acme', name: 'test', version: '1.0.0' };

export function yamlObject(source: string): JsonObject {
  const value: unknown = parse(source);
  if (!isJson(value) || !isObject(value)) {
    throw new TypeError('The YAML is not a JSON object');
  }
  return value;
}

export function workflow(source: string): JsonObject {
  return { document: header, ...yamlObject(source) };
}

export function runFor(document: JsonObject, id: string, input: Json = {}): WorkflowRun {
  return {
    document,
    input,
    execution: { id, org: 'acme', brain: 'alpha', spec: { name: 'test-flow', version: 1 } },
    caller: acmeCaller,
    mostDuration: defaultMostDuration,
    longestNestedExecutionMs: defaultLongestNestedExecutionMs,
  };
}

export function runOf(document: JsonObject, input: Json = {}): WorkflowRun {
  return runFor(document, executionId, input);
}

export function neverAnswers(): Promise<SpecCallResult> {
  return Promise.withResolvers<SpecCallResult>().promise;
}

export function callsIn(commands: readonly Command[]): readonly SpecCall[] {
  return commands.flatMap((command) => (command.kind === 'call' ? [command.call] : []));
}

export async function interpret(document: JsonObject, options: InterpretOptions = {}): Promise<Interpretation> {
  const fake = fakeHost(options);
  const host = options.host === undefined ? fake.host : options.host(fake);
  const ending = await fake.drive(() => {
    const run = runOf(document, options.input ?? {});
    const start = startWorkflow(
      {
        ...run,
        mostDuration: options.mostDuration ?? run.mostDuration,
        longestNestedExecutionMs: options.longestNestedExecutionMs ?? run.longestNestedExecutionMs,
      },
      host,
    );
    options.started?.(start, fake);
    return start.ending;
  });
  const settled = fake.commands().find((command): command is SettleCommand => command.kind === 'settle');
  return { ending, settlement: settled?.request.settlement, commands: fake.commands(), fake };
}
