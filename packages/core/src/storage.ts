/** A queued lock for immutable uploads and snapshot staging. One process per data directory. */
export interface StorageLock {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createStorageLock(): StorageLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const result = tail.then(work);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

const globalStorage = globalThis as unknown as { __collectcollectStorageLocks?: Map<string, StorageLock> };
export function getStorageLock(namespace: string): StorageLock {
  const locks = (globalStorage.__collectcollectStorageLocks ??= new Map());
  let lock = locks.get(namespace);
  if (!lock) { lock = createStorageLock(); locks.set(namespace, lock); }
  return lock;
}
