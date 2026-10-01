import { Context } from 'effect';

import type { StreamReader } from './stream-ports.ts';

export class BrainReader extends Context.Service<BrainReader, StreamReader>()('@beonauto/operations/BrainReader') {}
