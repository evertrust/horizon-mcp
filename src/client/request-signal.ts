import { AsyncLocalStorage } from 'node:async_hooks';

const requestSignalStore = new AsyncLocalStorage<AbortSignal>();

/** Scope one request signal to all asynchronous work started by the callback. */
export function runWithRequestSignal<T>(signal: AbortSignal, fn: () => T): T {
  return requestSignalStore.run(signal, fn);
}

/** Return the signal scoped to the current asynchronous request chain. */
export function currentRequestSignal(): AbortSignal | undefined {
  return requestSignalStore.getStore();
}

/** Preserve the timeout bound while also honoring request cancellation. */
export function composeWithTimeout(timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = currentRequestSignal();
  return requestSignal
    ? AbortSignal.any([timeoutSignal, requestSignal])
    : timeoutSignal;
}
