// A promise that gives up after `ms`. Pure (no server or browser imports) so it can be unit tested.

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`No reply after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Resolves or rejects like `promise`, or rejects with a TimeoutError once `ms` have passed. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
