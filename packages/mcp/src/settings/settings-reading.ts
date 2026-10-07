import {
  credentialProblems,
  decodedJsonSetting,
  pointerOf,
  problem,
  substituted,
  type SettingProblem,
} from '@beonauto/config';
import { Data, Effect, Option, Result, Schema } from 'effect';

import { allowedToolsOf, allowedToolsSetting } from './allowed-tools.ts';
import { checkedEntry, mcpServersSetting } from './entry-checks.ts';
import { misplacedReferences, secretsOfEntry } from './entry-references.ts';
import type { McpServerSettings, McpSettings } from './mcp-settings.ts';
import { McpServerEntrySchema, McpServersSchema, type McpServerEntryFields } from './server-entries.ts';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface McpSettingsContext {
  readonly modelProviders: readonly string[];
}

export class McpSettingsInvalid extends Data.TaggedError('mcp_settings_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

const credentialAdvice =
  'Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}';

const decodeEntry = Schema.decodeUnknownSync(McpServerEntrySchema);

function readEntry(
  name: string,
  written: McpServerEntryFields,
  environment: Environment,
  context: McpSettingsContext,
): Result.Result<McpServerSettings, readonly SettingProblem[]> {
  const pointer = pointerOf([name]);
  const credentials = credentialProblems(name, written, pointer).map(({ pointer: place }) =>
    problem(mcpServersSetting, place, credentialAdvice),
  );
  const resolved = substituted(written, pointer, environment);
  const unresolved = resolved.problems.map(({ pointer: place, detail }) => problem(mcpServersSetting, place, detail));
  const problems = [...credentials, ...unresolved, ...misplacedReferences(name, resolved.references)];
  return problems.length > 0
    ? Result.fail(problems)
    : checkedEntry(
        name,
        decodeEntry(resolved.value),
        context.modelProviders,
        secretsOfEntry(name, resolved.references),
      );
}

function serversOf(
  text: string | undefined,
  environment: Environment,
  context: McpSettingsContext,
): Result.Result<readonly McpServerSettings[], readonly SettingProblem[]> {
  if (text === undefined) {
    return Result.succeed([]);
  }
  return Result.flatMap(decodedJsonSetting(mcpServersSetting, text, McpServersSchema), (entries) => {
    const read = Object.entries(entries).map(([name, written]: readonly [string, McpServerEntryFields]) =>
      readEntry(name, written, environment, context),
    );
    const problems: SettingProblem[] = [];
    for (const entry of read) {
      problems.push(...Result.getFailure(entry).pipe(Option.getOrElse((): readonly SettingProblem[] => [])));
    }
    return problems.length > 0 ? Result.fail(problems) : Result.all(read);
  });
}

function invalid(problems: readonly SettingProblem[]): McpSettingsInvalid {
  const listed = problems.map(({ setting, detail }) => `${setting}: ${detail}`).join('; ');
  return new McpSettingsInvalid({ message: `The MCP server settings are invalid. ${listed}`, problems });
}

export function readMcpSettings(
  environment: Environment,
  context: McpSettingsContext,
): Effect.Effect<McpSettings, McpSettingsInvalid> {
  const servers = serversOf(environment[mcpServersSetting], environment, context);
  const names = Result.isSuccess(servers) ? servers.success.map(({ name }) => name) : [];
  const allowed = allowedToolsOf(environment[allowedToolsSetting], names);
  if (Result.isSuccess(servers) && Result.isSuccess(allowed)) {
    return Effect.succeed({ servers: servers.success, allowed: allowed.success });
  }
  return Effect.fail(
    invalid([
      ...(Result.isFailure(servers) ? servers.failure : []),
      ...(Result.isFailure(allowed) && Result.isSuccess(servers) ? allowed.failure : []),
    ]),
  );
}
