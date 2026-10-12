import { PlaybookIdSchema, OrgIdSchema } from '@on.auto/operations';
import { JsonPointer, Result, Schema } from 'effect';

import { problem, type SettingProblem } from './json-setting.ts';

const isOrgId = Schema.is(OrgIdSchema);

const isPlaybookId = Schema.is(PlaybookIdSchema);

export interface ServedScope {
  readonly org: string;
  readonly playbooks: readonly string[] | null;
}

export interface ServedAddress {
  readonly org: string;
  readonly playbook: string;
}

export interface WrittenScope {
  readonly org?: string | undefined;
  readonly playbooks?: readonly string[] | undefined;
}

function entryPointer(entry: string, ...path: readonly string[]): string {
  return [entry, ...path].map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

export function servesPlaybook({ org, playbooks }: ServedScope, address: ServedAddress): boolean {
  return org === address.org && (playbooks === null || playbooks.includes(address.playbook));
}

function orgProblems(
  setting: string,
  entry: string,
  org: string | undefined,
  served: string,
): readonly SettingProblem[] {
  if (org === undefined) {
    return [problem(setting, entryPointer(entry), `Expected the org this ${served} serves`)];
  }
  return isOrgId(org) ? [] : [problem(setting, entryPointer(entry, 'org'), 'Expected an org id')];
}

function playbookProblems(setting: string, entry: string, playbooks: readonly string[]): readonly SettingProblem[] {
  return playbooks.flatMap((playbook, index) =>
    isPlaybookId(playbook)
      ? []
      : [problem(setting, entryPointer(entry, 'playbooks', String(index)), 'Expected a playbook id')],
  );
}

export function servedScopeOf(
  setting: string,
  entry: string,
  { org, playbooks }: WrittenScope,
  served: string,
): Result.Result<ServedScope, readonly SettingProblem[]> {
  const problems = [...orgProblems(setting, entry, org, served), ...playbookProblems(setting, entry, playbooks ?? [])];
  return org === undefined || problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({ org, playbooks: playbooks ?? null });
}
