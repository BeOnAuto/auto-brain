import { loadWithOnnxRuntime } from '../src/process/model-sessions.ts';

const [path = ''] = process.argv.slice(2);
const before = process.memoryUsage().rss;
const loaded = await loadWithOnnxRuntime(path, 1);
await loaded.run({ y: { data: Float32Array.of(10, 12), dims: [1, 2] } });
const after = process.memoryUsage().rss;
process.stdout.write(`${JSON.stringify({ before, after, peak: process.resourceUsage().maxRSS * 1024 })}\n`);
