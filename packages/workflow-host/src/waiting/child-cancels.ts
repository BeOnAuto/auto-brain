import type { CancelExecution } from '@beonauto/specs';
import type { CancelReason } from '@beonauto/workflow-engine';

import type { CancelChild } from '../calls/call-cancels.ts';

const reasons: Readonly<Record<CancelReason, string>> = {
  deadline: 'The step that waited for this run ran out of time, so it no longer needs it',
  parent_ended: 'The run that waited for this run ended first, or the branch that waited for it lost a race',
};

export function childCancelsOn(cancel: CancelExecution): CancelChild {
  return ({ child: { org, brain, executionId }, reason, lineage }) =>
    cancel({ org, brain, id: executionId }, { kind: reason, reason: reasons[reason] }, lineage);
}
