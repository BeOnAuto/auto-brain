import type { JsonObject, MachineOptions } from '@beonauto/workflow-engine';

import { workflowFunctions } from '../document/workflow-functions.ts';

const runtimeDescriptor: JsonObject = {
  name: 'auto-brain',
  version: '1',
  metadata: { primitive: 'orchestration' },
};

export const orchestrationMachine: MachineOptions = { functions: workflowFunctions, runtime: runtimeDescriptor };
