import {
  ConflictKindSchema,
  UnavailableBecauseSchema,
  UnavailableKindSchema,
  asSentence,
  capitalized,
  counted,
  explanationOf,
} from '@beonauto/operations';
import type { InputReceipt, RunEvent } from '@beonauto/workflow-engine';
import { Option, Schema } from 'effect';

const step = { one: 'step', other: 'steps' };

function happened(receipt: InputReceipt): string {
  if (receipt.kind === 'started') {
    return 'The workflow started';
  }
  if (receipt.kind === 'timer_fired') {
    return 'A timer of the workflow went off';
  }
  if (receipt.kind === 'call_answered') {
    return receipt.status === 'succeeded'
      ? 'A function the workflow called answered'
      : 'A function the workflow called did not succeed';
  }
  return receipt.kind === 'event_received' ? 'The workflow received an event' : 'The workflow was asked to stop';
}

const decodeUnavailableKind = Schema.decodeUnknownOption(UnavailableKindSchema);

const decodeConflictKind = Schema.decodeUnknownOption(ConflictKindSchema);

const decodeBecause = Schema.decodeUnknownOption(UnavailableBecauseSchema);

type Rejection = NonNullable<Extract<InputReceipt, { readonly kind: 'call_answered' }>['rejection']>;

function whyNot({ kind, because }: Rejection): string {
  const known = Option.getOrUndefined(decodeBecause(because));
  const withBecause = known === undefined ? {} : { because: known };
  const unavailable = Option.getOrUndefined(decodeUnavailableKind(kind));
  if (unavailable !== undefined) {
    return explanationOf({ reason: 'unavailable', kind: unavailable, ...withBecause }).why;
  }
  const conflict = Option.getOrUndefined(decodeConflictKind(kind));
  return conflict === undefined ? '' : explanationOf({ reason: 'conflict', kind: conflict }).why;
}

function why(receipt: InputReceipt): string {
  const said = receipt.kind === 'call_answered' && receipt.rejection !== undefined ? whyNot(receipt.rejection) : '';
  return said === '' ? '' : ` ${asSentence(capitalized(said))}`;
}

export function summaryOf({ receipt, steps, outputs }: RunEvent): string {
  const moved = steps.length === 0 ? '' : `, and ${counted(steps.length, step)} moved`;
  const ended = outputs.some(({ kind }) => kind === 'settle') ? '; the workflow ended' : '';
  return `${happened(receipt)}${moved}${ended}.${why(receipt)}`;
}
