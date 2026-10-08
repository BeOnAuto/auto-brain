import { cancelledAsAsked, type CancelledRun, type Settlement } from '@beonauto/specs';

import { requestRecordOf, takesAnswer } from '../run/request-record.ts';
import { answeredSettlement, deliveredSettlement } from '../schedule/request-endings.ts';

export function cancelledRequest(run: CancelledRun): Settlement {
  const { lastDelivery } = run;
  const request = requestRecordOf(run.record);
  if (request === undefined || lastDelivery === null) {
    return cancelledAsAsked(run);
  }
  if (lastDelivery.answer !== undefined) {
    return answeredSettlement(request.channel, lastDelivery.answer, lastDelivery.at);
  }
  return lastDelivery.outcome === 'delivered' && !takesAnswer(request)
    ? deliveredSettlement(lastDelivery.at)
    : cancelledAsAsked(run);
}
