import { verifiedWorkflowBundle } from './src/index.ts';

const [directory] = process.argv.slice(2);
if (directory === undefined) {
  process.stderr.write('Name the directory of the workflow bundle: node check-workflow-bundle.ts <directory>\n');
  process.exitCode = 1;
} else {
  const codePath = await verifiedWorkflowBundle(directory);
  process.stdout.write(`The workflow bundle ${codePath} matches this code, and Temporal's native bridge loads\n`);
}
