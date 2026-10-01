import { Context } from 'effect';

import type { StreamWriter } from './stream-ports.ts';

export class BrainWriter extends Context.Service<BrainWriter, StreamWriter>()('@beonauto/operations/BrainWriter') {}
