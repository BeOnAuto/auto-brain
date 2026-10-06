export { definitionCalls, definitionCalls as specCalls } from './calls/function-calls.ts';
export type {
  RunDefinition,
  RunDefinition as ExecuteSpec,
  DefinitionRunRequest,
  DefinitionRunRequest as SpecExecution,
  DefinitionRunResult,
  DefinitionRunResult as SpecExecutionResult,
} from './calls/function-run.ts';
export { definitionRunResultOf, definitionRunResultOf as specExecutionResultOf } from './calls/function-results.ts';
export { defineSendExecutionEvent } from './events/send-execution-event.ts';
export { runPresenter } from './presenting/run-presenter.ts';
export {
  makeWorkflowAdapter,
  makeWorkflowAdapter as makeOrchestration,
  type WorkflowAdapterDependencies,
  type WorkflowAdapterDependencies as OrchestrationDependencies,
} from './primitive/workflow.ts';
export type { WorkflowDefinitionDocument } from './document/workflow-document.ts';
export { orchestrationMachine } from './runs/orchestration-machine.ts';
