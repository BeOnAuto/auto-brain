import { memoryLedger } from '@beonauto/operations/testing';
import { describe } from 'vitest';

import { projectionsBehaviour } from './projections-behaviour.ts';

describe('The in-memory ledger of the application layer', () => {
  projectionsBehaviour((projections) => Promise.resolve(memoryLedger(undefined, projections).service));
});
