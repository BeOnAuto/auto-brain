import type { Runner } from './advance.ts';
import { cancelList, resumeList, startList } from './list-runner.ts';
import { cancelTask, resumeTask, startTask } from './task-runner.ts';

export const runner: Runner = { startTask, resumeTask, cancelTask, startList, resumeList, cancelList };
