import { BrainIdSchema, OrgIdSchema } from '@beonauto/operations';
import { JsonPointer, Result, Schema } from 'effect';

import { problem, type SettingProblem } from './json-setting.ts';

const isOrgId = Schema.is(OrgIdSchema);

const isBrainId = Schema.is(BrainIdSchema);

export interface ServedScope {
  readonly org: string;
  readonly brains: readonly string[] | null;
}

export interface ServedAddress {
  readonly org: string;
  readonly brain: string;
}

export interface WrittenScope {
  readonly org?: string | undefined;
  readonly brains?: readonly string[] | undefined;
}

function entryPointer(entry: string, ...path: readonly string[]): string {
  return [entry, ...path].map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

export function servesBrain({ org, brains }: ServedScope, address: ServedAddress): boolean {
  return org === address.org && (brains === null || brains.includes(address.brain));
}

export function liesWithin(inner: ServedScope, outer: ServedScope): boolean {
  if (inner.org !== outer.org) {
    return false;
  }
  const { brains } = outer;
  return brains === null || (inner.brains !== null && inner.brains.every((brain) => brains.includes(brain)));
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

function brainProblems(setting: string, entry: string, brains: readonly string[]): readonly SettingProblem[] {
  return brains.flatMap((brain, index) =>
    isBrainId(brain) ? [] : [problem(setting, entryPointer(entry, 'brains', String(index)), 'Expected a brain id')],
  );
}

export function servedScopeOf(
  setting: string,
  entry: string,
  { org, brains }: WrittenScope,
  served: string,
): Result.Result<ServedScope, readonly SettingProblem[]> {
  const problems = [...orgProblems(setting, entry, org, served), ...brainProblems(setting, entry, brains ?? [])];
  return org === undefined || problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({ org, brains: brains ?? null });
}
