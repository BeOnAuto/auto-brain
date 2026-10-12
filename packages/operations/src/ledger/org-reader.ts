import { Context } from 'effect';

import type { StreamReader } from './stream-ports.ts';

export class OrgReader extends Context.Service<OrgReader, StreamReader>()('@on.auto/operations/OrgReader') {}
