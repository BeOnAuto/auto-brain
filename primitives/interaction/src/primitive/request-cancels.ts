import { cancelledAsAsked, type CancelledRun, type Settlement } from '@beonauto/specs';

import { requestRecordOf, takesAnswer } from '../run/request-record.ts';
import { answeredSettlement, deliveredSettlement } from '../schedule/request-endings.ts';

export function cancelledRequest(run: CancelledRun): Settlement {
  const { channelAnswer, deliveredAt } = run;
  const request = requestRecordOf(run.record);
  if (request === undefined) {
    return cancelledAsAsked(run);
  }
  if (channelAnswer !== null) {
    return answeredSettlement(request.channel, channelAnswer.answer, channelAnswer.at);
  }
  return deliveredAt !== null && !takesAnswer(request) ? deliveredSettlement(deliveredAt) : cancelledAsAsked(run);
}
