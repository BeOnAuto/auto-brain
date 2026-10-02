import * as temporal from '@temporalio/workflow';

import { defineInterpreterWorkflow } from './interpreter-workflow.ts';

Reflect.deleteProperty(globalThis, 'Temporal');

export const runWorkflowSpec = defineInterpreterWorkflow(temporal);
