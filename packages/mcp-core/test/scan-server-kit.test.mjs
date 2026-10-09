import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDetectTool, mergeExcludeDirs } from "../scan-server-kit.mjs";

const ITEMS = [
  { fingerprint: "a", kind: "x" },
  { fingerprint: "b", kind: "y" },
  { fingerprint: "c", kind: "" },
];

describe("makeDetectTool", () => {
  let root;
  let ackFile;
  let excludeFile;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "sskit-"));
    ackFile = path.join(root, "ack.json");
    excludeFile = path.join(root, "exclude.json");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const build = (over = {}) =>
    makeDetectTool({
      root,
      feature: "kit-test",
      allCategories: ["x", "y"],
      categoryOf: (i) => i.kind,
      ackFilePath: () => ackFile,
      excludeFilePath: () => excludeFile,
      loadDetector: async () => async () => ITEMS,
      noScanMessage: "no scan yet",
      ...over,
    });

  it("returns noScanMessage when no findings exist", async () => {
    expect(await build()({})).toEqual({ error: "no scan yet" });
  });

  it("force_scan persists every category, then reads filter by category", async () => {
    const detect = build();
    const forced = await detect({ force_scan: true, categories: ["x"] });
    expect(forced.items.map((i) => i.fingerprint)).toEqual(["a"]);
    const all = await detect({});
    expect(all.items.map((i) => i.fingerprint)).toEqual(["a", "b"]);
  });

  it("drops items with an empty-string category not in the filter", async () => {
    const detect = build();
    await detect({ force_scan: true });
    const r = await detect({ categories: ["x", "y"] });
    expect(r.items.map((i) => i.fingerprint)).not.toContain("c");
  });

  it("keeps items whose category is undefined", async () => {
    const detect = build({ categoryOf: (i) => (i.kind === "x" ? "x" : undefined) });
    await detect({ force_scan: true });
    const r = await detect({ categories: ["x"] });
    expect(r.items.map((i) => i.fingerprint)).toEqual(["a", "b", "c"]);
  });

  it("hides acknowledged items and counts them", async () => {
    writeFileSync(ackFile, JSON.stringify(["a"]));
    const detect = build();
    await detect({ force_scan: true });
    const r = await detect({});
    expect(r.items.map((i) => i.fingerprint)).toEqual(["b"]);
    expect(r.acknowledgedHidden).toBe(1);
    expect(r.total).toBe(1);
  });

  it("splices extraShape after total", async () => {
    const detect = build({ extraShape: (v) => ({ n: v.length }) });
    const r = await detect({ force_scan: true });
    expect(r.n).toBe(r.total);
  });
});

describe("mergeExcludeDirs", () => {
  it("dedupes stored and extra dirs", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sskit-"));
    const file = path.join(dir, "e.json");
    writeFileSync(file, JSON.stringify(["a", "b"]));
    expect(mergeExcludeDirs(() => file, ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeExcludeDirs(() => file, undefined)).toEqual(["a", "b"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
