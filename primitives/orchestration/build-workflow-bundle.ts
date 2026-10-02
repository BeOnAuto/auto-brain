import { buildWorkflowBundle } from './src/worker/workflow-bundle.ts';

const [directory] = process.argv.slice(2);
if (directory === undefined) {
  process.stderr.write(
    'Name the directory to write the workflow bundle to: node build-workflow-bundle.ts <directory>\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Built the workflow bundle ${await buildWorkflowBundle(directory)}\n`);
}
