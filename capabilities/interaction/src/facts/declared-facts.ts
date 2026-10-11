import { declaredFact, runFactsOf, type CapabilityFacts } from '@beonauto/definitions';
import { conversationCallPresenter } from '@beonauto/mcp';

import {
  failedAccount,
  refusedAccount,
  replyRefusedAccount,
  startedAccount,
  succeededAccount,
} from './fact-accounts.ts';
import {
  DeliveryFailedFactSchema,
  DeliveryRefusedFactSchema,
  DeliveryStartedFactSchema,
  DeliverySucceededFactSchema,
  ReplyRefusedFactSchema,
} from './run-facts.ts';

export const interactionFacts: CapabilityFacts = {
  onRuns: [
    declaredFact('delivery_started', DeliveryStartedFactSchema, startedAccount),
    declaredFact('delivery_succeeded', DeliverySucceededFactSchema, succeededAccount),
    declaredFact('delivery_failed', DeliveryFailedFactSchema, failedAccount),
    declaredFact('delivery_refused', DeliveryRefusedFactSchema, (fact) => refusedAccount(fact)),
    declaredFact('reply_refused', ReplyRefusedFactSchema, (fact) => replyRefusedAccount(fact)),
  ],
  streams: [conversationCallPresenter],
};

export const interactionRunFacts = runFactsOf(interactionFacts.onRuns);
