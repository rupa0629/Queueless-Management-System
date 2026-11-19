// Per-key async mutex ensuring atomic serialization of queue mutations
// Prevents duplicate token sequence numbers and queue-order race conditions.

const locks = new Map<string, Promise<void>>();

export async function withQueueLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  locks.set(key, chained);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) {
      locks.delete(key);
    }
  }
}
