import type { CallFunctions } from '../dsl/call-functions.ts';
import { objectField, type Json, type JsonObject } from '../dsl/json.ts';
import type { Components } from '../dsl/policy-checks.ts';
import type { RunLimits } from '../machine/run-input.ts';
import { dateTimeOf } from '../machine/utc-time.ts';
import type { RunCell } from './run-cell.ts';
import type { ValueTable } from './run-tables.ts';

export interface MachineOptions {
  readonly functions: CallFunctions;
  readonly runtime: JsonObject;
}

export interface Descriptors {
  readonly executionId: () => string;
  readonly document: () => JsonObject;
  readonly limits: () => RunLimits;
  readonly components: () => Components;
  readonly workflow: () => JsonObject;
}

function documentOf(cell: RunCell): JsonObject {
  return cell.get().state.workflow?.document ?? {};
}

export function descriptorsOf(cell: RunCell, values: ValueTable): Descriptors {
  return {
    executionId: () => cell.get().state.executionId,
    document: () => documentOf(cell),
    limits: () => cell.get().state.limits,
    components: () => {
      const use = objectField(documentOf(cell), 'use') ?? {};
      return {
        errors: objectField(use, 'errors') ?? {},
        retries: objectField(use, 'retries') ?? {},
        timeouts: objectField(use, 'timeouts') ?? {},
      };
    },
    workflow: () => {
      const { state } = cell.get();
      const input: Json = state.workflow === null ? null : values.valueOf(state.workflow.input);
      return { id: state.executionId, definition: documentOf(cell), input, startedAt: dateTimeOf(state.startedAt) };
    },
  };
}
