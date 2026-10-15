import { listedPhrases, named, type Phrases } from '@on.auto/definitions';
import { listed } from '@on.auto/operations';
import { entriesOf, field, textField, type JsonObject } from '@on.auto/workflow-engine';

import type { PlacedTask } from './placed-tasks.ts';
import { casesOf, type SwitchCase } from './task-flow.ts';
import { expressionText, objectAt } from './task-reading.ts';

export interface StepPlace {
  readonly siblings: readonly PlacedTask[];
  readonly parent?: PlacedTask;
}

function stepsWords(first: number, last: number): string {
  if (last < first) {
    return 'nothing';
  }
  return first === last ? `step ${first}` : `steps ${first} to ${last}`;
}

export function movedWords(next: string | undefined, { siblings, parent }: StepPlace): string | undefined {
  if (next === 'end') {
    return 'ends the run';
  }
  if (next === 'exit') {
    return parent === undefined ? 'ends the run' : `leaves step ${parent.step}`;
  }
  const target = siblings.find(({ name }) => name === next);
  return target === undefined ? undefined : `goes to step ${target.step}`;
}

export function forWords({ task, step, last }: PlacedTask): Phrases {
  const loop = objectAt(task, 'for');
  const condition = field(task, 'while');
  return [
    `does ${stepsWords(step + 1, last)} for each `,
    named(textField(loop, 'each') ?? 'item'),
    ' of ',
    { code: expressionText(field(loop, 'in') ?? null) },
    ...(condition === undefined ? [] : [', while ', { code: expressionText(condition) }, ' holds']),
  ];
}

export function doWords({ step, last }: PlacedTask): Phrases {
  return [`does ${stepsWords(step + 1, last)} in order`];
}

export function forkWords({ task, body }: PlacedTask): Phrases {
  if (body.length === 0) {
    return ['does nothing at once'];
  }
  const branches = listed(body.map(({ step }) => String(step)));
  const handed =
    field(objectAt(task, 'fork'), 'compete') === true
      ? 'the output of the first to finish, cancelling the others'
      : 'a list of their outputs';
  return [`does ${body.length === 1 ? 'step' : 'steps'} ${branches} at once, and hands on ${handed}`];
}

function caughtWords(caught: JsonObject): Phrases {
  const tests = entriesOf(objectAt(caught, 'errors', 'with')).map(([key, value]): Phrases =>
    key === 'status' ? [`with status ${expressionText(value)}`] : [`whose ${key} is `, { code: expressionText(value) }],
  );
  const when = field(caught, 'when');
  const exceptWhen = field(caught, 'exceptWhen');
  return [
    ...(tests.length === 0 ? ['any error'] : ['an error ', ...listedPhrases(tests, 'and')]),
    ...(when === undefined ? [] : [', when ', { code: expressionText(when) }]),
    ...(exceptWhen === undefined ? [] : [', except when ', { code: expressionText(exceptWhen) }]),
  ];
}

function retryWords(caught: JsonObject): Phrases {
  const retry = field(caught, 'retry');
  if (retry === undefined) {
    return [];
  }
  const policy: Phrases = typeof retry === 'string' ? ['under the retry policy ', named(retry)] : ['as its catch says'];
  return ['tries again ', ...policy, ', and once no retry is left, it '];
}

export function tryWords({ task, step, bodyLast, last, recovery }: PlacedTask): Phrases {
  const caught = objectAt(task, 'catch');
  const recovered = recovery.length === 0 ? 'hands on its input' : `does ${stepsWords(bodyLast + 1, last)}`;
  return [
    `tries ${stepsWords(step + 1, bodyLast)}; on `,
    ...caughtWords(caught),
    ', it ',
    ...retryWords(caught),
    recovered,
  ];
}

function caseWords({ name, when, next }: SwitchCase, place: StepPlace): Phrases {
  const chosen: Phrases = when === undefined ? [', by default,'] : [', when ', { code: when }, ','];
  return [named(name), ...chosen, ` ${movedWords(next, place) ?? 'goes on'}`];
}

export function switchWords({ task }: PlacedTask, place: StepPlace): Phrases {
  const cases = casesOf(task).map((each) => caseWords(each, place));
  const unmatched: readonly Phrases[] = casesOf(task).every(({ when }) => when !== undefined)
    ? [[`when no case holds, it ${movedWords(textField(task, 'then'), place) ?? 'goes on'}`]]
    : [];
  return ['chooses the first case that holds: ', ...listedPhrases([...cases, ...unmatched], 'and')];
}
