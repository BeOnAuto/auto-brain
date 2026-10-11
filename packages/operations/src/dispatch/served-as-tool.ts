import { Context } from 'effect';

export const ServedAsTool = Context.Reference<boolean>('@beonauto/operations/ServedAsTool', {
  defaultValue: () => false,
});
