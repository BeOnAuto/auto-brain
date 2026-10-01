import { JsonPointer, Option, Result, Schema } from 'effect';

import { parseModelReference } from '../model/model-reference.ts';
import { decodeJsonSetting, strictly } from './json-setting.ts';
import { problem, type SettingProblem } from './setting-values.ts';

export interface AliasReading {
  readonly problems: readonly SettingProblem[];
  readonly aliases: ReadonlyMap<string, string>;
}

type Aliases = Readonly<Record<string, string>>;

const setting = 'MODEL_ALIASES';

const decodeAliases = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.String), strictly);

function referenceProblems(alias: string, target: string): readonly SettingProblem[] {
  const malformed = [alias, target].some((reference) => Option.isNone(parseModelReference(reference)));
  return malformed
    ? problem(setting, `/${JsonPointer.escapeToken(alias)}: An alias and its target are each written provider/model`)
    : [];
}

function hopProblems(alias: string, target: string, aliases: Aliases): readonly SettingProblem[] {
  return Object.hasOwn(aliases, target)
    ? problem(
        setting,
        `/${JsonPointer.escapeToken(alias)}: The target is itself an alias; an alias resolves in one hop`,
      )
    : [];
}

function readingOf(aliases: Aliases): AliasReading {
  const entries = Object.entries(aliases);
  return {
    problems: entries.flatMap(([alias, target]: readonly [string, string]) => [
      ...referenceProblems(alias, target),
      ...hopProblems(alias, target, aliases),
    ]),
    aliases: new Map(entries),
  };
}

export function aliasReading(text: string | undefined): AliasReading {
  if (text === undefined) {
    return readingOf({});
  }
  return Result.match(decodeJsonSetting(setting, text, decodeAliases), {
    onSuccess: readingOf,
    onFailure: (problems) => ({ problems, aliases: new Map() }),
  });
}
