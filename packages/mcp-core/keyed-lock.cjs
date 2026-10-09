"use strict";

// Keyed promise lock: serializes async work per key so concurrent writers of
// the same resource (a task file, an arch card) can't interleave their
// read-modify-write cycles. Work under different keys runs concurrently.
// CommonJS so the CJS extension host and the ESM MCP servers share one copy.

/**
 * @returns {<T>(key: string, fn: () => Promise<T> | T) => Promise<T>}
 */
function createKeyedLock() {
  const locks = new Map();
  return function withLock(key, fn) {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => fn())
      .finally(() => {
        if (locks.get(key) === next) locks.delete(key);
      });
    locks.set(key, next);
    return next;
  };
}

module.exports = { createKeyedLock };
