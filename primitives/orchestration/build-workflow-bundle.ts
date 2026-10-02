import { buildBundleCommand } from './src/worker/bundle-commands.ts';

process.exitCode = await buildBundleCommand(process.argv.slice(2), {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  error: (line) => {
    process.stderr.write(`${line}\n`);
  },
});
