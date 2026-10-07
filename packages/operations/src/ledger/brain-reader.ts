import { Context } from 'effect';

import type { BrainProjectionReader } from '../projections/run-projection.ts';
import type { BrainRecordedReader, BrainRunOutcomesReader, StreamReader } from './stream-ports.ts';

export class BrainReader extends Context.Service<
  BrainReader,
  StreamReader & BrainRecordedReader & BrainRunOutcomesReader & BrainProjectionReader
>()('@beonauto/operations/BrainReader') {}
