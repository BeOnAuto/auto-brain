import {
  brainCallerOf,
  DefinitionContextSchema,
  factOf,
  type BrainAddress,
  type Decided,
  type Decider,
} from '@beonauto/operations';
import { Result, Schema } from 'effect';

export const reactionsStreamKind = 'reactions';

export const ReactionRefusedSchema = factOf(
  'reaction_refused',
  Schema.Struct({ count: Schema.Int, reason: Schema.String, minute: Schema.String }),
  DefinitionContextSchema,
);

export type RecordedReactionRefused = typeof ReactionRefusedSchema.Type;

export type ReactionRefused = Decided<RecordedReactionRefused>;

export interface ReactionRefusal {
  readonly brain: BrainAddress;
  readonly workflow: string;
  readonly version: number;
  readonly refused: ReactionRefused['data'];
  readonly at: string;
}

export const reactionRefusalDecider: Decider<null, ReactionRefusal, RecordedReactionRefused> = {
  initialState: null,
  evolve: () => null,
  decide: ({ refused }) => Result.succeed([{ type: 'reaction_refused', data: refused }]),
  context: ({ brain, workflow, version, at }) => ({
    at,
    by: brainCallerOf(brain).id,
    definitionType: 'workflow',
    definitionName: workflow,
    definitionVersion: version,
  }),
  eventSchema: ReactionRefusedSchema,
};
