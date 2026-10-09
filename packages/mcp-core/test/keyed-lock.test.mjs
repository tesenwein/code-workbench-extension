import { describe, it, expect } from "vitest";
import { createKeyedLock } from "../keyed-lock.mjs";

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

describe("createKeyedLock", () => {
  it("serializes work under the same key in call order", async () => {
    const withLock = createKeyedLock();
    const log = [];
    const a = withLock("k", async () => {
      await tick(20);
      log.push("a");
    });
    const b = withLock("k", async () => {
      log.push("b");
    });
    await Promise.all([a, b]);
    expect(log).toEqual(["a", "b"]);
  });

  it("runs different keys concurrently", async () => {
    const withLock = createKeyedLock();
    const log = [];
    const a = withLock("x", async () => {
      await tick(20);
      log.push("x");
    });
    const b = withLock("y", async () => {
      log.push("y");
    });
    await Promise.all([a, b]);
    expect(log).toEqual(["y", "x"]);
  });

  it("keeps the chain alive after a rejection and returns values", async () => {
    const withLock = createKeyedLock();
    const failed = withLock("k", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(withLock("k", () => 42)).resolves.toBe(42);
  });

  it("removes the map entry once the chain settles", async () => {
    const withLock = createKeyedLock();
    const a = withLock("k", async () => {
      await tick(5);
    });
    const b = withLock("k", async () => {
      throw new Error("boom");
    });
    expect(withLock.size()).toBe(1);
    await a;
    await expect(b).rejects.toThrow("boom");
    expect(withLock.size()).toBe(0);
  });
});
