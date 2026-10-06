import type { JsonObject, MachineOptions } from '@beonauto/workflow-engine';

import { childRunOf } from '../calls/child-run.ts';
import { workflowFunctions } from '../document/workflow-functions.ts';

const runtimeDescriptor: JsonObject = {
  name: 'auto-brain',
  version: '1',
  metadata: { primitive: 'orchestration' },
};

export const orchestrationMachine: MachineOptions = {
  functions: { ...workflowFunctions, childOf: childRunOf },
  runtime: runtimeDescriptor,
};
