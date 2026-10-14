import type { Environment } from '@on.auto/config';
import { runKeyCommand, type KeyCommandConsole } from '@on.auto/identity';

import { release } from '../composition/release.ts';
import { localSettings, type LocalPlace } from './local-settings.ts';

export interface CommandLineHost {
  readonly environment: Environment;
  readonly place: LocalPlace;
  readonly console: KeyCommandConsole;
  readonly startServer: (settings: Readonly<Record<string, string>>) => Promise<unknown>;
}

const usage = [
  'Usage: auto-runtime [command]',
  '',
  'Commands:',
  '  start                  Start Auto Runtime on this computer at http://localhost:5555 (the default)',
  '  key --org <org id>     Issue an API key for a machine or a pipeline; --help after it lists its options',
  '  --version              Print the version',
  '  --help                 Print this help',
  '',
  'A person signs in through the Auto identity service when their agent connects.',
  'LOCAL_MODE=true trusts every request on this computer instead, for development.',
  'Settings are environment variables, read from the shell and from .env in the current directory.',
  'auto-runtime.yaml in the current directory is the configuration file.',
  'The ledger is kept in ~/.auto-runtime/ledger.db unless LEDGER_FILE or DATABASE_URL says otherwise.',
].join('\n');

type Answer = (rest: readonly string[], host: CommandLineHost) => number;

const answers: Readonly<Record<string, Answer>> = {
  key: (rest, host) => runKeyCommand(rest, host.console),
  '--version': (_rest, host) => {
    host.console.log(release.version);
    return 0;
  },
  '--help': (_rest, host) => {
    host.console.log(usage);
    return 0;
  },
};

function answered(args: readonly string[], host: CommandLineHost): number {
  const [name = '', ...rest] = args;
  const answer = Object.hasOwn(answers, name) ? answers[name] : undefined;
  if (answer === undefined) {
    host.console.error(`auto-runtime has no command "${args.join(' ')}"`);
    host.console.error(usage);
    return 1;
  }
  return answer(rest, host);
}

function startsTheServer(args: readonly string[]): boolean {
  return args.length === 0 || (args.length === 1 && args[0] === 'start');
}

async function startedServer(host: CommandLineHost): Promise<undefined> {
  await host.startServer(localSettings(host.environment, host.place));
}

export function runCommandLine(args: readonly string[], host: CommandLineHost): Promise<number | undefined> {
  return startsTheServer(args) ? startedServer(host) : Promise.resolve(answered(args, host));
}
