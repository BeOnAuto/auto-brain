import type { CallerIdentity } from '@beonauto/operations';
import type { Json, JsonObject } from '@beonauto/workflow-engine';
import { Schema } from 'effect';
import { parse } from 'yaml';

import type { SpecResponder } from './machine-commands.ts';
import type { Command, MachineHost, WorkflowStart } from './machine-host.ts';
import { interpretOnMachine, outputsAtOnce, type MachineInterpretation } from './machine-workflows.ts';
import {
  defaultLongestNestedExecutionMs,
  defaultMostDuration,
  type SpecCall,
  type SpecCallResult,
  type WorkflowRun,
} from './run-terms.ts';

export interface InterpretOptions {
  readonly input?: Json;
  readonly respond?: SpecResponder;
  readonly started?: (start: WorkflowStart, host: MachineHost) => void;
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

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);

export function yamlObject(source: string): JsonObject {
  return decodeObject(parse(source));
}

export function workflow(source: string): JsonObject {
  return { document: header, ...yamlObject(source) };
}

function runOf(document: JsonObject, input: Json = {}): WorkflowRun {
  return {
    document,
    input,
    execution: { id: executionId, org: 'acme', brain: 'alpha', spec: { name: 'test-flow', version: 1 } },
    caller: acmeCaller,
    mostDuration: defaultMostDuration,
    longestNestedExecutionMs: defaultLongestNestedExecutionMs,
  };
}

export function neverAnswers(): Promise<SpecCallResult> {
  return Promise.withResolvers<SpecCallResult>().promise;
}

export function callsIn(commands: readonly Command[]): readonly SpecCall[] {
  return commands.flatMap((command) => (command.kind === 'call' ? [command.call] : []));
}

export function interpret(document: JsonObject, options: InterpretOptions = {}): Promise<MachineInterpretation> {
  const run = runOf(document, options.input ?? {});
  return interpretOnMachine(
    {
      ...run,
      mostDuration: options.mostDuration ?? run.mostDuration,
      longestNestedExecutionMs: options.longestNestedExecutionMs ?? run.longestNestedExecutionMs,
    },
    options,
  );
}

export function outputsAtTimeZero(document: JsonObject, input: Json = {}): ReturnType<typeof outputsAtOnce> {
  return outputsAtOnce(runOf(document, input));
}

export const workflowExample = [
  "document: {dsl: '1.0.3', namespace: support, name: triage, version: '1.0.0'}",
  'do:',
  '  - classify:',
  '      call: execute_spec',
  "      with: {primitive: inference, name: classify-ticket, input: {ticket: '${ .ticket }'}}",
  "      output: {as: '${ $input + {triage: .} }'}",
  '  - escalate:',
  '      if: .triage.urgency == "high"',
  '      call: execute_spec',
  "      with: {primitive: inference, name: draft-escalation, input: {ticket: '${ .ticket }'}}",
  "      output: {as: '${ $input + {note: .} }'}",
  '  - approval:',
  '      if: .note != null',
  '      listen: {to: {one: {with: {type: com.acme.escalation.approved}}}}',
  "      output: {as: '${ $input + {approved_by: .[0].by} }'}",
].join('\n');
