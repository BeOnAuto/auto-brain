import { Context } from 'effect';

import type { BrainContentReader } from '../content/recorded-content.ts';
import type { BrainProjectionReader } from '../projections/keyed-projection.ts';
import type { BrainRecordedReader, BrainRunOutcomesReader, StreamReader } from './stream-ports.ts';

export class BrainReader extends Context.Service<
  BrainReader,
  StreamReader & BrainRecordedReader & BrainRunOutcomesReader & BrainProjectionReader & BrainContentReader
>()('@beonauto/operations/BrainReader') {}
