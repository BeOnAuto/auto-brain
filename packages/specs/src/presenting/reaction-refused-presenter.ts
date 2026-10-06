import type { Presenter } from '@beonauto/operations';

import { ReactionRefusedSchema, reactionsStreamKind, type ReactionRefused } from '../events/reaction-refusals.ts';
import { reactionsRefused } from '../plain-language/event-words.ts';
import { cutAtCodePoint, mostDetailBytes, mostNameBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function accountOf({ workflow, count, reason, minute }: ReactionRefused): Account {
  const name = cutAtCodePoint(workflow, mostNameBytes);
  return {
    summary: reactionsRefused(name),
    data: { workflow: name, count, reason: cutAtCodePoint(reason, mostDetailBytes), minute },
  };
}

export const reactionRefusedPresenter: Presenter = eventPresenter<ReactionRefused['type'], ReactionRefused>({
  streamKind: reactionsStreamKind,
  eventSchema: ReactionRefusedSchema,
  publicNames: { reaction_refused: ['reaction_refused'] },
  account: accountOf,
});
