import type { BrainOwnNames } from '@beonauto/definitions';
import type { JsonObject, MachineOptions, MachineSandbox, MachineSettings } from '@beonauto/workflow-engine';
import { runLogContextOf } from '@beonauto/workflow-host';

import { childRunOf } from '../calls/child-run.ts';
import { workflowFunctionsOf } from '../document/workflow-functions.ts';

const runtimeDescriptor: JsonObject = {
  name: 'auto-brain',
  version: '1',
  metadata: { type: 'workflow' },
};

export function workflowMachineSettingsOf(names: BrainOwnNames): MachineSettings {
  return {
    functions: { ...workflowFunctionsOf(names), childOf: childRunOf },
    runtime: runtimeDescriptor,
    contextOf: runLogContextOf,
  };
}

export function workflowMachineOptionsOf(sandbox: MachineSandbox, names: BrainOwnNames): MachineOptions {
  return { ...workflowMachineSettingsOf(names), sandbox };
}
