import { Context } from 'effect';

import type { BrainRecordedReader, BrainRunOutcomesReader, StreamReader } from './stream-ports.ts';

export class BrainReader extends Context.Service<
  BrainReader,
  StreamReader & BrainRecordedReader & BrainRunOutcomesReader
>()('@beonauto/operations/BrainReader') {}
