import { runKeyCommand } from './run-key-command.ts';

process.exitCode = runKeyCommand(process.argv.slice(2), {
  print: (line) => {
    process.stdout.write(`${line}\n`);
  },
  complain: (line) => {
    process.stderr.write(`${line}\n`);
  },
});
