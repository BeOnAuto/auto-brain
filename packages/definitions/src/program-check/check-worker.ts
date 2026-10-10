import { serveJobs } from '@beonauto/workflow-engine/job-loop';

import { checkerOf } from './checking.ts';
import { keptSandboxLib } from './kept-lib.ts';

serveJobs({ check: checkerOf(keptSandboxLib()) });
