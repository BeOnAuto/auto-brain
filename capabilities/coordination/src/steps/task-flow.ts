import { entriesOf, field, isList, isObject, textField, type Json, type JsonObject } from '@on.auto/workflow-engine';

import { expressionText, objectAt } from './task-reading.ts';

export interface SwitchCase {
  readonly name: string;
  readonly when?: string;
  readonly next?: string;
}

function caseOf(name: string, value: Json): SwitchCase {
  const written = isObject(value) ? value : {};
  const when = field(written, 'when');
  const next = textField(written, 'then');
  return {
    name,
    ...(when === undefined ? {} : { when: expressionText(when) }),
    ...(next === undefined ? {} : { next }),
  };
}

export function casesOf(task: JsonObject): readonly SwitchCase[] {
  const cases = field(task, 'switch');
  return isList(cases)
    ? cases.flatMap((item) => (isObject(item) ? entriesOf(item).map(([name, value]) => caseOf(name, value)) : []))
    : [];
}

export function conditionOf(task: JsonObject): string | undefined {
  const condition = field(task, 'if');
  return condition === undefined ? undefined : expressionText(condition);
}

export function catchLabelOf(task: JsonObject): string {
  const status = field(objectAt(task, 'catch', 'errors', 'with'), 'status');
  const retried = field(objectAt(task, 'catch'), 'retry') === undefined ? '' : ', after retries';
  return typeof status === 'number' ? `on error ${status}${retried}` : `on an error${retried}`;
}
