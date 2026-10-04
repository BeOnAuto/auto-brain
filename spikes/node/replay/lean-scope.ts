import { FakeCancellation } from '../../../primitives/orchestration/src/testing/fake-cancellation.ts';
import type { Begin } from '../../../primitives/orchestration/src/testing/fake-scope.ts';

export class LeanScope {
  readonly #cancellations = new Set<() => void>();
  readonly #children = new Set<LeanScope>();
  #cancelled = false;

  child(): { readonly scope: LeanScope; readonly forget: () => void } {
    const scope = new LeanScope();
    this.#children.add(scope);
    return {
      scope,
      forget: () => {
        this.#children.delete(scope);
      },
    };
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
