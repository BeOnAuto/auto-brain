import { Context } from 'effect';

import type { PlaybookProjectionReader } from '../projections/keyed-projection.ts';
import type { PlaybookRecordedReader, PlaybookRunOutcomesReader, StreamReader } from './stream-ports.ts';

export class PlaybookReader extends Context.Service<
  PlaybookReader,
  StreamReader & PlaybookRecordedReader & PlaybookRunOutcomesReader & PlaybookProjectionReader
>()('@beonauto/operations/PlaybookReader') {}
