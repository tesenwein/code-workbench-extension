/** Create a lock that runs `fn` after all earlier work under the same `key` settles. */
export function createKeyedLock(): (<T>(
  key: string,
  fn: () => Promise<T> | T,
) => Promise<T>) & {
  /** Number of keys with pending work; 0 once every chain has settled. */
  size: () => number;
};
