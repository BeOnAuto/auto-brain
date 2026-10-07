import { serveJobs } from '@beonauto/workflow-engine/job-loop';
import { answerOf, foldAnswerOf } from '@beonauto/workflow-engine/worker';

import { valueChecks } from './value-checks.ts';

serveJobs({ program: answerOf, fold: foldAnswerOf, checks: valueChecks });
