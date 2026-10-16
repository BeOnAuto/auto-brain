import { setTimeout } from 'node:timers/promises';

export async function eventually<A>(read: () => A, done: (value: A) => boolean): Promise<A> {
  const value = read();
  if (done(value)) {
    return value;
  }
  await setTimeout(10);
  return eventually(read, done);
}
