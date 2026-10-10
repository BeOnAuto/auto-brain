import type { JsonObject, MachineOptions, MachineSandbox, MachineSettings } from '@beonauto/workflow-engine';

import { childRunOf } from '../calls/child-run.ts';
import { workflowFunctions } from '../document/workflow-functions.ts';

const runtimeDescriptor: JsonObject = {
  name: 'auto-brain',
  version: '1',
  metadata: { type: 'workflow' },
};

export const workflowMachineSettings: MachineSettings = {
  functions: { ...workflowFunctions, childOf: childRunOf },
  runtime: runtimeDescriptor,
};

export function workflowMachineOptionsOf(sandbox: MachineSandbox): MachineOptions {
  return { ...workflowMachineSettings, sandbox };
}
