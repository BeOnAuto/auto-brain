import { foldAnswerOf } from '../folds/fold-answer.ts';
import { serveJobs } from './job-loop.ts';

serveJobs({ fold: foldAnswerOf });
