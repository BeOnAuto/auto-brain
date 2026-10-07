import { answerOf } from '../jobs/program-answer.ts';
import { serveJobs } from './job-loop.ts';

serveJobs({ program: answerOf });
