import type { JsonObject, MachineOptions } from '@beonauto/workflow-engine';

import { childRunOf } from '../calls/child-run.ts';
import { workflowFunctions } from '../document/workflow-functions.ts';

const runtimeDescriptor: JsonObject = {
  name: 'auto-brain',
  version: '1',
  metadata: { type: 'workflow' },
};

export const workflowMachineOptions: MachineOptions = {
  functions: { ...workflowFunctions, childOf: childRunOf },
  runtime: runtimeDescriptor,
};
