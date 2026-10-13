import {
  credentialProblems,
  decodedJsonSetting,
  pointerOf,
  problem,
  substituted,
  type SettingProblem,
} from '@on.auto/config';
import { Data, Effect, Option, Result, Schema } from 'effect';

import { checkedEntry } from './entry-checks.ts';
import { misplacedReferences, secretsOfEntry } from './entry-references.ts';
import { ServerEntrySchema, ToolServersSchema, toolServersSetting, type ServerEntryFields } from './server-entries.ts';
import type { ServerSettings, ToolServerSettings } from './server-settings.ts';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface ToolServerSettingsContext {
  readonly modelProviders: readonly string[];
  readonly documentsDirectory?: string;
}

export class ToolServerSettingsInvalid extends Data.TaggedError('tool_server_settings_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

const credentialAdvice =
  'Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}';

const decodeEntry = Schema.decodeUnknownSync(ServerEntrySchema);

function readEntry(
  name: string,
  written: ServerEntryFields,
  environment: Environment,
  context: ToolServerSettingsContext,
): Result.Result<ServerSettings, readonly SettingProblem[]> {
  const pointer = pointerOf([name]);
  const credentials = credentialProblems(name, written, pointer).map(({ pointer: place }) =>
    problem(toolServersSetting, place, credentialAdvice),
  );
  const resolved = substituted(written, pointer, environment);
  const unresolved = resolved.problems.map(({ pointer: place, detail }) => problem(toolServersSetting, place, detail));
  const problems = [...credentials, ...unresolved, ...misplacedReferences(name, resolved.references)];
  return problems.length > 0
    ? Result.fail(problems)
    : checkedEntry(name, decodeEntry(resolved.value), {
        providers: context.modelProviders,
        directory: context.documentsDirectory ?? process.cwd(),
        secrets: secretsOfEntry(name, resolved.references),
      });
}

function serversOf(
  text: string | undefined,
  environment: Environment,
  context: ToolServerSettingsContext,
): Result.Result<readonly ServerSettings[], readonly SettingProblem[]> {
  if (text === undefined) {
    return Result.succeed([]);
  }
  return Result.flatMap(decodedJsonSetting(toolServersSetting, text, ToolServersSchema), (entries) => {
    const read = Object.entries(entries).map(([name, written]: readonly [string, ServerEntryFields]) =>
      readEntry(name, written, environment, context),
    );
    const problems: SettingProblem[] = [];
    for (const entry of read) {
      problems.push(...Result.getFailure(entry).pipe(Option.getOrElse((): readonly SettingProblem[] => [])));
    }
    return problems.length > 0 ? Result.fail(problems) : Result.all(read);
  });
}

function invalid(problems: readonly SettingProblem[]): ToolServerSettingsInvalid {
  const listed = problems.map(({ setting, detail }) => `${setting}: ${detail}`).join('; ');
  return new ToolServerSettingsInvalid({ message: `The tool server settings are invalid. ${listed}`, problems });
}

export function readToolServerSettings(
  environment: Environment,
  context: ToolServerSettingsContext,
): Effect.Effect<ToolServerSettings, ToolServerSettingsInvalid> {
  return Result.match(serversOf(environment[toolServersSetting], environment, context), {
    onSuccess: (servers) => Effect.succeed({ servers }),
    onFailure: (problems) => Effect.fail(invalid(problems)),
  });
}
