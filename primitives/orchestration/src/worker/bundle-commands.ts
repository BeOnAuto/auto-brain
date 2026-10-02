import { buildWorkflowBundle, verifiedWorkflowBundle } from './workflow-bundle.ts';

export interface CommandOutput {
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

export async function buildBundleCommand(argv: readonly string[], output: CommandOutput): Promise<number> {
  const [directory] = argv;
  if (directory === undefined) {
    output.error('Name the directory to write the workflow bundle to: node build-workflow-bundle.ts <directory>');
    return 1;
  }
  output.out(`Built the workflow bundle ${await buildWorkflowBundle(directory)}`);
  return 0;
}

export async function checkBundleCommand(argv: readonly string[], output: CommandOutput): Promise<number> {
  const [directory] = argv;
  if (directory === undefined) {
    output.error('Name the directory of the workflow bundle: node check-workflow-bundle.ts <directory>');
    return 1;
  }
  const codePath = await verifiedWorkflowBundle(directory);
  output.out(`The workflow bundle ${codePath} matches this code, and Temporal's native bridge loads`);
  return 0;
}
