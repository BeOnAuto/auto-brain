export { runWorkflowSpec } from './src/workflow/workflows.ts';

export function temporalGlobalProbe(): Promise<string> {
  return Promise.resolve(typeof Reflect.get(globalThis, 'Temporal'));
}
