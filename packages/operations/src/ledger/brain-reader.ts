import { Context } from 'effect';

import type { BrainRecordedReader, StreamReader } from './stream-ports.ts';

export class BrainReader extends Context.Service<BrainReader, StreamReader & BrainRecordedReader>()(
  '@beonauto/operations/BrainReader',
) {}
