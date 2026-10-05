import { counted } from '@beonauto/operations';
import type { InputReceipt, RunEvent } from '@beonauto/workflow-engine';

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

export function summaryOf({ receipt, steps, outputs }: RunEvent): string {
  const moved = steps.length === 0 ? '' : `, and ${counted(steps.length, step)} moved`;
  const ended = outputs.some(({ kind }) => kind === 'settle') ? '; the workflow ended' : '';
  return `${happened(receipt)}${moved}${ended}.`;
}
