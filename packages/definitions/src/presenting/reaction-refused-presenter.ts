import type { Presenter, Recorded } from '@beonauto/operations';

import { ReactionRefusedSchema, reactionsStreamKind, type ReactionRefused } from '../events/reaction-refusals.ts';
import { reactionsRefused } from '../plain-language/event-words.ts';
import { definitionNameOf } from '../registry/definition-registry.ts';
import { cutAtCodePoint, mostDetailBytes, mostNameBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function accountOf({ data, context }: Recorded<ReactionRefused>): Account {
  const { count, reason, minute } = data;
  return {
    summary: reactionsRefused(cutAtCodePoint(definitionNameOf(context), mostNameBytes)),
    data: { count, reason: cutAtCodePoint(reason, mostDetailBytes), minute },
  };
}

export const reactionRefusedPresenter: Presenter = eventPresenter<ReactionRefused>({
  streamKind: reactionsStreamKind,
  eventSchema: ReactionRefusedSchema,
  types: ['reaction_refused'],
  account: accountOf,
});
