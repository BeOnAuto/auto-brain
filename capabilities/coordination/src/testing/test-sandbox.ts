import { reusedSandbox, type MachineOptions, type MachineSandbox } from '@beonauto/workflow-engine';
import { freshInstance, unitMemoryBytes } from '@beonauto/workflow-engine/dsl';

import { workflowMachineOptionsOf } from '../runs/workflow-machine-options.ts';

export const testSandbox: MachineSandbox = reusedSandbox(await freshInstance(unitMemoryBytes), () => 0);

export const testWorkflowOptions: MachineOptions = workflowMachineOptionsOf(testSandbox);
