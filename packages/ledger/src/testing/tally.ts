import { Conflict, type Decider } from '@beonauto/operations';
import { Effect, Result, Schema, SchemaGetter } from 'effect';

const CountedSchema = Schema.Struct({ type: Schema.Literal('counted'), by: Schema.Int });

type Counted = typeof CountedSchema.Type;

export type Amounts = readonly number[];

function decided(amounts: Amounts, total: number): Result.Result<readonly Counted[], Conflict> {
  const reached = amounts.reduce((running, amount) => running + amount, total);
  return reached < 0
    ? Result.fail(new Conflict({ detail: `A tally of ${total} cannot fall to ${reached}` }))
    : Result.succeed(amounts.map((by) => ({ type: 'counted', by })));
}

export const tally: Decider<number, Amounts, Counted, 'conflict'> = {
  initialState: 0,
  evolve: (total, { by }) => total + by,
  decide: decided,
  eventSchema: CountedSchema,
};

export function tallyInterruptedBy(
  interruption: Effect.Effect<unknown>,
  times: number,
): Decider<number, Amounts, Counted, 'conflict'> {
  let remaining = times;
  const interruptOnce = Effect.suspend(() => {
    remaining -= 1;
    return remaining >= 0 ? interruption : Effect.void;
  });
  return {
    ...tally,
    eventSchema: CountedSchema.pipe(
      Schema.decodeTo(Schema.toType(CountedSchema), {
        decode: SchemaGetter.passthrough(),
        encode: SchemaGetter.transformEffect((counted: Counted) => Effect.as(interruptOnce, counted)),
      }),
    ),
  };
}
