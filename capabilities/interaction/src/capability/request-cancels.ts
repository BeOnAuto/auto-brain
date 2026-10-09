import { cancelledAsAsked, type CancelledRun, type Settlement } from '@beonauto/definitions';

import { requestRecordOf, takesAnswer } from '../run/request-record.ts';
import { answeredSettlement, deliveredSettlement } from '../schedule/request-endings.ts';

export function cancelledRequest(run: CancelledRun): Settlement {
  const { broughtAnswer, deliveredAt } = run;
  const request = requestRecordOf(run.record);
  if (request === undefined) {
    return cancelledAsAsked(run);
  }
  if (broughtAnswer !== null) {
    return answeredSettlement(run.run, broughtAnswer);
  }
  return deliveredAt !== null && !takesAnswer(request) ? deliveredSettlement(deliveredAt) : cancelledAsAsked(run);
}
