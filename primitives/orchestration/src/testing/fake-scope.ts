import { FakeCancellation } from './fake-cancellation.ts';

export type Begin<T> = (resolve: (value: T) => void, reject: (error: unknown) => void) => () => void;

export class FakeScope {
  readonly #cancellations = new Set<() => void>();
  readonly #children = new Set<FakeScope>();
  #cancelled = false;

  child(): FakeScope {
    const child = new FakeScope();
    this.#children.add(child);
    return child;
  }

  operation<T>(begin: Begin<T>): Promise<T> {
    if (this.#cancelled) {
      return Promise.reject(new FakeCancellation());
    }
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const forget = begin(resolve, reject);
    const cancellation = (): void => {
      forget();
      reject(new FakeCancellation());
    };
    const release = (): void => {
      this.#cancellations.delete(cancellation);
    };
    this.#cancellations.add(cancellation);
    void promise.then(release, release);
    return promise;
  }

  cancel(): void {
    this.#cancelled = true;
    for (const cancellation of this.#cancellations) {
      cancellation();
    }
    for (const child of this.#children) {
      child.cancel();
    }
  }
}
