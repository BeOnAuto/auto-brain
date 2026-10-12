import { playbookOwnNamesOf, type PlaybookOwnNames } from '@beonauto/definitions';
import { echo } from '@beonauto/definitions/testing';
import {
  reusedSandbox,
  type MachineOptions,
  type MachineSandbox,
  type MachineSettings,
} from '@beonauto/workflow-engine';
import { freshInstance, unitMemoryBytes } from '@beonauto/workflow-engine/dsl';

import { workflowFacts } from '../capability/workflow.ts';
import { workflowPolicyOf, type WorkflowPolicy } from '../document/workflow-functions.ts';
import { workflowMachineOptionsOf, workflowMachineSettingsOf } from '../runs/workflow-machine-options.ts';

export const testSandbox: MachineSandbox = reusedSandbox(await freshInstance(unitMemoryBytes), () => 0);

export const testPlaybookNames: PlaybookOwnNames = playbookOwnNamesOf([echo, workflowFacts]);

export const testWorkflowPolicy: WorkflowPolicy = workflowPolicyOf(testPlaybookNames);

export const testWorkflowSettings: MachineSettings = workflowMachineSettingsOf(testPlaybookNames);

export const testWorkflowOptions: MachineOptions = workflowMachineOptionsOf(testSandbox, testPlaybookNames);
